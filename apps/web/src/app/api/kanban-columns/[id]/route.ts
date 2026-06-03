/**
 * PATCH / DELETE /api/kanban-columns/[id] — Story 3.4 AC9 + AC10.
 *
 * PATCH: actualiza parcialmente. Se `is_done_column=true` é definido, desliga
 *        todos os outros do household na mesma transaction (invariant: exactly
 *        1 done column per household — DB partial unique index pendente migration 0011).
 *        Se `sort_order` muda, faz rebalance shift (não trivial — defer to batch
 *        endpoint para multi-column reorders; aqui apenas suportamos PATCH com
 *        sort_order alto sem conflito).
 *        audit_log entry `kanban_column.updated` com before/after state.
 *
 * DELETE: requer role `owner` ou `admin` (RLS reforça `kanban_columns_delete_owner_admin`).
 *         Se coluna tem tasks, `?move_to=<uuid>` é obrigatório. UPDATE tasks
 *         + DELETE em transaction. 409 se tasks existem sem `move_to`.
 *         audit_log entry `kanban_column.deleted` com snapshot.
 *
 * RLS (SEC-5 / ADR-003 Fase 4 Fatia A): TODAS as queries de domínio de cada
 * handler (select + dup/dest checks + flip done + update/delete + re-fetch) correm
 * num único `withHousehold` (2.ª rede + atomicidade — substitui o `begin/commit`
 * inline anterior). O filtro `household_id` (SEC-1, 1.ª rede) MANTÉM-SE. Retorno
 * discriminado preserva os 404/409 sem `return` de NextResponse dentro do callback.
 * `resolveHouseholdRole` (DELETE) corre FORA — query a `household_members`, não
 * dados de domínio (mirror SEC-3 T2.3a). O `insertAuditLog` permanece best-effort
 * FORA do `withHousehold` em `getDb()` (PO-FIX-2 / D-SEC3).
 */
import { sql } from 'drizzle-orm';
import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';

import {
  annotateSpan,
  captureException,
  childLogger,
  hashForCorrelation,
  withSpan,
} from '@meu-jarvis/observability';

import { apiError } from '@/lib/errors';
import { getDb, withHousehold } from '@/lib/agent/db-shim';
import {
  UpdateKanbanColumnSchema,
  DeleteKanbanColumnQuerySchema,
} from '@/lib/api-schemas/kanban-columns';
import { requireAuth, resolveHouseholdRole } from '@/lib/api-helpers/auth';
import { insertAuditLog } from '@/lib/api-helpers/audit';

const ROUTE = '/api/kanban-columns/[id]';
const UuidParam = z.string().uuid();

interface RouteContext {
  params: Promise<{ id: string }>;
}

interface KanbanColumnDbRow {
  id: string;
  household_id: string;
  name: string;
  sort_order: number;
  color: string;
  is_done_column: boolean | string;
}

function isDoneBool(value: boolean | string): boolean {
  return typeof value === 'boolean' ? value : value === 'true';
}

