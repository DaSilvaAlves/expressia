/**
 * GET / PATCH / DELETE /api/financas/recorrencias/[id] — Story 4.4 AC1 + AC3-AC9.
 *
 * GET:    Single recurrence. RLS filtra — 404 se não existe ou cross-household.
 * PATCH:  Update parcial. Zod `.strict()`. `household_id`/`currency`/
 *         `created_by_user_id`/`next_run_on` IMMUTABLE (`.strict()` rejeita —
 *         `next_run_on` é gerido pelo cron de Finanças, Story 4.5). `active`
 *         editável (permite reactivar/desactivar).
 * DELETE: Soft delete (DP-4.4.3) — `UPDATE set active = false`. `recurrences`
 *         tem `active boolean` (não `archived_at`); o hard delete dispararia
 *         `transactions.recurrence_id ON DELETE set null` e perderia a
 *         proveniência das transacções já geradas pelo cron.
 *
 * RLS: usa `getDb()` (role authenticated, RLS via JWT). Nunca o cliente
 * service-role que ignora RLS — vulnerabilidade crítica R-4.7.
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
import { FinanceRecurrenceUpdateSchema } from '@/lib/api-schemas/finance-recurrences';
import { requireAuth } from '@/lib/api-helpers/auth';
import { insertAuditLog } from '@/lib/api-helpers/audit';

const ROUTE = '/api/financas/recorrencias/[id]';
const UuidParam = z.string().uuid();

interface RouteContext {
  params: Promise<{ id: string }>;
}

interface RecurrenceRow {
  id: string;
  household_id: string;
  created_by_user_id: string;
  description: string;
  kind: string;
  amount_cents: number;
  currency: string;
  account_id: string | null;
  card_id: string | null;
  category_id: string | null;
  payment_method: string;
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

const RECURRENCE_COLUMNS = sql`
  id, household_id, created_by_user_id, description, kind, amount_cents, currency,
  account_id, card_id, category_id, payment_method, frequency, interval,
  custom_rrule, starts_on, ends_on, next_run_on, active, created_at, updated_at
`;

export async function GET(_req: NextRequest, ctx: RouteContext): Promise<NextResponse> {
  return withSpan(
    'GET /api/financas/recorrencias/[id]',
    { method: 'GET', route: ROUTE },
    async (span): Promise<NextResponse> => {
      const log = childLogger({ route: ROUTE, method: 'GET' });
      const auth = await requireAuth(span);
      if (auth instanceof NextResponse) return auth;

      const { id } = await ctx.params;
      if (!UuidParam.safeParse(id).success) {
        annotateSpan(span, { statusCode: 400 });
        return apiError('VALIDATION_ERROR', 'ID de recorrência inválido.', 400);
      }

      try {
        const db = getDb();
        const rows = await db.execute<RecurrenceRow>(sql`
          select ${RECURRENCE_COLUMNS}
          from public.recurrences
          where id = ${id}::uuid and household_id = ${auth.householdId}::uuid
          limit 1
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
        log.error({ err }, 'GET /api/financas/recorrencias/[id] falhou');
        captureException(err instanceof Error ? err : new Error(String(err)), {
          userId: auth.userId,
          route: ROUTE,
        });
        return apiError('INTERNAL_ERROR', 'Erro ao processar pedido. Tenta novamente.', 500);
      }
    },
  );
}

export async function PATCH(req: NextRequest, ctx: RouteContext): Promise<NextResponse> {
  return withSpan(
    'PATCH /api/financas/recorrencias/[id]',
    { method: 'PATCH', route: ROUTE },
    async (span): Promise<NextResponse> => {
      const log = childLogger({ route: ROUTE, method: 'PATCH' });
      const auth = await requireAuth(span);
      if (auth instanceof NextResponse) return auth;

      const { id } = await ctx.params;
      if (!UuidParam.safeParse(id).success) {
        annotateSpan(span, { statusCode: 400 });
        return apiError('VALIDATION_ERROR', 'ID de recorrência inválido.', 400);
      }

      let body;
      try {
        body = FinanceRecurrenceUpdateSchema.parse(await req.json());
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

        // SELECT prévio confirma existência (RLS — cross-household → vazio).
        const existing = await db.execute<{ id: string }>(sql`
          select id from public.recurrences
          where id = ${id}::uuid and household_id = ${auth.householdId}::uuid
          limit 1
        `);
        if (!existing[0]) {
          annotateSpan(span, { statusCode: 404 });
          return apiError('NOT_FOUND', 'Recorrência não encontrada.', 404);
        }

        // AC6(b) — FK fields actualizados têm de pertencer ao household.
        if (body.account_id) {
          const rows = await db.execute<{ id: string }>(sql`
            select id from public.accounts
            where id = ${body.account_id}::uuid and household_id = ${auth.householdId}::uuid
            limit 1
          `);
          if (rows.length === 0) {
            annotateSpan(span, { statusCode: 404 });
            return apiError('NOT_FOUND', 'Conta não encontrada.', 404);
          }
        }
        if (body.card_id) {
          const rows = await db.execute<{ id: string }>(sql`
            select id from public.cards
            where id = ${body.card_id}::uuid and household_id = ${auth.householdId}::uuid
            limit 1
          `);
          if (rows.length === 0) {
            annotateSpan(span, { statusCode: 404 });
            return apiError('NOT_FOUND', 'Cartão não encontrado.', 404);
          }
        }
        if (body.category_id) {
          const rows = await db.execute<{ id: string }>(sql`
            select id from public.categories
            where id = ${body.category_id}::uuid
              and (household_id = ${auth.householdId}::uuid or household_id is null)
            limit 1
          `);
          if (rows.length === 0) {
            annotateSpan(span, { statusCode: 404 });
            return apiError('NOT_FOUND', 'Categoria não encontrada.', 404);
          }
        }

        const sets = [];
        if (body.description !== undefined) sets.push(sql`description = ${body.description}`);
        if (body.kind !== undefined) sets.push(sql`kind = ${body.kind}::transaction_kind`);
        if (body.amount_cents !== undefined) {
          sets.push(sql`amount_cents = ${body.amount_cents}`);
        }
        if (body.account_id !== undefined) sets.push(sql`account_id = ${body.account_id}`);
        if (body.card_id !== undefined) sets.push(sql`card_id = ${body.card_id}`);
        if (body.category_id !== undefined) sets.push(sql`category_id = ${body.category_id}`);
        if (body.payment_method !== undefined) {
          sets.push(sql`payment_method = ${body.payment_method}::payment_method_finance`);
        }
        if (body.frequency !== undefined) {
          sets.push(sql`frequency = ${body.frequency}::recurrence_freq_finance`);
        }
        if (body.interval !== undefined) sets.push(sql`interval = ${body.interval}`);
        if (body.custom_rrule !== undefined) {
          sets.push(sql`custom_rrule = ${body.custom_rrule}`);
        }
        if (body.starts_on !== undefined) {
          sets.push(sql`starts_on = ${body.starts_on}::date`);
        }
        if (body.ends_on !== undefined) {
          sets.push(
            body.ends_on === null
              ? sql`ends_on = null`
              : sql`ends_on = ${body.ends_on}::date`,
          );
        }
        if (body.active !== undefined) sets.push(sql`active = ${body.active}`);

        if (sets.length === 0) {
          annotateSpan(span, { statusCode: 400 });
          return apiError('VALIDATION_ERROR', 'Nenhum campo fornecido para actualizar.', 400);
        }

        sets.push(sql`updated_at = now()`);
        const setSql = sets.reduce((acc, c, idx) => (idx === 0 ? c : sql`${acc}, ${c}`));

        const rows = await db.execute<RecurrenceRow>(sql`
          update public.recurrences set ${setSql}
          where id = ${id}::uuid and household_id = ${auth.householdId}::uuid
          returning ${RECURRENCE_COLUMNS}
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
            action: 'finance_recurrence.updated',
            entityTable: 'recurrences',
            entityId: recurrence.id,
            afterState: {
              kind: recurrence.kind,
              amount_cents: recurrence.amount_cents,
              active: recurrence.active,
            },
          });
        } catch (auditErr) {
          log.warn({ err: auditErr }, 'audit_log INSERT falhou (best-effort)');
        }

        annotateSpan(span, { statusCode: 200 });
        return NextResponse.json({ recurrence });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        // Defesa em profundidade — anular `account_id` e `card_id` viola o
        // CHECK `recurrences_account_or_card`: convertido em 400 (não 500).
        if (/recurrences_account_or_card/i.test(message)) {
          annotateSpan(span, { statusCode: 400 });
          return apiError('VALIDATION_ERROR', 'Recorrência requer conta ou cartão.', 400);
        }
        annotateSpan(span, { statusCode: 500 });
        log.error({ err }, 'PATCH /api/financas/recorrencias/[id] falhou');
        captureException(err instanceof Error ? err : new Error(String(err)), {
          userId: auth.userId,
          route: ROUTE,
        });
        return apiError('INTERNAL_ERROR', 'Erro ao processar pedido. Tenta novamente.', 500);
      }
    },
  );
}

export async function DELETE(_req: NextRequest, ctx: RouteContext): Promise<NextResponse> {
  return withSpan(
    'DELETE /api/financas/recorrencias/[id]',
    { method: 'DELETE', route: ROUTE },
    async (span): Promise<NextResponse> => {
      const log = childLogger({ route: ROUTE, method: 'DELETE' });
      const auth = await requireAuth(span);
      if (auth instanceof NextResponse) return auth;

      const { id } = await ctx.params;
      if (!UuidParam.safeParse(id).success) {
        annotateSpan(span, { statusCode: 400 });
        return apiError('VALIDATION_ERROR', 'ID de recorrência inválido.', 400);
      }

      try {
        const db = getDb();

        // Soft delete (DP-4.4.3) — `UPDATE set active = false`. Preserva
        // `transactions.recurrence_id` das transacções já geradas pelo cron e
        // pára a geração futura (o cron de Finanças filtra `active = true`).
        const rows = await db.execute<{ id: string }>(sql`
          update public.recurrences set active = false, updated_at = now()
          where id = ${id}::uuid and household_id = ${auth.householdId}::uuid
          returning id
        `);

        if (!rows[0]) {
          annotateSpan(span, { statusCode: 404 });
          return apiError('NOT_FOUND', 'Recorrência não encontrada.', 404);
        }

        try {
          await insertAuditLog({
            db,
            householdId: auth.householdId,
            userId: auth.userId,
            action: 'finance_recurrence.deleted',
            entityTable: 'recurrences',
            entityId: id,
          });
        } catch (auditErr) {
          log.warn({ err: auditErr }, 'audit_log INSERT falhou (best-effort)');
        }

        annotateSpan(span, { statusCode: 200 });
        return NextResponse.json({ deactivated: true, id });
      } catch (err) {
        annotateSpan(span, { statusCode: 500 });
        log.error({ err }, 'DELETE /api/financas/recorrencias/[id] falhou');
        captureException(err instanceof Error ? err : new Error(String(err)), {
          userId: auth.userId,
          route: ROUTE,
        });
        return apiError('INTERNAL_ERROR', 'Erro ao processar pedido. Tenta novamente.', 500);
      }
    },
  );
}
