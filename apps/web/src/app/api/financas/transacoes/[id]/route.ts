/**
 * GET / PATCH / DELETE /api/financas/transacoes/[id] — Story 4.3 AC1 + AC3-AC9.
 *
 * GET:    Single transaction. RLS filtra — 404 se não existe ou cross-household.
 * PATCH:  Update parcial. Zod `.strict()`. `household_id`/`currency`/
 *         `created_by_user_id`/`recurrence_id`/`installment_id`/
 *         `installment_index`/`agent_run_id` IMMUTABLE (`.strict()` rejeita).
 *         Scope variable-only (DP-4.3.3) — transacção gerada → 409 CONFLICT.
 * DELETE: Hard delete (DP-4.3.4 — `transactions` não tem `archived_at`). Scope
 *         variable-only — transacção gerada → 409 CONFLICT.
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
import { TransactionUpdateSchema } from '@/lib/api-schemas/transactions';
import { requireAuth } from '@/lib/api-helpers/auth';
import { insertAuditLog } from '@/lib/api-helpers/audit';

const ROUTE = '/api/financas/transacoes/[id]';
const UuidParam = z.string().uuid();

interface RouteContext {
  params: Promise<{ id: string }>;
}

interface TransactionRow {
  id: string;
  household_id: string;
  created_by_user_id: string;
  account_id: string | null;
  card_id: string | null;
  category_id: string | null;
  amount_cents: number;
  currency: string;
  kind: string;
  description: string;
  transaction_date: string;
  payment_method: string;
  recurrence_id: string | null;
  installment_id: string | null;
  installment_index: number | null;
  agent_run_id: string | null;
  notes: string | null;
  is_projected: boolean;
  created_at: string;
  updated_at: string;
}

const TRANSACTION_COLUMNS = sql`
  id, household_id, created_by_user_id, account_id, card_id, category_id,
  amount_cents, currency, kind, description, transaction_date, payment_method,
  recurrence_id, installment_id, installment_index, agent_run_id, notes,
  is_projected, created_at, updated_at
`;

/** Mensagem do 409 — scope variable-only (DP-4.3.3). */
const GENERATED_CONFLICT =
  'Transacção gerada por recorrência ou prestação não pode ser editada directamente.';

