/**
 * GET / POST /api/recurrences — Story 3.2 AC5 + AC7-AC10.
 *
 * GET: List per household. Filters: active, frequency.
 * POST: Create — Atomicidade transacção: (1) INSERT task template se
 *   template_task_id null; (2) INSERT recurrence + computar next_run_on.
 *
 * RLS (SEC-5 / ADR-003 Fase 4 Fatia A): GET é read-only (sem audit, sem `getDb`);
 * o POST corre as 2 escritas (template task + recurrence) no MESMO `withHousehold`
 * (2.ª rede + atomicidade — substitui o `begin/commit` inline). O filtro
 * `household_id` (SEC-1, 1.ª rede) MANTÉM-SE. O `insertAuditLog` permanece
 * best-effort FORA do `withHousehold` em `getDb()` (PO-FIX-2 / D-SEC3).
 */
import { sql } from 'drizzle-orm';
import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';

import {
  annotateSpan,
  captureException,
  childLogger,
  withSpan,
} from '@meu-jarvis/observability';

import { apiError } from '@/lib/errors';
import { getDb, withHousehold } from '@/lib/agent/db-shim';
import {
  RecurrenceCreateSchema,
  RecurrenceFiltersSchema,
} from '@/lib/api-schemas/recurrences';
import { requireAuth } from '@/lib/api-helpers/auth';
import { insertAuditLog } from '@/lib/api-helpers/audit';

const ROUTE = '/api/recurrences';

interface RecurrenceRow {
  id: string;
  household_id: string;
  template_task_id: string;
  frequency: string;
  interval: number;
  custom_rrule: string | null;
  starts_on: string;
  ends_on: string | null;
  next_run_on: string | null;
  active: boolean;
  created_at: string;
  updated_at: string;
}

