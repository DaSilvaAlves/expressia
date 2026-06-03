/**
 * GET / POST /api/tasks — Story 3.2 AC1 + AC6 + AC7 + AC8 + AC10 + Story 3.3 (sort).
 *
 * GET:
 *   - List paginado cursor-based (default limit=50, max 100).
 *   - Filters: status, tag_id, due_date_from/to, kanban_column_id,
 *     assigned_to_user_id, project (ILIKE), priority.
 *   - Sort (Story 3.3 DP5-3.3 A): `due_date_asc` (default) | `created_at_desc` |
 *     `priority_desc` | `title_asc`. Cursor optimal só para default.
 *   - Story 3.3 DP4-3.3 (A extract): SELECT logic delegada a `listTasksHelper`
 *     em `@/lib/api-helpers/list-tasks`. Wrapper apenas faz auth + Zod + cursor
 *     decode + chamada ao helper (G5: decode no wrapper HTTP-bound).
 *
 * POST:
 *   - Cria tarefa. household_id injectado via JWT (NÃO aceito em payload — AC8).
 *   - created_by_user_id = user.id do JWT (immutable post-POST).
 *   - Audit log INSERT (task.created).
 *
 * RLS (SEC-2 GET / SEC-5 POST — ADR-003 Fase 4 Fatia A): a operação de domínio
 * corre dentro de `withHousehold`, que abre uma transação com
 * `SET LOCAL ROLE authenticated` + JWT claims — activa as 104 RLS policies
 * (2.ª rede). O filtro `household_id` explícito (SEC-1, 1.ª rede) MANTÉM-SE em
 * todas as queries — defense-in-depth. No POST o `insertAuditLog` permanece
 * best-effort FORA do `withHousehold` em `getDb()` (PO-FIX-2 / D-SEC3).
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
import { listTasksHelper, type TaskRow } from '@/lib/api-helpers/list-tasks';
import { TaskCreateSchema, TaskFiltersSchema } from '@/lib/api-schemas/tasks';
import { decodeCursor } from '@/lib/api-schemas/pagination';
import { requireAuth } from '@/lib/api-helpers/auth';
import { insertAuditLog } from '@/lib/api-helpers/audit';

const ROUTE = '/api/tasks';

/**
 * Re-export para back-compat com consumidores que importavam `TaskRow` de
 * `@/app/api/tasks/route` antes do extract (Story 3.3 DP4 G2 — single source-of-truth).
 */
export type { TaskRow };