export async function GET(_req: NextRequest, ctx: RouteContext): Promise<NextResponse> {
  return withSpan(
    'GET /api/financas/transacoes/[id]',
    { method: 'GET', route: ROUTE },
    async (span): Promise<NextResponse> => {
      const log = childLogger({ route: ROUTE, method: 'GET' });
      const auth = await requireAuth(span);
      if (auth instanceof NextResponse) return auth;

      const { id } = await ctx.params;
      if (!UuidParam.safeParse(id).success) {
        annotateSpan(span, { statusCode: 400 });
        return apiError('VALIDATION_ERROR', 'ID de transacção inválido.', 400);
      }

      try {
        const db = getDb();
        const rows = await db.execute<TransactionRow>(sql`
          select ${TRANSACTION_COLUMNS}
          from public.transactions where id = ${id}::uuid limit 1
        `);

        const transaction = rows[0];
        if (!transaction) {
          annotateSpan(span, { statusCode: 404 });
          return apiError('NOT_FOUND', 'Transacção não encontrada.', 404);
        }

        annotateSpan(span, { statusCode: 200 });
        return NextResponse.json({ transaction });
      } catch (err) {
        annotateSpan(span, { statusCode: 500 });
        log.error({ err }, 'GET /api/financas/transacoes/[id] falhou');
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
    'PATCH /api/financas/transacoes/[id]',
    { method: 'PATCH', route: ROUTE },
    async (span): Promise<NextResponse> => {
      const log = childLogger({ route: ROUTE, method: 'PATCH' });
      const auth = await requireAuth(span);
      if (auth instanceof NextResponse) return auth;

      const { id } = await ctx.params;
      if (!UuidParam.safeParse(id).success) {
        annotateSpan(span, { statusCode: 400 });
        return apiError('VALIDATION_ERROR', 'ID de transacção inválido.', 400);
      }

      let body;
      try {
        body = TransactionUpdateSchema.parse(await req.json());
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

        // Scope variable-only (DP-4.3.3) — SELECT prévio confirma existência e
        // que a transacção NÃO foi gerada por recorrência/prestação.
        const existing = await db.execute<{
          id: string;
          recurrence_id: string | null;
          installment_id: string | null;
        }>(sql`
          select id, recurrence_id, installment_id
          from public.transactions where id = ${id}::uuid limit 1
        `);
        const current = existing[0];
        if (!current) {
          annotateSpan(span, { statusCode: 404 });
          return apiError('NOT_FOUND', 'Transacção não encontrada.', 404);
        }
        if (current.recurrence_id !== null || current.installment_id !== null) {
          annotateSpan(span, { statusCode: 409 });
          return apiError('CONFLICT', GENERATED_CONFLICT, 409);
        }

        // AC6(b) — FK fields actualizados têm de pertencer ao household.
        if (body.account_id) {
          const rows = await db.execute<{ id: string }>(sql`
            select id from public.accounts where id = ${body.account_id}::uuid limit 1
          `);
          if (rows.length === 0) {
            annotateSpan(span, { statusCode: 404 });
            return apiError('NOT_FOUND', 'Conta não encontrada.', 404);
          }
        }
        if (body.card_id) {
          const rows = await db.execute<{ id: string }>(sql`
            select id from public.cards where id = ${body.card_id}::uuid limit 1
          `);
          if (rows.length === 0) {
            annotateSpan(span, { statusCode: 404 });
            return apiError('NOT_FOUND', 'Cartão não encontrado.', 404);
          }
        }
        if (body.category_id) {
          const rows = await db.execute<{ id: string }>(sql`
            select id from public.categories where id = ${body.category_id}::uuid limit 1
          `);
          if (rows.length === 0) {
            annotateSpan(span, { statusCode: 404 });
            return apiError('NOT_FOUND', 'Categoria não encontrada.', 404);
          }
        }

        const sets = [];
        if (body.account_id !== undefined) sets.push(sql`account_id = ${body.account_id}`);
        if (body.card_id !== undefined) sets.push(sql`card_id = ${body.card_id}`);
        if (body.category_id !== undefined) sets.push(sql`category_id = ${body.category_id}`);
        if (body.amount_cents !== undefined) sets.push(sql`amount_cents = ${body.amount_cents}`);
        if (body.kind !== undefined) sets.push(sql`kind = ${body.kind}::transaction_kind`);
        if (body.description !== undefined) sets.push(sql`description = ${body.description}`);
        if (body.transaction_date !== undefined) {
          sets.push(sql`transaction_date = ${body.transaction_date}::date`);
        }
        if (body.payment_method !== undefined) {
          sets.push(sql`payment_method = ${body.payment_method}::payment_method_finance`);
        }
        if (body.notes !== undefined) sets.push(sql`notes = ${body.notes}`);

        if (sets.length === 0) {
          annotateSpan(span, { statusCode: 400 });
          return apiError('VALIDATION_ERROR', 'Nenhum campo fornecido para actualizar.', 400);
        }

        sets.push(sql`updated_at = now()`);
        const setSql = sets.reduce((acc, c, idx) => (idx === 0 ? c : sql`${acc}, ${c}`));

        const rows = await db.execute<TransactionRow>(sql`
          update public.transactions set ${setSql} where id = ${id}::uuid
          returning ${TRANSACTION_COLUMNS}
        `);

        const transaction = rows[0];
        if (!transaction) {
          annotateSpan(span, { statusCode: 404 });
          return apiError('NOT_FOUND', 'Transacção não encontrada.', 404);
        }

        try {
          await insertAuditLog({
            db,
            householdId: auth.householdId,
            userId: auth.userId,
            action: 'transaction.updated',
            entityTable: 'transactions',
            entityId: transaction.id,
            afterState: {
              kind: transaction.kind,
              amount_cents: transaction.amount_cents,
            },
          });
        } catch (auditErr) {
          log.warn({ err: auditErr }, 'audit_log INSERT falhou (best-effort)');
        }

        annotateSpan(span, { statusCode: 200 });
        return NextResponse.json({ transaction });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        // Defesa em profundidade — anular `account_id` e `card_id` viola o CHECK
        // `transactions_account_or_card`: convertido em 400 (não 500).
        if (/transactions_account_or_card/i.test(message)) {
          annotateSpan(span, { statusCode: 400 });
          return apiError('VALIDATION_ERROR', 'Transacção requer conta ou cartão.', 400);
        }
        annotateSpan(span, { statusCode: 500 });
        log.error({ err }, 'PATCH /api/financas/transacoes/[id] falhou');
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
    'DELETE /api/financas/transacoes/[id]',
    { method: 'DELETE', route: ROUTE },
    async (span): Promise<NextResponse> => {
      const log = childLogger({ route: ROUTE, method: 'DELETE' });
      const auth = await requireAuth(span);
      if (auth instanceof NextResponse) return auth;

      const { id } = await ctx.params;
      if (!UuidParam.safeParse(id).success) {
        annotateSpan(span, { statusCode: 400 });
        return apiError('VALIDATION_ERROR', 'ID de transacção inválido.', 400);
      }

      try {
        const db = getDb();

        // Scope variable-only (DP-4.3.3) — SELECT prévio antes do hard delete.
        const existing = await db.execute<{
          id: string;
          recurrence_id: string | null;
          installment_id: string | null;
        }>(sql`
          select id, recurrence_id, installment_id
          from public.transactions where id = ${id}::uuid limit 1
        `);
        const current = existing[0];
        if (!current) {
          annotateSpan(span, { statusCode: 404 });
          return apiError('NOT_FOUND', 'Transacção não encontrada.', 404);
        }
        if (current.recurrence_id !== null || current.installment_id !== null) {
          annotateSpan(span, { statusCode: 409 });
          return apiError('CONFLICT', GENERATED_CONFLICT, 409);
        }

        // Hard delete (DP-4.3.4) — `transactions` não tem `archived_at`; nada
        // referencia `transactions.id`. Sob DP1=A (recompute on-read) a remoção
        // sai correctamente do agregado de saldo.
        await db.execute(sql`delete from public.transactions where id = ${id}::uuid`);

        try {
          await insertAuditLog({
            db,
            householdId: auth.householdId,
            userId: auth.userId,
            action: 'transaction.deleted',
            entityTable: 'transactions',
            entityId: id,
          });
        } catch (auditErr) {
          log.warn({ err: auditErr }, 'audit_log INSERT falhou (best-effort)');
        }

        annotateSpan(span, { statusCode: 200 });
        return NextResponse.json({ deleted: true, id });
      } catch (err) {
        annotateSpan(span, { statusCode: 500 });
        log.error({ err }, 'DELETE /api/financas/transacoes/[id] falhou');
        captureException(err instanceof Error ? err : new Error(String(err)), {
          userId: auth.userId,
          route: ROUTE,
        });
        return apiError('INTERNAL_ERROR', 'Erro ao processar pedido. Tenta novamente.', 500);
      }
    },
  );
}
