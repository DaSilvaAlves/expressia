/**
 * /api/conta/delete — Story 6.9 (Eliminação de conta self-service, GDPR Art. 17).
 *
 * Métodos:
 *   - POST   → agendar eliminação (`status='scheduled'`, `scheduled_for=now()+30d`).
 *   - DELETE → revogar a eliminação agendada (`status='canceled'`).
 *   - GET    → estado actual da eliminação (`{ job: null }` ou `{ job: DTO }`).
 *
 * App single-user (pivot 19/06/2026): o utilizador autenticado é sempre o owner
 * do seu household. Não há lógica de múltiplos membros nem transferência de posse.
 *
 * RLS / cliente DB (AC8 + PO-FIX-1):
 *   - Toda a interacção com `account_deletion_jobs` usa `getDb()` (role
 *     `authenticated`). Em runtime, o `getDb()` via postgres-js cru corre com
 *     `auth.uid()=NULL`, pelo que as RLS policies ficam INERTES como 1.ª rede; o
 *     isolamento real vem do FILTRO EXPLÍCITO `household_id = ${auth.householdId}`
 *     em TODOS os SELECT/INSERT/UPDATE (padrão app-enforced SEC-1→8 / Story 6.8).
 *     A policy `account_deletion_jobs_*_owner` é a 2.ª rede.
 *   - O UPDATE de cancelamento usa `getDb()` (policy `_update_owner` permite-o
 *     para `authenticated`), filtrado por `household_id` (T1.1).
 *
 * Audit (NFR9 / AC7): helper dedicado `insertAccountDeletionAuditLog` (PO-FIX-2)
 * — o `insertAuditLog` genérico não cobre as acções `account_deletion_*`.
 *
 * Trace: Story 6.9 AC1/AC2/AC3/AC7/AC8; `0001_rls_policies.sql:606-654`;
 *        `packages/db/src/schema/audit.ts:214-242`; FR29; NFR9; NFR5.
 */
import { sql } from 'drizzle-orm';
import { NextResponse } from 'next/server';

import {
  annotateSpan,
  captureException,
  childLogger,
  hashForCorrelation,
  withSpan,
} from '@meu-jarvis/observability';

import { getDb } from '@/lib/agent/db-shim';
import { requireAuth } from '@/lib/api-helpers/auth';
import type {
  AccountDeletionJobDTO,
  CancelDeletionResponseDTO,
  DeletionStatusResponseDTO,
  ScheduleDeletionResponseDTO,
} from '@/lib/api-schemas/account-deletion';
import { apiError } from '@/lib/errors';
import { insertAccountDeletionAuditLog } from '@/lib/gdpr/account-deletion-audit';

const ROUTE = '/api/conta/delete';

/** Dias do período de revogação antes do purge real (AC1). */
const DELETION_GRACE_DAYS = 30;

interface JobIdRow {
  readonly id: string;
}

interface JobStatusRow {
  readonly id: string;
  readonly status: string;
  readonly scheduled_for: string;
  readonly created_at: string;
}

/** Normaliza o resultado de `postgres-js` para um array de rows. */
function asRows<T>(result: unknown): T[] {
  return Array.isArray(result) ? (result as T[]) : [];
}

/**
 * POST /api/conta/delete — agendar eliminação de conta (AC1).
 *
 * Responses: 200 `ScheduleDeletionResponseDTO` · 401 · 404 · 409 · 500.
 */