export async function GET(req: NextRequest): Promise<NextResponse> {
  return withSpan(
    'GET /api/tasks',
    { method: 'GET', route: ROUTE },
    async (span): Promise<NextResponse> => {
      const log = childLogger({ route: ROUTE, method: 'GET' });
      const auth = await requireAuth(span);
      if (auth instanceof NextResponse) return auth;

      // Parse query params via Zod
      const searchParams = Object.fromEntries(req.nextUrl.searchParams.entries());
      let filters;
      try {
        filters = TaskFiltersSchema.parse(searchParams);
      } catch (err) {
        annotateSpan(span, { statusCode: 400 });
        if (err instanceof z.ZodError) {
          return apiError('VALIDATION_ERROR', 'Parâmetros de filtro inválidos.', 400, {
            issues: err.issues.map((i) => ({ path: i.path, message: i.message })),
          });
        }
        return apiError('VALIDATION_ERROR', 'Parâmetros inválidos.', 400);
      }

      // Decode cursor (G5 — HTTP-bound concern; helper recebe payload já decoded)
      let cursorPayload = null;
      if (filters.cursor) {
        cursorPayload = decodeCursor(filters.cursor);
        if (!cursorPayload) {
          annotateSpan(span, { statusCode: 400 });
          return apiError('VALIDATION_ERROR', 'Cursor de paginação inválido.', 400);
        }
      }

      try {
        // SEC-2 / ADR-003 Fase 1 (piloto): a listagem corre dentro de
        // `withHousehold`, que abre uma transação com `SET LOCAL ROLE authenticated`
        // + JWT claims — activa as 104 RLS policies (2.ª rede). O filtro
        // `household_id` explícito em `list-tasks.ts:125` (SEC-1, 1.ª rede) MANTÉM-SE
        // dentro do helper — defense-in-depth, não substituído.
        const { tasks, next_cursor } = await withHousehold(
          { userId: auth.userId, householdId: auth.householdId },
          (tx) =>
            listTasksHelper({
              filters,
              cursorPayload,
              householdId: auth.householdId,
              userId: auth.userId,
              db: tx,
            }),
        );

        annotateSpan(span, { statusCode: 200 });
        log.info(
          { user_hash: hashForCorrelation(auth.userId), count: tasks.length },
          'GET /api/tasks OK',
        );
        return NextResponse.json({ tasks, next_cursor });
      } catch (err) {
        annotateSpan(span, { statusCode: 500 });
        log.error({ err }, 'GET /api/tasks falhou');
        captureException(err instanceof Error ? err : new Error(String(err)), {
          userId: auth.userId,
          route: ROUTE,
        });
        return apiError('INTERNAL_ERROR', 'Erro ao listar tarefas. Tenta novamente.', 500);
      }
    },
  );
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  return withSpan(
    'POST /api/tasks',
    { method: 'POST', route: ROUTE },
    async (span): Promise<NextResponse> => {
      const log = childLogger({ route: ROUTE, method: 'POST' });
      const auth = await requireAuth(span);
      if (auth instanceof NextResponse) return auth;

      let body;
      try {
        const raw = await req.json();
        body = TaskCreateSchema.parse(raw);
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
        // Operação principal (INSERT) dentro de `withHousehold` (RLS-enforced, 2.ª rede).
        const rows = await withHousehold(
          { userId: auth.userId, householdId: auth.householdId },
          (tx) =>
            tx.execute<TaskRow>(sql`
              insert into public.tasks (
                household_id, created_by_user_id, assigned_to_user_id,
                title, description, due_date, due_time, priority, status,
                kanban_column_id, kanban_position, project
              )
              values (
                ${auth.householdId}::uuid,
                ${auth.userId}::uuid,
                ${body.assigned_to_user_id ?? null}::uuid,
                ${body.title},
                ${body.description ?? null},
                ${body.due_date ?? null}::date,
                ${body.due_time ?? null},
                ${body.priority ?? 'medium'}::task_priority,
                ${body.status ?? 'todo'}::task_status,
                ${body.kanban_column_id ?? null}::uuid,
                ${body.kanban_position ?? 0},
                ${body.project ?? null}
              )
              returning id, household_id, created_by_user_id, assigned_to_user_id, title, description,
                        due_date, due_time, priority, status, kanban_column_id, kanban_position,
                        project, recurrence_id, is_recurrence_template, completed_at, created_at, updated_at
            `),
        );

        const task = rows[0];
        if (!task) {
          throw new Error('INSERT tasks retornou sem rows — RLS bloqueou?');
        }

        // Audit log best-effort
        try {
          await insertAuditLog({
            db,
            householdId: auth.householdId,
            userId: auth.userId,
            action: 'task.created',
            entityTable: 'tasks',
            entityId: task.id,
            afterState: { title: task.title, status: task.status, priority: task.priority },
          });
        } catch (auditErr) {
          log.warn({ err: auditErr, task_id_hash: hashForCorrelation(task.id) }, 'audit_log INSERT falhou (best-effort)');
        }

        annotateSpan(span, {
          statusCode: 201,
          extra: { 'task.id_hash': hashForCorrelation(task.id) },
        });
        log.info(
          { user_hash: hashForCorrelation(auth.userId), task_id_hash: hashForCorrelation(task.id) },
          'POST /api/tasks OK',
        );
        return NextResponse.json({ task }, { status: 201 });
      } catch (err) {
        annotateSpan(span, { statusCode: 500 });
        log.error({ err }, 'POST /api/tasks falhou');
        captureException(err instanceof Error ? err : new Error(String(err)), {
          userId: auth.userId,
          route: ROUTE,
        });
        return apiError('INTERNAL_ERROR', 'Erro ao criar tarefa. Tenta novamente.', 500);
      }
    },
  );
}
