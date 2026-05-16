/**
 * GET / PATCH / DELETE /api/recurrences/[id] — Story 3.2 AC5 + AC7-AC10.
 *
 * GET: Single recurrence.
 * PATCH: Update — re-compute next_run_on se frequency/interval mudou via
 *   inline helper. F2 MEDIUM: frequency='custom' (custom_rrule) PATCH
 *   retorna 422 UNPROCESSABLE_ENTITY (deferred Story 3.7 quando rrule lib
 *   instalada per Epic plan ED7).
 * DELETE: Soft delete — UPDATE active=false (preserva data + tasks geradas).
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
import { getDb } from '@/lib/agent/db-shim';
import {
  RecurrenceUpdateSchema,
  computeNextRunOn,
  type recurrenceFrequencyValues,
} from '@/lib/api-schemas/recurrences';
import { requireAuth } from '@/lib/api-helpers/auth';
import { insertAuditLog } from '@/lib/api-helpers/audit';

const ROUTE = '/api/recurrences/[id]';
const UuidParam = z.string().uuid();

interface RouteContext {
  params: Promise<{ id: string }>;
}

export async function GET(_req: NextRequest, ctx: RouteContext): Promise<NextResponse> {
  return withSpan(
    'GET /api/recurrences/[id]',
    { method: 'GET', route: ROUTE },
    async (span): Promise<NextResponse> => {
      const log = childLogger({ route: ROUTE, method: 'GET' });
      const auth = await requireAuth(span);
      if (auth instanceof NextResponse) return auth;

      const { id } = await ctx.params;
      if (!UuidParam.safeParse(id).success) {
        annotateSpan(span, { statusCode: 400 });
        return apiError('VALIDATION_ERROR', 'ID inválido.', 400);
      }

      try {
        const db = getDb();
        const rows = await db.execute(sql`
          select id, household_id, template_task_id, frequency, interval, custom_rrule,
                 starts_on, ends_on, next_run_on, active, created_at, updated_at
          from public.task_recurrences where id = ${id}::uuid limit 1
        `);

        const recurrence = rows[0];
        if (!recurrence) {
          annotateSpan(span, { statusCode: 404 });
          return apiError('NOT_FOUND', 'Recorrência não encontrada.', 404);
        }

        annotateSpan(span, { statusCode: 200 });
        return NextResponse.json({ recurrence });
      } catch (err) {
        annotateSpan(span, { statusCode: 500 });
        log.error({ err }, 'GET /api/recurrences/[id] falhou');
        captureException(err instanceof Error ? err : new Error(String(err)), {
          userId: auth.userId,
          route: ROUTE,
        });
        return apiError('INTERNAL_ERROR', 'Erro ao obter recorrência.', 500);
      }
    },
  );
}

export async function PATCH(req: NextRequest, ctx: RouteContext): Promise<NextResponse> {
  return withSpan(
    'PATCH /api/recurrences/[id]',
    { method: 'PATCH', route: ROUTE },
    async (span): Promise<NextResponse> => {
      const log = childLogger({ route: ROUTE, method: 'PATCH' });
      const auth = await requireAuth(span);
      if (auth instanceof NextResponse) return auth;

      const { id } = await ctx.params;
      if (!UuidParam.safeParse(id).success) {
        annotateSpan(span, { statusCode: 400 });
        return apiError('VALIDATION_ERROR', 'ID inválido.', 400);
      }

      let body;
      try {
        body = RecurrenceUpdateSchema.parse(await req.json());
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
        const db = getDb();

        // SELECT current state para re-compute next_run_on
        const currentRows = await db.execute<{
          frequency: (typeof recurrenceFrequencyValues)[number];
          interval: number;
          next_run_on: string | null;
          starts_on: string;
        }>(sql`
          select frequency, interval, next_run_on, starts_on
          from public.task_recurrences where id = ${id}::uuid limit 1
        `);

        const current = currentRows[0];
        if (!current) {
          annotateSpan(span, { statusCode: 404 });
          return apiError('NOT_FOUND', 'Recorrência não encontrada.', 404);
        }

        // F2 MEDIUM: frequency='custom' PATCH re-compute deferred Story 3.7
        const newFrequency = body.frequency ?? current.frequency;
        const newInterval = body.interval ?? current.interval;
        const frequencyChanged = body.frequency !== undefined && body.frequency !== current.frequency;
        const intervalChanged = body.interval !== undefined && body.interval !== current.interval;

        if (frequencyChanged || intervalChanged) {
          if (newFrequency === 'custom') {
            annotateSpan(span, { statusCode: 422 });
            return apiError(
              'UNPROCESSABLE_ENTITY',
              'Re-cálculo de recorrência personalizada (RRULE iCal) disponível apenas a partir da Story 3.7.',
              422,
            );
          }
        }

        const sets = [];
        if (body.frequency !== undefined) sets.push(sql`frequency = ${body.frequency}::recurrence_frequency`);
        if (body.interval !== undefined) sets.push(sql`interval = ${body.interval}`);
        if (body.custom_rrule !== undefined) sets.push(sql`custom_rrule = ${body.custom_rrule}`);
        if (body.starts_on !== undefined) sets.push(sql`starts_on = ${body.starts_on}::date`);
        if (body.ends_on !== undefined) sets.push(sql`ends_on = ${body.ends_on}::date`);
        if (body.active !== undefined) sets.push(sql`active = ${body.active}`);

        // Re-compute next_run_on se preset frequency/interval mudou
        if ((frequencyChanged || intervalChanged) && newFrequency !== 'custom') {
          const baseDate = current.next_run_on ? new Date(current.next_run_on) : new Date(current.starts_on);
          const nextRun = computeNextRunOn(newFrequency, newInterval, baseDate);
          if (nextRun) {
            const isoDate = nextRun.toISOString().slice(0, 10);
            sets.push(sql`next_run_on = ${isoDate}::date`);
          }
        }

        if (sets.length === 0) {
          annotateSpan(span, { statusCode: 400 });
          return apiError('VALIDATION_ERROR', 'Nenhum campo fornecido para actualizar.', 400);
        }

        sets.push(sql`updated_at = now()`);
        const setSql = sets.reduce((acc, c, idx) => (idx === 0 ? c : sql`${acc}, ${c}`));

        const rows = await db.execute<{ id: string }>(sql`
          update public.task_recurrences set ${setSql} where id = ${id}::uuid
          returning id, household_id, template_task_id, frequency, interval, custom_rrule,
                    starts_on, ends_on, next_run_on, active, created_at, updated_at
        `);

        const recurrence = rows[0];
        if (!recurrence) {
          annotateSpan(span, { statusCode: 404 });
          return apiError('NOT_FOUND', 'Recorrência não encontrada.', 404);
        }

        try {
          await insertAuditLog({
            db,
            householdId: auth.householdId,
            userId: auth.userId,
            action: 'recurrence.updated',
            entityTable: 'task_recurrences',
            entityId: recurrence.id,
          });
        } catch (auditErr) {
          log.warn({ err: auditErr }, 'audit_log INSERT falhou (best-effort)');
        }

        annotateSpan(span, { statusCode: 200 });
        return NextResponse.json({ recurrence });
      } catch (err) {
        annotateSpan(span, { statusCode: 500 });
        log.error({ err }, 'PATCH /api/recurrences/[id] falhou');
        captureException(err instanceof Error ? err : new Error(String(err)), {
          userId: auth.userId,
          route: ROUTE,
        });
        return apiError('INTERNAL_ERROR', 'Erro ao actualizar recorrência.', 500);
      }
    },
  );
}

export async function DELETE(_req: NextRequest, ctx: RouteContext): Promise<NextResponse> {
  return withSpan(
    'DELETE /api/recurrences/[id]',
    { method: 'DELETE', route: ROUTE },
    async (span): Promise<NextResponse> => {
      const log = childLogger({ route: ROUTE, method: 'DELETE' });
      const auth = await requireAuth(span);
      if (auth instanceof NextResponse) return auth;

      const { id } = await ctx.params;
      if (!UuidParam.safeParse(id).success) {
        annotateSpan(span, { statusCode: 400 });
        return apiError('VALIDATION_ERROR', 'ID inválido.', 400);
      }

      try {
        const db = getDb();
        // Soft delete: active=false (preserva tasks geradas)
        const rows = await db.execute<{ id: string }>(sql`
          update public.task_recurrences set active = false, updated_at = now()
          where id = ${id}::uuid returning id
        `);

        if (rows.length === 0) {
          annotateSpan(span, { statusCode: 404 });
          return apiError('NOT_FOUND', 'Recorrência não encontrada.', 404);
        }

        try {
          await insertAuditLog({
            db,
            householdId: auth.householdId,
            userId: auth.userId,
            action: 'recurrence.deleted',
            entityTable: 'task_recurrences',
            entityId: id,
          });
        } catch (auditErr) {
          log.warn({ err: auditErr }, 'audit_log INSERT falhou (best-effort)');
        }

        annotateSpan(span, { statusCode: 200 });
        return NextResponse.json({ deactivated: true, id });
      } catch (err) {
        annotateSpan(span, { statusCode: 500 });
        log.error({ err }, 'DELETE /api/recurrences/[id] falhou');
        captureException(err instanceof Error ? err : new Error(String(err)), {
          userId: auth.userId,
          route: ROUTE,
        });
        return apiError('INTERNAL_ERROR', 'Erro ao desactivar recorrência.', 500);
      }
    },
  );
}