export async function POST(): Promise<NextResponse> {
  return withSpan(
    'POST /api/conta/delete',
    { method: 'POST', route: ROUTE },
    async (span): Promise<NextResponse> => {
      const log = childLogger({ route: ROUTE, method: 'POST' });
      const auth = await requireAuth(span);
      if (auth instanceof NextResponse) return auth;

      const db = getDb();

      // 1. Job duplicado (`scheduled`) → 409. Filtro household_id explícito (PO-FIX-1).
      try {
        const existing = asRows<JobIdRow>(
          await db.execute<JobIdRow>(sql`
            select id
            from public.account_deletion_jobs
            where household_id = ${auth.householdId}::uuid
              and status = 'scheduled'
            limit 1
          `),
        );
        if (existing[0]) {
          annotateSpan(span, { statusCode: 409 });
          return apiError(
            'DELETION_ALREADY_SCHEDULED',
            'Já tens uma eliminação de conta agendada. Podes cancelá-la na página da tua conta.',
            409,
          );
        }
      } catch (err) {
        annotateSpan(span, { statusCode: 500 });
        log.error({ err }, 'POST /api/conta/delete — verificação de duplicado falhou');
        captureException(err instanceof Error ? err : new Error(String(err)), {
          userId: auth.userId,
          route: ROUTE,
        });
        return apiError('INTERNAL_ERROR', 'Erro ao agendar a eliminação. Tenta novamente.', 500);
      }

      // 2. INSERT job (`scheduled`, scheduled_for = now()+30d). Filtro implícito
      //    pelo household_id/requested_by_user_id explícitos do JWT (PO-FIX-1).
      let jobId: string;
      let scheduledFor: string;
      try {
        const inserted = asRows<{ id: string; scheduled_for: string }>(
          await db.execute<{ id: string; scheduled_for: string }>(sql`
            insert into public.account_deletion_jobs (
              household_id, requested_by_user_id, status, scheduled_for
            )
            values (
              ${auth.householdId}::uuid,
              ${auth.userId}::uuid,
              'scheduled',
              now() + (${DELETION_GRACE_DAYS} || ' days')::interval
            )
            returning id, scheduled_for
          `),
        );
        const row = inserted[0];
        if (!row) {
          annotateSpan(span, { statusCode: 500 });
          return apiError('INTERNAL_ERROR', 'Erro ao criar o pedido de eliminação.', 500);
        }
        jobId = row.id;
        scheduledFor = new Date(row.scheduled_for).toISOString();
      } catch (err) {
        annotateSpan(span, { statusCode: 500 });
        log.error({ err }, 'POST /api/conta/delete — INSERT do job falhou');
        captureException(err instanceof Error ? err : new Error(String(err)), {
          userId: auth.userId,
          route: ROUTE,
        });
        return apiError('INTERNAL_ERROR', 'Erro ao agendar a eliminação. Tenta novamente.', 500);
      }

      // 3. Audit account_deletion_requested (best-effort).
      try {
        await insertAccountDeletionAuditLog({
          db,
          householdId: auth.householdId,
          userId: auth.userId,
          action: 'account_deletion_requested',
          jobId,
        });
      } catch (auditErr) {
        log.warn({ err: auditErr }, 'audit_log account_deletion_requested falhou (best-effort)');
      }

      annotateSpan(span, { statusCode: 200 });
      log.info(
        {
          user_hash: hashForCorrelation(auth.userId),
          household_id: auth.householdId,
          action: 'account_deletion_requested',
        },
        'POST /api/conta/delete OK',
      );

      const body: ScheduleDeletionResponseDTO = { jobId, scheduledFor };
      return NextResponse.json(body);
    },
  );
}

/**
 * DELETE /api/conta/delete — revogar a eliminação agendada (AC2).
 *
 * Responses: 200 `CancelDeletionResponseDTO` · 401 · 404 · 500.
 */
