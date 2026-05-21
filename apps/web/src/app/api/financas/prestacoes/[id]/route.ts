/**
 * GET / DELETE /api/financas/prestacoes/[id] — Story 4.4 AC2 + AC3-AC9.
 *
 * GET:    Single installment. RLS filtra — 404 se não existe ou cross-household.
 * DELETE: Hard delete em cascata (DP-4.4.5) — numa transacção Postgres:
 *         (1) `DELETE FROM transactions WHERE installment_id = X`,
 *         (2) `DELETE FROM installments WHERE id = X`. A ordem é obrigatória —
 *         eliminar o `installment` primeiro dispararia
 *         `transactions.installment_id ON DELETE set null` deixando
 *         `installment_index >= 1` com `installment_id NULL`, o que viola o
 *         CHECK `transactions_installment_index_coherent` (`finance.ts:425-428`).
 *
 * SEM endpoint PATCH (DP-4.4.3) — as compras parceladas são imutáveis no MVP.
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
import { requireAuth } from '@/lib/api-helpers/auth';
import { insertAuditLog } from '@/lib/api-helpers/audit';

const ROUTE = '/api/financas/prestacoes/[id]';
const UuidParam = z.string().uuid();

interface RouteContext {
  params: Promise<{ id: string }>;
}

interface InstallmentRow {
  id: string;
  household_id: string;
  created_by_user_id: string;
  card_id: string;
  description: string;
  total_amount_cents: number;
  num_installments: number;
  per_installment_cents: number;
  category_id: string | null;
  purchased_on: string;
  first_installment_on: string;
  currency: string;
  created_at: string;
  updated_at: string;
}

const INSTALLMENT_COLUMNS = sql`
  id, household_id, created_by_user_id, card_id, description, total_amount_cents,
  num_installments, per_installment_cents, category_id, purchased_on,
  first_installment_on, currency, created_at, updated_at
`;

export async function GET(_req: NextRequest, ctx: RouteContext): Promise<NextResponse> {
  return withSpan(
    'GET /api/financas/prestacoes/[id]',
    { method: 'GET', route: ROUTE },
    async (span): Promise<NextResponse> => {
      const log = childLogger({ route: ROUTE, method: 'GET' });
      const auth = await requireAuth(span);
      if (auth instanceof NextResponse) return auth;

      const { id } = await ctx.params;
      if (!UuidParam.safeParse(id).success) {
        annotateSpan(span, { statusCode: 400 });
        return apiError('VALIDATION_ERROR', 'ID de prestação inválido.', 400);
      }

      try {
        const db = getDb();
        const rows = await db.execute<InstallmentRow>(sql`
          select ${INSTALLMENT_COLUMNS}
          from public.installments where id = ${id}::uuid limit 1
        `);

        const installment = rows[0];
        if (!installment) {
          annotateSpan(span, { statusCode: 404 });
          return apiError('NOT_FOUND', 'Prestação não encontrada.', 404);
        }

        annotateSpan(span, { statusCode: 200 });
        return NextResponse.json({ installment });
      } catch (err) {
        annotateSpan(span, { statusCode: 500 });
        log.error({ err }, 'GET /api/financas/prestacoes/[id] falhou');
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
    'DELETE /api/financas/prestacoes/[id]',
    { method: 'DELETE', route: ROUTE },
    async (span): Promise<NextResponse> => {
      const log = childLogger({ route: ROUTE, method: 'DELETE' });
      const auth = await requireAuth(span);
      if (auth instanceof NextResponse) return auth;

      const { id } = await ctx.params;
      if (!UuidParam.safeParse(id).success) {
        annotateSpan(span, { statusCode: 400 });
        return apiError('VALIDATION_ERROR', 'ID de prestação inválido.', 400);
      }

      try {
        const db = getDb();

        // SELECT prévio confirma existência (RLS — cross-household → vazio).
        const existing = await db.execute<{ id: string }>(sql`
          select id from public.installments where id = ${id}::uuid limit 1
        `);
        if (!existing[0]) {
          annotateSpan(span, { statusCode: 404 });
          return apiError('NOT_FOUND', 'Prestação não encontrada.', 404);
        }

        // DP-4.4.5 — hard delete em cascata numa transacção Postgres:
        // transactions ANTES do installment. A ordem inversa violaria o CHECK
        // `transactions_installment_index_coherent` via `ON DELETE set null`.
        const transactionsDeleted = await db.transaction(async (tx) => {
          const deletedTx = await tx.execute<{ id: string }>(sql`
            delete from public.transactions where installment_id = ${id}::uuid
            returning id
          `);
          await tx.execute(sql`
            delete from public.installments where id = ${id}::uuid
          `);
          return deletedTx.length;
        });

        try {
          await insertAuditLog({
            db,
            householdId: auth.householdId,
            userId: auth.userId,
            action: 'installment.deleted',
            entityTable: 'installments',
            entityId: id,
          });
        } catch (auditErr) {
          log.warn({ err: auditErr }, 'audit_log INSERT falhou (best-effort)');
        }

        annotateSpan(span, {
          statusCode: 200,
          extra: { 'finance.transactions_deleted': transactionsDeleted },
        });
        return NextResponse.json({
          deleted: true,
          id,
          transactions_deleted: transactionsDeleted,
        });
      } catch (err) {
        annotateSpan(span, { statusCode: 500 });
        log.error({ err }, 'DELETE /api/financas/prestacoes/[id] falhou');
        captureException(err instanceof Error ? err : new Error(String(err)), {
          userId: auth.userId,
          route: ROUTE,
        });
        return apiError('INTERNAL_ERROR', 'Erro ao processar pedido. Tenta novamente.', 500);
      }
    },
  );
}
