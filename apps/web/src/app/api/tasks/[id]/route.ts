/**
 * GET / PATCH / DELETE /api/tasks/[id] — Story 3.2 AC1 + AC7-AC10.
 *
 * GET: Single task. RLS filtra. 404 se não existe ou cross-household.
 * PATCH: Update parcial Zod strict. household_id/created_by_user_id IMMUTABLE.
 * DELETE: Soft delete (DP2-3.2 A) — UPDATE status='archived'. Não hard delete.
 *
 * RLS (SEC-5 / ADR-003 Fase 4 Fatia A): a operação de domínio corre dentro de
 * `withHousehold` (2.ª rede, RLS activa). O filtro `household_id` (SEC-1, 1.ª rede)
 * MANTÉM-SE. GET é read-only (sem audit, sem `getDb`); PATCH/DELETE mantêm
 * `getDb()` só para o `insertAuditLog` best-effort FORA do `withHousehold` (PO-FIX-2).
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
import { TaskUpdateSchema } from '@/lib/api-schemas/tasks';
import { requireAuth } from '@/lib/api-helpers/auth';
import { insertAuditLog } from '@/lib/api-helpers/audit';
import { revalidateTaskViews } from '@/lib/api-helpers/revalidate';

const ROUTE = '/api/tasks/[id]';

interface RouteContext {
  params: Promise<{ id: string }>;
}

const UuidParam = z.string().uuid();

export async function GET(_req: NextRequest, ctx: RouteContext): Promise<NextResponse> {
  return withSpan(
    'GET /api/tasks/[id]',
    { method: 'GET', route: ROUTE },
    async (span): Promise<NextResponse> => {
      const log = childLogger({ route: ROUTE, method: 'GET' });
      const auth = await requireAuth(span);
      if (auth instanceof NextResponse) return auth;

      const { id } = await ctx.params;
      if (!UuidParam.safeParse(id).success) {
        annotateSpan(span, { statusCode: 400 });
        return apiError('VALIDATION_ERROR', 'ID de tarefa inválido.', 400);
      }
      annotateSpan(span, { extra: { 'task.id_hash': hashForCorrelation(id) } });

      try {
        const rows = await withHousehold(
          { userId: auth.userId, householdId: auth.householdId },
          (tx) =>
            tx.execute<{ id: string }>(sql`
              select id, household_id, created_by_user_id, assigned_to_user_id, title, description,
                     due_date, due_time, priority, status, kanban_column_id, kanban_position,
                     project, recurrence_id, is_recurrence_template, completed_at, created_at, updated_at
              from public.tasks
              where id = ${id}::uuid and household_id = ${auth.householdId}::uuid
              limit 1
            `),
        );

        const task = rows[0];
        if (!task) {
          annotateSpan(span, { statusCode: 404 });
          return apiError('NOT_FOUND', 'Tarefa não encontrada.', 404);
        }

        annotateSpan(span, { statusCode: 200 });
        return NextResponse.json({ task });
      } catch (err) {
        annotateSpan(span, { statusCode: 500 });
        log.error({ err }, 'GET /api/tasks/[id] falhou');
        captureException(err instanceof Error ? err : new Error(String(err)), {
          userId: auth.userId,
          route: ROUTE,
        });
        return apiError('INTERNAL_ERROR', 'Erro ao obter tarefa. Tenta novamente.', 500);
      }
    },
  );
}

export async function PATCH(req: NextRequest, ctx: RouteContext): Promise<NextResponse> {
  return withSpan(
    'PATCH /api/tasks/[id]',
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
        const raw = await req.json();
        body = TaskUpdateSchema.parse(raw);
      } catch (err) {
        annotateSpan(span, { statusCode: 400 });
        if (err instanceof z.ZodError) {
          return apiError('VALIDATION_ERROR', 'Dados inválidos.', 400, {
            issues: err.issues.map((i) => ({ path: i.path, message: i.message })),
          });
        }
        return apiError('VALIDATION_ERROR', 'Body inválido — JSON malformado.', 400);
      }

      // Detect transition to 'done' (audit event task.completed)
      const isCompletionUpdate = body.status === 'done';

      try {
        // PO-FIX-2: `getDb()` mantém-se para o `insertAuditLog` best-effort (abaixo).
        const db = getDb();

        // Build dynamic SET clause
        const sets = [];
        if (body.title !== undefined) sets.push(sql`title = ${body.title}`);
        if (body.description !== undefined) sets.push(sql`description = ${body.description}`);
        if (body.due_date !== undefined) sets.push(sql`due_date = ${body.due_date}::date`);
        if (body.due_time !== undefined) sets.push(sql`due_time = ${body.due_time}`);
        if (body.priority !== undefined) sets.push(sql`priority = ${body.priority}::task_priority`);
        if (body.status !== undefined) {
          sets.push(sql`status = ${body.status}::task_status`);
          if (body.status === 'done') sets.push(sql`completed_at = coalesce(completed_at, now())`);
        }
        if (body.kanban_column_id !== undefined) sets.push(sql`kanban_column_id = ${body.kanban_column_id}::uuid`);
        if (body.kanban_position !== undefined) sets.push(sql`kanban_position = ${body.kanban_position}`);
        if (body.project !== undefined) sets.push(sql`project = ${body.project}`);
        if (body.assigned_to_user_id !== undefined) sets.push(sql`assigned_to_user_id = ${body.assigned_to_user_id}::uuid`);
        if (body.completed_at !== undefined) sets.push(sql`completed_at = ${body.completed_at}::timestamptz`);

        if (sets.length === 0) {
          annotateSpan(span, { statusCode: 400 });
          return apiError('VALIDATION_ERROR', 'Nenhum campo fornecido para actualizar.', 400);
        }

        sets.push(sql`updated_at = now()`);
        const setSql = sets.reduce((acc, c, idx) => (idx === 0 ? c : sql`${acc}, ${c}`));

        const rows = await withHousehold(
          { userId: auth.userId, householdId: auth.householdId },
          (tx) =>
            tx.execute<{ id: string; status: string; title: string }>(sql`
              update public.tasks set ${setSql}
              where id = ${id}::uuid and household_id = ${auth.householdId}::uuid
              returning id, household_id, created_by_user_id, assigned_to_user_id, title, description,
                        due_date, due_time, priority, status, kanban_column_id, kanban_position,
                        project, recurrence_id, is_recurrence_template, completed_at, created_at, updated_at
            `),
        );

        const task = rows[0];
        if (!task) {
          annotateSpan(span, { statusCode: 404 });
          return apiError('NOT_FOUND', 'Tarefa não encontrada.', 404);
        }

        try {
          await insertAuditLog({
            db,
            householdId: auth.householdId,
            userId: auth.userId,
            action: isCompletionUpdate ? 'task.completed' : 'task.updated',
            entityTable: 'tasks',
            entityId: task.id,
            afterState: { status: task.status, title: task.title },
          });
        } catch (auditErr) {
          log.warn({ err: auditErr }, 'audit_log INSERT falhou (best-effort)');
        }

        // W2: invalida as vistas que dependem das tarefas (Visão + /tarefas).
        revalidateTaskViews();

        annotateSpan(span, { statusCode: 200 });
        return NextResponse.json({ task });
      } catch (err) {
        annotateSpan(span, { statusCode: 500 });
        log.error({ err }, 'PATCH /api/tasks/[id] falhou');
        captureException(err instanceof Error ? err : new Error(String(err)), {
          userId: auth.userId,
          route: ROUTE,
        });
        return apiError('INTERNAL_ERROR', 'Erro ao actualizar tarefa. Tenta novamente.', 500);
      }
    },
  );
}

export async function DELETE(_req: NextRequest, ctx: RouteContext): Promise<NextResponse> {
  return withSpan(
    'DELETE /api/tasks/[id]',
    { method: 'DELETE', route: ROUTE },
    async (span): Promise<NextResponse> => {
      const log = childLogger({ route: ROUTE, method: 'DELETE' });
      const auth = await requireAuth(span);
      if (auth instanceof NextResponse) return auth;

      const { id } = await ctx.params;
      if (!UuidParam.safeParse(id).success) {
        annotateSpan(span, { statusCode: 400 });
        return apiError('VALIDATION_ERROR', 'ID de tarefa inválido.', 400);
      }
      annotateSpan(span, { extra: { 'task.id_hash': hashForCorrelation(id) } });

      try {
        // PO-FIX-2: `getDb()` mantém-se para o `insertAuditLog` best-effort (abaixo).
        const db = getDb();
        // Soft delete: status='archived' (DP2-3.2 A — zero schema change)
        const rows = await withHousehold(
          { userId: auth.userId, householdId: auth.householdId },
          (tx) =>
            tx.execute<{ id: string }>(sql`
              update public.tasks
              set status = 'archived'::task_status, updated_at = now()
              where id = ${id}::uuid and household_id = ${auth.householdId}::uuid
              returning id
            `),
        );

        if (rows.length === 0) {
          annotateSpan(span, { statusCode: 404 });
          return apiError('NOT_FOUND', 'Tarefa não encontrada.', 404);
        }

        try {
          await insertAuditLog({
            db,
            householdId: auth.householdId,
            userId: auth.userId,
            action: 'task.deleted',
            entityTable: 'tasks',
            entityId: id,
          });
        } catch (auditErr) {
          log.warn({ err: auditErr }, 'audit_log INSERT falhou (best-effort)');
        }

        // W2: invalida as vistas que dependem das tarefas (Visão + /tarefas).
        revalidateTaskViews();

        annotateSpan(span, { statusCode: 200 });
        return NextResponse.json({ archived: true, id });
      } catch (err) {
        annotateSpan(span, { statusCode: 500 });
        log.error({ err }, 'DELETE /api/tasks/[id] falhou');
        captureException(err instanceof Error ? err : new Error(String(err)), {
          userId: auth.userId,
          route: ROUTE,
        });
        return apiError('INTERNAL_ERROR', 'Erro ao arquivar tarefa. Tenta novamente.', 500);
      }
    },
  );
}