export async function GET(req: NextRequest): Promise<NextResponse> {
  return withSpan(
    'GET /api/recurrences',
    { method: 'GET', route: ROUTE },
    async (span): Promise<NextResponse> => {
      const log = childLogger({ route: ROUTE, method: 'GET' });
      const auth = await requireAuth(span);
      if (auth instanceof NextResponse) return auth;

      let filters;
      try {
        filters = RecurrenceFiltersSchema.parse(
          Object.fromEntries(req.nextUrl.searchParams.entries()),
        );
      } catch (err) {
        annotateSpan(span, { statusCode: 400 });
        if (err instanceof z.ZodError) {
          return apiError('VALIDATION_ERROR', 'Parâmetros inválidos.', 400, {
            issues: err.issues.map((i) => ({ path: i.path, message: i.message })),
          });
        }
        return apiError('VALIDATION_ERROR', 'Parâmetros inválidos.', 400);
      }

      try {
        const conditions = [sql`household_id = ${auth.householdId}::uuid`];
        if (filters.active !== undefined) conditions.push(sql`active = ${filters.active}`);
        if (filters.frequency) conditions.push(sql`frequency = ${filters.frequency}::recurrence_frequency`);
        const whereSql = conditions.reduce((acc, c, idx) => (idx === 0 ? c : sql`${acc} and ${c}`));

        const recurrences = await withHousehold(
          { userId: auth.userId, householdId: auth.householdId },
          (tx) =>
            tx.execute<RecurrenceRow>(sql`
              select id, household_id, template_task_id, frequency, interval, custom_rrule,
                     starts_on, ends_on, next_run_on, active, created_at, updated_at
              from public.task_recurrences where ${whereSql}
              order by next_run_on asc nulls last, created_at desc
              limit ${filters.limit}
            `),
        );

        annotateSpan(span, { statusCode: 200 });
        return NextResponse.json({ recurrences });
      } catch (err) {
        annotateSpan(span, { statusCode: 500 });
        log.error({ err }, 'GET /api/recurrences falhou');
        captureException(err instanceof Error ? err : new Error(String(err)), {
          userId: auth.userId,
          route: ROUTE,
        });
        return apiError('INTERNAL_ERROR', 'Erro ao listar recorrências.', 500);
      }
    },
  );
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  return withSpan(
    'POST /api/recurrences',
    { method: 'POST', route: ROUTE },
    async (span): Promise<NextResponse> => {
      const log = childLogger({ route: ROUTE, method: 'POST' });
      const auth = await requireAuth(span);
      if (auth instanceof NextResponse) return auth;

      let body;
      try {
        body = RecurrenceCreateSchema.parse(await req.json());
      } catch (err) {
        annotateSpan(span, { statusCode: 400 });
        if (err instanceof z.ZodError) {
          return apiError('VALIDATION_ERROR', 'Dados inválidos.', 400, {
            issues: err.issues.map((i) => ({ path: i.path, message: i.message })),
          });
        }
        return apiError('VALIDATION_ERROR', 'Body inválido.', 400);
      }

      try {
        // PO-FIX-2: `getDb()` mantém-se para o `insertAuditLog` best-effort (abaixo).
        const db = getDb();

        // SEC-5: as 2 escritas (template task + recurrence) correm no MESMO
        // `withHousehold` (atomicidade — substitui o `begin/commit` inline).
        const recurrence = await withHousehold(
          { userId: auth.userId, householdId: auth.householdId },
          async (tx): Promise<RecurrenceRow> => {
            let templateTaskId = body.template_task_id ?? null;

            // (1) INSERT task template se não fornecido
            if (!templateTaskId) {
              const taskRows = await tx.execute<{ id: string }>(sql`
                insert into public.tasks (
                  household_id, created_by_user_id, title, status, is_recurrence_template
                )
                values (
                  ${auth.householdId}::uuid,
                  ${auth.userId}::uuid,
                  ${body.title!},
                  'todo'::task_status,
                  true
                )
                returning id
              `);
              templateTaskId = taskRows[0]?.id ?? null;
              if (!templateTaskId) throw new Error('INSERT task template retornou sem rows.');
            }

            // (2) INSERT recurrence + next_run_on = starts_on
            const recRows = await tx.execute<RecurrenceRow>(sql`
              insert into public.task_recurrences (
                household_id, template_task_id, frequency, interval, custom_rrule,
                starts_on, ends_on, next_run_on, active
              )
              values (
                ${auth.householdId}::uuid,
                ${templateTaskId}::uuid,
                ${body.frequency}::recurrence_frequency,
                ${body.interval},
                ${body.custom_rrule ?? null},
                ${body.starts_on}::date,
                ${body.ends_on ?? null}::date,
                ${body.starts_on}::date,
                true
              )
              returning id, household_id, template_task_id, frequency, interval, custom_rrule,
                        starts_on, ends_on, next_run_on, active, created_at, updated_at
            `);

            const rec = recRows[0];
            if (!rec) throw new Error('INSERT recurrence retornou sem rows.');
            return rec;
          },
        );

        try {
          await insertAuditLog({
            db,
            householdId: auth.householdId,
            userId: auth.userId,
            action: 'recurrence.created',
            entityTable: 'task_recurrences',
            entityId: recurrence.id,
            afterState: {
              frequency: recurrence.frequency,
              interval: recurrence.interval,
              starts_on: recurrence.starts_on,
            },
          });
        } catch (auditErr) {
          log.warn({ err: auditErr }, 'audit_log INSERT falhou (best-effort)');
        }

        annotateSpan(span, { statusCode: 201 });
        return NextResponse.json({ recurrence }, { status: 201 });
      } catch (err) {
        annotateSpan(span, { statusCode: 500 });
        log.error({ err }, 'POST /api/recurrences falhou');
        captureException(err instanceof Error ? err : new Error(String(err)), {
          userId: auth.userId,
          route: ROUTE,
        });
        return apiError('INTERNAL_ERROR', 'Erro ao criar recorrência.', 500);
      }
    },
  );
}