export async function PATCH(req: NextRequest, ctx: RouteContext): Promise<NextResponse> {
  return withSpan(
    'PATCH /api/kanban-columns/[id]',
    { method: 'PATCH', route: ROUTE },
    async (span): Promise<NextResponse> => {
      const log = childLogger({ route: ROUTE, method: 'PATCH' });
      const auth = await requireAuth(span);
      if (auth instanceof NextResponse) return auth;

      const { id } = await ctx.params;
      if (!UuidParam.safeParse(id).success) {
        annotateSpan(span, { statusCode: 400 });
        return apiError('VALIDATION_ERROR', 'ID de coluna inválido.', 400);
      }
      annotateSpan(span, { extra: { 'column.id_hash': hashForCorrelation(id) } });

      let body;
      try {
        body = UpdateKanbanColumnSchema.parse(await req.json());
      } catch (err) {
        annotateSpan(span, { statusCode: 400 });
        if (err instanceof z.ZodError) {
          return apiError('VALIDATION_ERROR', 'Dados inválidos.', 400, {
            issues: err.issues.map((i) => ({ path: i.path, message: i.message })),
          });
        }
        return apiError('VALIDATION_ERROR', 'Body inválido — JSON malformado.', 400);
      }

      try {
        // PO-FIX-2: `getDb()` mantém-se para o `insertAuditLog` best-effort (abaixo).
        const db = getDb();

        // SEC-5: select + dup check + flip done + update + re-fetch num único
        // `withHousehold` (2.ª rede + atomicidade — substitui o `begin/commit` inline).
        // Retorno discriminado preserva os 404/409.
        const result = await withHousehold(
          { userId: auth.userId, householdId: auth.householdId },
          async (
            tx,
          ): Promise<
            | { notFound: true }
            | { duplicate: true }
            | { current: KanbanColumnDbRow; updated: KanbanColumnDbRow | undefined }
          > => {
            // 1. SELECT actual (RLS + filtro household_id bloqueiam cross-household)
            const currentRows = await tx.execute<KanbanColumnDbRow>(sql`
              select id, household_id, name, sort_order, color, is_done_column
              from public.kanban_columns
              where id = ${id}::uuid and household_id = ${auth.householdId}::uuid
              limit 1
            `);
            const current = currentRows[0];
            if (!current) return { notFound: true };

            // 2. Validação nome único se renaming
            if (body.name !== undefined && body.name !== current.name) {
              const dupRows = await tx.execute<{ id: string }>(sql`
                select id from public.kanban_columns
                where household_id = ${auth.householdId}::uuid
                  and lower(name) = lower(${body.name})
                  and id != ${id}::uuid
                limit 1
              `);
              if (dupRows.length > 0) return { duplicate: true };
            }

            // 3. Se vai definir is_done_column=true, desliga os outros do household.
            if (body.is_done_column === true) {
              await tx.execute(sql`
                update public.kanban_columns
                set is_done_column = 'false', updated_at = now()
                where household_id = ${auth.householdId}::uuid
                  and id != ${id}::uuid
                  and is_done_column = 'true'
              `);
            }

            // Build UPDATE dinamicamente
            const sets: ReturnType<typeof sql>[] = [];
            if (body.name !== undefined) sets.push(sql`name = ${body.name}`);
            if (body.color !== undefined) sets.push(sql`color = ${body.color}`);
            if (body.is_done_column !== undefined)
              sets.push(sql`is_done_column = ${body.is_done_column ? 'true' : 'false'}`);
            if (body.sort_order !== undefined)
              sets.push(sql`sort_order = ${body.sort_order}`);
            sets.push(sql`updated_at = now()`);

            if (sets.length > 1) {
              // join sets manually (sql template não tem join helper trivial)
              let updateSql = sql`update public.kanban_columns set `;
              for (let i = 0; i < sets.length; i++) {
                updateSql = i === 0 ? sql`${updateSql}${sets[i]}` : sql`${updateSql}, ${sets[i]}`;
              }
              updateSql = sql`${updateSql} where id = ${id}::uuid and household_id = ${auth.householdId}::uuid`;
              await tx.execute(updateSql);
            }

            // Re-fetch estado final (query de domínio — dentro do mesmo `tx`, AC3)
            const updatedRows = await tx.execute<KanbanColumnDbRow>(sql`
              select id, household_id, name, sort_order, color, is_done_column
              from public.kanban_columns
              where id = ${id}::uuid and household_id = ${auth.householdId}::uuid
              limit 1
            `);

            return { current, updated: updatedRows[0] };
          },
        );

        if ('notFound' in result) {
          annotateSpan(span, { statusCode: 404 });
          return apiError('NOT_FOUND', 'Coluna Kanban não encontrada.', 404);
        }
        if ('duplicate' in result) {
          annotateSpan(span, { statusCode: 409 });
          return apiError('DUPLICATE_NAME', 'Já existe uma coluna com este nome.', 409);
        }

        const { current, updated } = result;

        // 4. Audit log (best-effort)
        try {
          await insertAuditLog({
            db,
            householdId: auth.householdId,
            userId: auth.userId,
            action: 'kanban_column.updated',
            entityTable: 'kanban_columns',
            entityId: id,
            beforeState: {
              name: current.name,
              sort_order: current.sort_order,
              color: current.color,
              is_done_column: isDoneBool(current.is_done_column),
            },
            afterState: {
              name: body.name ?? current.name,
              sort_order: body.sort_order ?? current.sort_order,
              color: body.color ?? current.color,
              is_done_column: body.is_done_column ?? isDoneBool(current.is_done_column),
            },
          });
        } catch (auditErr) {
          log.warn({ err: auditErr }, 'audit_log INSERT falhou (best-effort)');
        }

        annotateSpan(span, { statusCode: 200 });
        return NextResponse.json({
          column: updated
            ? {
                id: updated.id,
                name: updated.name,
                sort_order: updated.sort_order,
                color: updated.color,
                is_done_column: isDoneBool(updated.is_done_column),
              }
            : null,
        });
      } catch (err) {
        // Unique constraint (ordem/nome duplicado) — `withHousehold` faz rollback;
        // o erro propaga até aqui (substitui o catch da transação inline).
        const message = err instanceof Error ? err.message : String(err);
        if (/unique|duplicate|23505/i.test(message)) {
          annotateSpan(span, { statusCode: 409 });
          return apiError(
            'CONFLICT',
            'Conflito ao actualizar coluna — ordem ou nome duplicado.',
            409,
          );
        }
        annotateSpan(span, { statusCode: 500 });
        log.error({ err }, 'PATCH /api/kanban-columns/[id] falhou');
        captureException(err instanceof Error ? err : new Error(String(err)), {
          userId: auth.userId,
          route: ROUTE,
        });
        return apiError('INTERNAL_ERROR', 'Erro ao actualizar coluna. Tenta novamente.', 500);
      }
    },
  );
}

