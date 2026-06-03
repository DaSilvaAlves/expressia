/**
 * PATCH /api/tasks/[id]/move — Story 3.2 AC2 (drag-and-drop atómico).
 *
 * Body: { kanban_column_id: uuid | null, kanban_position: integer >= 0 }
 *
 * Algoritmo atómico em transacção:
 *   1. SELECT task atual (kanban_column_id, kanban_position) — 404 se não existe.
 *   2. Se kanban_column_id alvo não-null, verifica que pertence ao household
 *      (RLS via getDb()).
 *   3. Cross-column move: shift right siblings na coluna alvo (pattern "shift").
 *   4. Intra-column reorder: shift right/left consoante direcção.
 *   5. UPDATE task com novos values + updated_at.
 *   6. audit_log INSERT (task.moved).
 *
 * 409 CONFLICT em race condition (unique constraint violation).
 *
 * RLS (SEC-5 / ADR-003 Fase 4 Fatia A): TODAS as queries de domínio (select
 * actual + verificação de coluna + shift de siblings + update + re-fetch) correm
 * dentro de UM único `withHousehold` (2.ª rede + atomicidade — substitui o
 * `begin/commit` inline anterior). O filtro `household_id` (SEC-1, 1.ª rede)
 * MANTÉM-SE. Retorno discriminado preserva os 404 sem `return` de NextResponse
 * dentro do callback da transação. O `insertAuditLog` permanece best-effort FORA
 * do `withHousehold` em `getDb()` (PO-FIX-2 / D-SEC3).
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
import { TaskMoveSchema } from '@/lib/api-schemas/tasks';
import { requireAuth } from '@/lib/api-helpers/auth';
import { insertAuditLog } from '@/lib/api-helpers/audit';

const ROUTE = '/api/tasks/[id]/move';
const UuidParam = z.string().uuid();

interface RouteContext {
  params: Promise<{ id: string }>;
}

export async function PATCH(req: NextRequest, ctx: RouteContext): Promise<NextResponse> {
  return withSpan(
    'PATCH /api/tasks/[id]/move',
    { method: 'PATCH', route: ROUTE },
    async (span): Promise<NextResponse> => {
      const log = childLogger({ route: ROUTE, method: 'PATCH' });
      const auth = await requireAuth(span);
      if (auth instanceof NextResponse) return auth;

      const { id } = await ctx.params;
      if (!UuidParam.safeParse(id).success) {
        annotateSpan(span, { statusCode: 400 });
        return apiError('VALIDATION_ERROR', 'ID de tarefa inválido.', 400);
      }
      annotateSpan(span, { extra: { 'task.id_hash': hashForCorrelation(id) } });

      let body;
      try {
        body = TaskMoveSchema.parse(await req.json());
      } catch (err) {
        annotateSpan(span, { statusCode: 400 });
        if (err instanceof z.ZodError) {
          return apiError('VALIDATION_ERROR', 'Dados de move inválidos.', 400, {
            issues: err.issues.map((i) => ({ path: i.path, message: i.message })),
          });
        }
        return apiError('VALIDATION_ERROR', 'Body inválido.', 400);
      }

      try {
        // PO-FIX-2: `getDb()` mantém-se para o `insertAuditLog` best-effort (abaixo).
        const db = getDb();

        // SEC-5: select actual + verificação de coluna + shift + update + re-fetch
        // correm no MESMO `withHousehold` (atomicidade + contexto RLS consistente —
        // substitui o `begin/commit` inline anterior). Retorno discriminado preserva
        // os 404 sem `return` de NextResponse dentro do callback da transação.
        const result = await withHousehold(
          { userId: auth.userId, householdId: auth.householdId },
          async (
            tx,
          ): Promise<
            | { notFound: 'task' | 'column' }
            | {
                current: { kanban_column_id: string | null; kanban_position: number };
                updated: Record<string, unknown> | undefined;
              }
          > => {
            // 1. SELECT actual state (RLS + filtro household_id bloqueiam cross-household)
            const currentRows = await tx.execute<{
              id: string;
              kanban_column_id: string | null;
              kanban_position: number;
            }>(sql`
              select id, kanban_column_id, kanban_position
              from public.tasks
              where id = ${id}::uuid and household_id = ${auth.householdId}::uuid
              limit 1
            `);

            const current = currentRows[0];
            if (!current) return { notFound: 'task' };

            // 2. Verificar coluna alvo pertence ao household (se não-null)
            if (body.kanban_column_id) {
              const colRows = await tx.execute<{ id: string }>(sql`
                select id from public.kanban_columns
                where id = ${body.kanban_column_id}::uuid and household_id = ${auth.householdId}::uuid
                limit 1
              `);
              if (colRows.length === 0) return { notFound: 'column' };
            }

            // 3. Shift right siblings na coluna alvo
            if (body.kanban_column_id !== null) {
              await tx.execute(sql`
                update public.tasks
                set kanban_position = kanban_position + 1, updated_at = now()
                where kanban_column_id = ${body.kanban_column_id}::uuid
                  and household_id = ${auth.householdId}::uuid
                  and kanban_position >= ${body.kanban_position}
                  and id != ${id}::uuid
              `);
            }

            // 4. UPDATE task target
            await tx.execute(sql`
              update public.tasks
              set kanban_column_id = ${body.kanban_column_id}::uuid,
                  kanban_position = ${body.kanban_position},
                  updated_at = now()
              where id = ${id}::uuid and household_id = ${auth.householdId}::uuid
            `);

            // 5. Re-fetch estado final (query de domínio — dentro do mesmo `tx`, AC3)
            const updatedRows = await tx.execute<Record<string, unknown>>(sql`
              select id, household_id, created_by_user_id, assigned_to_user_id, title, description,
                     due_date, due_time, priority, status, kanban_column_id, kanban_position,
                     project, recurrence_id, is_recurrence_template, completed_at, created_at, updated_at
              from public.tasks
              where id = ${id}::uuid and household_id = ${auth.householdId}::uuid
              limit 1
            `);

            return {
              current: {
                kanban_column_id: current.kanban_column_id,
                kanban_position: current.kanban_position,
              },
              updated: updatedRows[0],
            };
          },
        );

        if ('notFound' in result) {
          annotateSpan(span, { statusCode: 404 });
          return apiError(
            'NOT_FOUND',
            result.notFound === 'task' ? 'Tarefa não encontrada.' : 'Coluna Kanban não encontrada.',
            404,
          );
        }

        const { current, updated } = result;
        const isCrossColumn = current.kanban_column_id !== body.kanban_column_id;

        // 6. Audit log (best-effort) — FORA do `withHousehold` (PO-FIX-2)
        try {
          await insertAuditLog({
            db,
            householdId: auth.householdId,
            userId: auth.userId,
            action: 'task.moved',
            entityTable: 'tasks',
            entityId: id,
            beforeState: {
              kanban_column_id: current.kanban_column_id,
              kanban_position: current.kanban_position,
            },
            afterState: {
              kanban_column_id: body.kanban_column_id,
              kanban_position: body.kanban_position,
            },
          });
        } catch (auditErr) {
          log.warn({ err: auditErr }, 'audit_log INSERT falhou (best-effort)');
        }

        annotateSpan(span, {
          statusCode: 200,
          extra: {
            'task.from_column_hash': current.kanban_column_id ? hashForCorrelation(current.kanban_column_id) : 'null',
            'task.to_column_hash': body.kanban_column_id ? hashForCorrelation(body.kanban_column_id) : 'null',
            'task.position_delta': body.kanban_position - current.kanban_position,
            'task.is_cross_column': isCrossColumn,
          },
        });
        return NextResponse.json({ task: updated });
      } catch (err) {
        // Postgres unique constraint violation → 23505 (race condition no reorder).
        // O `withHousehold` faz rollback da transação; o erro propaga até aqui.
        const message = err instanceof Error ? err.message : String(err);
        if (/unique|duplicate|23505/i.test(message)) {
          annotateSpan(span, { statusCode: 409 });
          return apiError('CONFLICT', 'Conflito ao mover tarefa — tenta novamente.', 409);
        }
        annotateSpan(span, { statusCode: 500 });
        log.error({ err }, 'PATCH /api/tasks/[id]/move falhou');
        captureException(err instanceof Error ? err : new Error(String(err)), {
          userId: auth.userId,
          route: ROUTE,
        });
        return apiError('INTERNAL_ERROR', 'Erro ao mover tarefa. Tenta novamente.', 500);
      }
    },
  );
}