export async function DELETE(): Promise<NextResponse> {
  return withSpan(
    'DELETE /api/conta/delete',
    { method: 'DELETE', route: ROUTE },
    async (span): Promise<NextResponse> => {
      const log = childLogger({ route: ROUTE, method: 'DELETE' });
      const auth = await requireAuth(span);
      if (auth instanceof NextResponse) return auth;

      const db = getDb();

      // 1. UPDATE `scheduled` → `canceled` directo, filtrado por household_id
      //    explícito (PO-FIX-1). RETURNING garante 404 se nenhuma row coincidiu
      //    (sem job agendado). A policy `_update_owner` é 2.ª rede.
      let jobId: string;
      let canceledAt: string;
      try {
        const updated = asRows<{ id: string; canceled_at: string }>(
          await db.execute<{ id: string; canceled_at: string }>(sql`
            update public.account_deletion_jobs
            set status = 'canceled',
                canceled_at = now(),
                canceled_by_user_id = ${auth.userId}::uuid
            where household_id = ${auth.householdId}::uuid
              and status = 'scheduled'
            returning id, canceled_at
          `),
        );
        const row = updated[0];
        if (!row) {
          annotateSpan(span, { statusCode: 404 });
          return apiError(
            'DELETION_NOT_SCHEDULED',
            'Não tens nenhuma eliminação de conta agendada.',
            404,
          );
        }
        jobId = row.id;
        canceledAt = new Date(row.canceled_at).toISOString();
      } catch (err) {
        annotateSpan(span, { statusCode: 500 });
        log.error({ err }, 'DELETE /api/conta/delete — UPDATE de cancelamento falhou');
        captureException(err instanceof Error ? err : new Error(String(err)), {
          userId: auth.userId,
          route: ROUTE,
        });
        return apiError('INTERNAL_ERROR', 'Erro ao cancelar a eliminação. Tenta novamente.', 500);
      }

      // 2. Audit account_deletion_canceled (best-effort).
      try {
        await insertAccountDeletionAuditLog({
          db,
          householdId: auth.householdId,
          userId: auth.userId,
          action: 'account_deletion_canceled',
          jobId,
        });
      } catch (auditErr) {
        log.warn({ err: auditErr }, 'audit_log account_deletion_canceled falhou (best-effort)');
      }

      annotateSpan(span, { statusCode: 200 });
      log.info(
        {
          user_hash: hashForCorrelation(auth.userId),
          household_id: auth.householdId,
          action: 'account_deletion_canceled',
        },
        'DELETE /api/conta/delete OK',
      );

      const body: CancelDeletionResponseDTO = { jobId, canceledAt };
      return NextResponse.json(body);
    },
  );
}

/**
 * GET /api/conta/delete — estado da eliminação agendada (AC3).
 *
 * Responses: 200 `DeletionStatusResponseDTO` · 401 · 404 · 500.
 */
export async function GET(): Promise<NextResponse> {
  return withSpan(
    'GET /api/conta/delete',
    { method: 'GET', route: ROUTE },
    async (span): Promise<NextResponse> => {
      const log = childLogger({ route: ROUTE, method: 'GET' });
      const auth = await requireAuth(span);
      if (auth instanceof NextResponse) return auth;

      const db = getDb();

      // Job mais recente em estado activo (`scheduled`/`in_progress`).
      // Filtro household_id explícito (PO-FIX-1).
      try {
        const rows = asRows<JobStatusRow>(
          await db.execute<JobStatusRow>(sql`
            select id, status, scheduled_for, created_at
            from public.account_deletion_jobs
            where household_id = ${auth.householdId}::uuid
              and status in ('scheduled', 'in_progress')
            order by created_at desc
            limit 1
          `),
        );
        const row = rows[0];

        annotateSpan(span, { statusCode: 200 });

        if (!row) {
          const body: DeletionStatusResponseDTO = { job: null };
          return NextResponse.json(body);
        }

        const job: AccountDeletionJobDTO = {
          jobId: row.id,
          status: row.status as AccountDeletionJobDTO['status'],
          scheduledFor: new Date(row.scheduled_for).toISOString(),
          createdAt: new Date(row.created_at).toISOString(),
        };
        const body: DeletionStatusResponseDTO = { job };
        return NextResponse.json(body);
      } catch (err) {
        annotateSpan(span, { statusCode: 500 });
        log.error({ err }, 'GET /api/conta/delete — SELECT do estado falhou');
        captureException(err instanceof Error ? err : new Error(String(err)), {
          userId: auth.userId,
          route: ROUTE,
        });
        return apiError('INTERNAL_ERROR', 'Erro ao obter o estado da eliminação.', 500);
      }
    },
  );
}
