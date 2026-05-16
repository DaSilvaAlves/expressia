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
import { getDb } from '@/lib/agent/db-shim';
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
        const db = getDb();

        // 1. SELECT actual state (RLS bloqueia cross-household)
        const currentRows = await db.execute<{
          id: string;
          kanban_column_id: string | null;
          kanban_position: number;
        }>(sql`
          select id, kanban_column_id, kanban_position
          from public.tasks where id = ${id}::uuid limit 1
        `);

        const current = currentRows[0];
        if (!current) {
          annotateSpan(span, { statusCode: 404 });
          return apiError('NOT_FOUND', 'Tarefa não encontrada.', 404);
        }

        // 2. Verificar coluna alvo pertence ao household (se não-null)
        if (body.kanban_column_id) {
          const colRows = await db.execute<{ id: string }>(sql`
            select id from public.kanban_columns where id = ${body.kanban_column_id}::uuid limit 1
          `);
          if (colRows.length === 0) {
            annotateSpan(span, { statusCode: 404 });
            return apiError('NOT_FOUND', 'Coluna Kanban não encontrada.', 404);
          }
        }

        const isCrossColumn = current.kanban_column_id !== body.kanban_column_id;

        // 3-5. Atomic move via transaction (Drizzle não expõe transaction directa
        // com sql template — usar BEGIN/COMMIT inline via execute)
        await db.execute(sql`begin`);
        try {
          // Shift right siblings na coluna alvo
          if (body.kanban_column_id !== null) {
            await db.execute(sql`
              update public.tasks
              set kanban_position = kanban_position + 1, updated_at = now()
              where kanban_column_id = ${body.kanban_column_id}::uuid
                and kanban_position >= ${body.kanban_position}
                and id != ${id}::uuid
            `);
          }

          // UPDATE task target
          await db.execute(sql`
            update public.tasks
            set kanban_column_id = ${body.kanban_column_id}::uuid,
                kanban_position = ${body.kanban_position},
                updated_at = now()
            where id = ${id}::uuid
          `);

          await db.execute(sql`commit`);
        } catch (txErr) {
          await db.execute(sql`rollback`);
          // Postgres unique constraint violation → 23505
          const message = txErr instanceof Error ? txErr.message : String(txErr);
          if (/unique|duplicate|23505/i.test(message)) {
            annotateSpan(span, { statusCode: 409 });
            return apiError('CONFLICT', 'Conflito ao mover tarefa — tenta novamente.', 409);
          }
          throw txErr;
        }

        // 6. Audit log (best-effort)
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

        // Fetch updated task to return
        const updatedRows = await db.execute(sql`
          select id, household_id, created_by_user_id, assigned_to_user_id, title, description,
                 due_date, due_time, priority, status, kanban_column_id, kanban_position,
                 project, recurrence_id, is_recurrence_template, completed_at, created_at, updated_at
          from public.tasks where id = ${id}::uuid limit 1
        `);

        annotateSpan(span, {
          statusCode: 200,
          extra: {
            'task.from_column_hash': current.kanban_column_id ? hashForCorrelation(current.kanban_column_id) : 'null',
            'task.to_column_hash': body.kanban_column_id ? hashForCorrelation(body.kanban_column_id) : 'null',
            'task.position_delta': body.kanban_position - current.kanban_position,
            'task.is_cross_column': isCrossColumn,
          },
        });
        return NextResponse.json({ task: updatedRows[0] });
      } catch (err) {
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
