/**
 * GET / POST /api/tasks — Story 3.2 AC1 + AC6 + AC7 + AC8 + AC10.
 *
 * GET:
 *   - List paginado cursor-based (default limit=50, max 100).
 *   - Filters: status, tag_id, due_date_from/to, kanban_column_id,
 *     assigned_to_user_id, project (ILIKE), priority.
 *   - Order: due_date asc nulls last, id asc (stable cursor).
 *
 * POST:
 *   - Cria tarefa. household_id injectado via JWT (NÃO aceito em payload — AC8).
 *   - created_by_user_id = user.id do JWT (immutable post-POST).
 *   - Audit log INSERT (task.created).
 *
 * RLS: getDb() role authenticated — RLS filtra automaticamente via JWT.
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
import { TaskCreateSchema, TaskFiltersSchema } from '@/lib/api-schemas/tasks';
import { encodeCursor, decodeCursor } from '@/lib/api-schemas/pagination';
import { requireAuth } from '@/lib/api-helpers/auth';
import { insertAuditLog } from '@/lib/api-helpers/audit';

const ROUTE = '/api/tasks';

interface TaskRow {
  id: string;
  household_id: string;
  created_by_user_id: string;
  assigned_to_user_id: string | null;
  title: string;
  description: string | null;
  due_date: string | null;
  due_time: string | null;
  priority: string;
  status: string;
  kanban_column_id: string | null;
  kanban_position: number;
  project: string | null;
  recurrence_id: string | null;
  is_recurrence_template: boolean;
  completed_at: string | null;
  created_at: string;
  updated_at: string;
}

export async function GET(req: NextRequest): Promise<NextResponse> {
  return withSpan(
    'GET /api/tasks',
    { method: 'GET', route: ROUTE },
    async (span): Promise<NextResponse> => {
      const log = childLogger({ route: ROUTE, method: 'GET' });
      const auth = await requireAuth(span);
      if (auth instanceof NextResponse) return auth;

      // Parse query params
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

      // Decode cursor
      let cursorPayload = null;
      if (filters.cursor) {
        cursorPayload = decodeCursor(filters.cursor);
        if (!cursorPayload) {
          annotateSpan(span, { statusCode: 400 });
          return apiError('VALIDATION_ERROR', 'Cursor de paginação inválido.', 400);
        }
      }

      try {
        const db = getDb();
        const limitPlusOne = filters.limit + 1;

        // Build dynamic WHERE conditions (RLS via JWT já filtra household_id)
        const conditions = [sql`1=1`];
        if (filters.status) conditions.push(sql`status = ${filters.status}`);
        if (filters.priority) conditions.push(sql`priority = ${filters.priority}`);
        if (filters.kanban_column_id) conditions.push(sql`kanban_column_id = ${filters.kanban_column_id}::uuid`);
        if (filters.assigned_to_user_id) conditions.push(sql`assigned_to_user_id = ${filters.assigned_to_user_id}::uuid`);
        if (filters.project) conditions.push(sql`project ilike ${'%' + filters.project + '%'}`);
        if (filters.due_date_from) conditions.push(sql`due_date >= ${filters.due_date_from}::date`);
        if (filters.due_date_to) conditions.push(sql`due_date <= ${filters.due_date_to}::date`);
        if (filters.tag_id) {
          conditions.push(sql`id in (select task_id from public.task_tags where tag_id = ${filters.tag_id}::uuid)`);
        }
        if (cursorPayload) {
          // Cursor pagination: (due_date, id) > (last_due_date, last_id), nulls last
          if (cursorPayload.last_due_date) {
            conditions.push(sql`(due_date, id) > (${cursorPayload.last_due_date}::date, ${cursorPayload.last_id}::uuid)`);
          } else {
            conditions.push(sql`(due_date is null and id > ${cursorPayload.last_id}::uuid)`);
          }
        }

        const whereSql = conditions.reduce((acc, c, idx) => (idx === 0 ? c : sql`${acc} and ${c}`));

        const rows = await db.execute<TaskRow>(sql`
          select id, household_id, created_by_user_id, assigned_to_user_id, title, description,
                 due_date, due_time, priority, status, kanban_column_id, kanban_position,
                 project, recurrence_id, is_recurrence_template, completed_at, created_at, updated_at
          from public.tasks
          where ${whereSql}
          order by due_date asc nulls last, id asc
          limit ${limitPlusOne}
        `);

        let nextCursor: string | null = null;
        let tasks = rows;
        if (rows.length === limitPlusOne) {
          tasks = rows.slice(0, filters.limit);
          const last = tasks[tasks.length - 1];
          if (last) {
            nextCursor = encodeCursor({ last_due_date: last.due_date, last_id: last.id });
          }
        }

        annotateSpan(span, { statusCode: 200 });
        log.info(
          { user_hash: hashForCorrelation(auth.userId), count: tasks.length },
          'GET /api/tasks OK',
        );
        return NextResponse.json({ tasks, next_cursor: nextCursor });
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
        const db = getDb();
        const rows = await db.execute<TaskRow>(sql`
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
        `);

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