export async function DELETE(req: NextRequest, ctx: RouteContext): Promise<NextResponse> {
  return withSpan(
    'DELETE /api/kanban-columns/[id]',
    { method: 'DELETE', route: ROUTE },
    async (span): Promise<NextResponse> => {
      const log = childLogger({ route: ROUTE, method: 'DELETE' });
      const auth = await requireAuth(span);
      if (auth instanceof NextResponse) return auth;

      const { id } = await ctx.params;
      if (!UuidParam.safeParse(id).success) {
        annotateSpan(span, { statusCode: 400 });
        return apiError('VALIDATION_ERROR', 'ID de coluna inválido.', 400);
      }
      annotateSpan(span, { extra: { 'column.id_hash': hashForCorrelation(id) } });

      // Role check defesa em profundidade (RLS reforça server-side)
      const role = await resolveHouseholdRole(auth.userId, auth.householdId);
      if (role !== 'owner' && role !== 'admin') {
        annotateSpan(span, { statusCode: 403 });
        return apiError(
          'FORBIDDEN',
          'Apenas administradores ou o proprietário podem eliminar colunas.',
          403,
        );
      }

      // Parse query string para move_to
      const url = new URL(req.url);
      const queryParams: Record<string, string> = {};
      const moveToParam = url.searchParams.get('move_to');
      if (moveToParam !== null) queryParams.move_to = moveToParam;

      const queryParsed = DeleteKanbanColumnQuerySchema.safeParse(queryParams);
      if (!queryParsed.success) {
        annotateSpan(span, { statusCode: 400 });
        return apiError('VALIDATION_ERROR', 'Query string inválida (move_to deve ser UUID).', 400);
      }
      const { move_to: moveTo } = queryParsed.data;

      try {
        // PO-FIX-2: `getDb()` mantém-se para o `insertAuditLog` best-effort (abaixo).
        const db = getDb();

        // SEC-5: select + count tasks + validações move_to + (update tasks + delete)
        // num único `withHousehold` (2.ª rede + atomicidade — substitui o `begin/commit`
        // inline). Retorno discriminado preserva os 404/409/400.
        const result = await withHousehold(
          { userId: auth.userId, householdId: auth.householdId },
          async (
            tx,
          ): Promise<
            | { notFound: true }
            | { hasTasks: number }
            | { sameColumn: true }
            | { destNotFound: true }
            | { ok: true; current: KanbanColumnDbRow; tasksCount: number }
          > => {
            // SELECT actual
            const currentRows = await tx.execute<KanbanColumnDbRow>(sql`
              select id, household_id, name, sort_order, color, is_done_column
              from public.kanban_columns
              where id = ${id}::uuid and household_id = ${auth.householdId}::uuid
              limit 1
            `);
            const current = currentRows[0];
            if (!current) return { notFound: true };

            const tasksCountRows = await tx.execute<{ count: string }>(sql`
              select count(*)::text as count from public.tasks
              where kanban_column_id = ${id}::uuid and household_id = ${auth.householdId}::uuid
            `);
            const tasksCount = Number(tasksCountRows[0]?.count ?? '0');

            if (tasksCount > 0 && !moveTo) return { hasTasks: tasksCount };

            // Se move_to definido: valida destino ∈ household e ≠ id
            if (moveTo) {
              if (moveTo === id) return { sameColumn: true };
              const destRows = await tx.execute<{ id: string }>(sql`
                select id from public.kanban_columns
                where id = ${moveTo}::uuid and household_id = ${auth.householdId}::uuid
                limit 1
              `);
              if (destRows.length === 0) return { destNotFound: true };
            }

            // UPDATE tasks + DELETE coluna (atomicidade via transação do withHousehold)
            if (tasksCount > 0 && moveTo) {
              await tx.execute(sql`
                update public.tasks
                set kanban_column_id = ${moveTo}::uuid, updated_at = now()
                where kanban_column_id = ${id}::uuid and household_id = ${auth.householdId}::uuid
              `);
            }
            await tx.execute(sql`
              delete from public.kanban_columns
              where id = ${id}::uuid and household_id = ${auth.householdId}::uuid
            `);

            return { ok: true, current, tasksCount };
          },
        );

        if ('notFound' in result) {
          annotateSpan(span, { statusCode: 404 });
          return apiError('NOT_FOUND', 'Coluna Kanban não encontrada.', 404);
        }
        if ('hasTasks' in result) {
          annotateSpan(span, { statusCode: 409 });
          return NextResponse.json(
            {
              error: {
                code: 'COLUMN_HAS_TASKS',
                message: `Esta coluna tem ${result.hasTasks} tarefa(s). Indica para que coluna mover via ?move_to=<uuid>.`,
                details: { tasks_count: result.hasTasks },
                timestamp: new Date().toISOString(),
                requestId: crypto.randomUUID(),
              },
            },
            { status: 409 },
          );
        }
        if ('sameColumn' in result) {
          annotateSpan(span, { statusCode: 400 });
          return apiError(
            'VALIDATION_ERROR',
            'A coluna de destino não pode ser a mesma que está a ser eliminada.',
            400,
          );
        }
        if ('destNotFound' in result) {
          annotateSpan(span, { statusCode: 404 });
          return apiError('NOT_FOUND', 'Coluna de destino não encontrada.', 404);
        }

        const { current, tasksCount } = result;

        // Audit log
        try {
          await insertAuditLog({
            db,
            householdId: auth.householdId,
            userId: auth.userId,
            action: 'kanban_column.deleted',
            entityTable: 'kanban_columns',
            entityId: id,
            beforeState: {
              column: {
                name: current.name,
                sort_order: current.sort_order,
                color: current.color,
                is_done_column: isDoneBool(current.is_done_column),
              },
              tasks_moved_to: moveTo ?? null,
              tasks_moved_count: tasksCount,
            },
          });
        } catch (auditErr) {
          log.warn({ err: auditErr }, 'audit_log INSERT falhou (best-effort)');
        }

        annotateSpan(span, { statusCode: 200 });
        return NextResponse.json({ deleted: true, id, tasks_moved_count: tasksCount });
      } catch (err) {
        annotateSpan(span, { statusCode: 500 });
        log.error({ err }, 'DELETE /api/kanban-columns/[id] falhou');
        captureException(err instanceof Error ? err : new Error(String(err)), {
          userId: auth.userId,
          route: ROUTE,
        });
        return apiError('INTERNAL_ERROR', 'Erro ao eliminar coluna. Tenta novamente.', 500);
      }
    },
  );
}
