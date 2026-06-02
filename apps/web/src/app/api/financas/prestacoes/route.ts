/**
 * GET / POST /api/financas/prestacoes — Story 4.4 AC2 + AC3-AC9.
 *
 * GET:  List per household (RLS filtra). Filtro: `card_id` (uuid). Order:
 *       `purchased_on desc, id desc`. Hard cap 200. Resposta `{ installments }`.
 * POST: Create — Zod `.strict()`. Gera atomicamente (DP-4.4.4) o `installment`
 *       + N `transactions` futuras (`is_projected=true`) numa única transacção
 *       Postgres (`getDb().transaction()`). `per_installment_cents` calculado
 *       server-side (`floor(total / num)` — AC6c). `created_by_user_id`/
 *       `household_id` via JWT. `currency` fixo `'EUR'`. Resposta 201
 *       `{ installment, transactions_generated: N }`.
 *
 * Cálculo de prestação (AC6c + R-4.1): `per = floor(total / num)`. As
 * transactions 1..N-1 recebem `per`; a transaction N recebe o resto
 * `total - (N-1) * per`. Cadência mensal (DP-4.4.6): `transaction_date =
 * first_installment_on + (k-1) meses`.
 *
 * RLS: usa `getDb()` (role authenticated, RLS via JWT). A transacção mantém
 * o role `authenticated` e o RLS context. Nunca o cliente service-role —
 * vulnerabilidade crítica R-4.7.
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
import { InstallmentCreateSchema } from '@/lib/api-schemas/installments';
import { requireAuth } from '@/lib/api-helpers/auth';
import { insertAuditLog } from '@/lib/api-helpers/audit';

const ROUTE = '/api/financas/prestacoes';
const HARD_CAP = 200;

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

export async function GET(req: NextRequest): Promise<NextResponse> {
  return withSpan(
    'GET /api/financas/prestacoes',
    { method: 'GET', route: ROUTE },
    async (span): Promise<NextResponse> => {
      const log = childLogger({ route: ROUTE, method: 'GET' });
      const auth = await requireAuth(span);
      if (auth instanceof NextResponse) return auth;

      const params = req.nextUrl.searchParams;

      const rawCardId = params.get('card_id');
      if (rawCardId !== null && !z.string().uuid().safeParse(rawCardId).success) {
        annotateSpan(span, { statusCode: 400 });
        return apiError('VALIDATION_ERROR', 'Filtro card_id inválido.', 400);
      }

      try {
        const db = getDb();
        const whereSql = rawCardId
          ? sql`household_id = ${auth.householdId}::uuid and card_id = ${rawCardId}::uuid`
          : sql`household_id = ${auth.householdId}::uuid`;

        const rows = await db.execute<InstallmentRow>(sql`
          select ${INSTALLMENT_COLUMNS}
          from public.installments
          where ${whereSql}
          order by purchased_on desc, id desc
          limit ${HARD_CAP}
        `);

        annotateSpan(span, { statusCode: 200 });
        return NextResponse.json({ installments: rows });
      } catch (err) {
        annotateSpan(span, { statusCode: 500 });
        log.error({ err }, 'GET /api/financas/prestacoes falhou');
        captureException(err instanceof Error ? err : new Error(String(err)), {
          userId: auth.userId,
          route: ROUTE,
        });
        return apiError('INTERNAL_ERROR', 'Erro ao processar pedido. Tenta novamente.', 500);
      }
    },
  );
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  return withSpan(
    'POST /api/financas/prestacoes',
    { method: 'POST', route: ROUTE },
    async (span): Promise<NextResponse> => {
      const log = childLogger({ route: ROUTE, method: 'POST' });
      const auth = await requireAuth(span);
      if (auth instanceof NextResponse) return auth;

      let body;
      try {
        body = InstallmentCreateSchema.parse(await req.json());
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

        // AC6(b) + SEC-1-F1 — `card_id` (obrigatório) e `category_id` (opcional)
        // têm de pertencer ao household. Filtro `household_id` app-enforced
        // explícito (RLS inerte em runtime — getDb() liga como role bypassrls).
        // Categorias globais (`household_id NULL`) são válidas para todos os
        // households (AC-E1).
        const cardRows = await db.execute<{ id: string }>(sql`
          select id from public.cards
          where id = ${body.card_id}::uuid and household_id = ${auth.householdId}::uuid
          limit 1
        `);
        if (cardRows.length === 0) {
          annotateSpan(span, { statusCode: 404 });
          return apiError('NOT_FOUND', 'Cartão não encontrado.', 404);
        }
        if (body.category_id) {
          const catRows = await db.execute<{ id: string }>(sql`
            select id from public.categories
            where id = ${body.category_id}::uuid
              and (household_id = ${auth.householdId}::uuid or household_id is null)
            limit 1
          `);
          if (catRows.length === 0) {
            annotateSpan(span, { statusCode: 404 });
            return apiError('NOT_FOUND', 'Categoria não encontrada.', 404);
          }
        }

        // AC6(c) + R-4.1 — `per = floor(total / num)`. As transactions 1..N-1
        // recebem `per`; a transaction N recebe o resto. A guarda Zod F1
        // garante `total >= num` — `per >= 1`, sem violar `amount_positive`.
        const total = body.total_amount_cents;
        const num = body.num_installments;
        const per = Math.floor(total / num);

        // DP-4.4.4 — geração atómica: installment + N transactions numa única
        // transacção Postgres. Rollback total se qualquer INSERT falhar.
        const result = await db.transaction(async (tx) => {
          const installmentRows = await tx.execute<InstallmentRow>(sql`
            insert into public.installments
              (household_id, created_by_user_id, card_id, description,
               total_amount_cents, num_installments, per_installment_cents,
               category_id, purchased_on, first_installment_on)
            values (
              ${auth.householdId}::uuid,
              ${auth.userId}::uuid,
              ${body.card_id}::uuid,
              ${body.description},
              ${total},
              ${num},
              ${per},
              ${body.category_id ?? null},
              ${body.purchased_on}::date,
              ${body.first_installment_on}::date
            )
            returning ${INSTALLMENT_COLUMNS}
          `);

          const installment = installmentRows[0];
          if (!installment) throw new Error('INSERT installment retornou sem rows.');

          for (let k = 1; k <= num; k++) {
            // Resto na última parcela (R-4.1).
            const amount = k < num ? per : total - (num - 1) * per;
            await tx.execute(sql`
              insert into public.transactions
                (household_id, created_by_user_id, card_id, category_id,
                 amount_cents, kind, description, transaction_date, payment_method,
                 installment_id, installment_index, is_projected)
              values (
                ${auth.householdId}::uuid,
                ${auth.userId}::uuid,
                ${body.card_id}::uuid,
                ${body.category_id ?? null},
                ${amount},
                'expense'::transaction_kind,
                ${`${body.description} (parcela ${k}/${num})`},
                (${body.first_installment_on}::date + (interval '1 month' * ${k - 1}))::date,
                'card'::payment_method_finance,
                ${installment.id}::uuid,
                ${k},
                true
              )
            `);
          }

          return installment;
        });

        try {
          await insertAuditLog({
            db,
            householdId: auth.householdId,
            userId: auth.userId,
            action: 'installment.created',
            entityTable: 'installments',
            entityId: result.id,
            afterState: {
              total_amount_cents: result.total_amount_cents,
              num_installments: result.num_installments,
              per_installment_cents: result.per_installment_cents,
            },
          });
        } catch (auditErr) {
          log.warn({ err: auditErr }, 'audit_log INSERT falhou (best-effort)');
        }

        annotateSpan(span, {
          statusCode: 201,
          extra: { 'finance.transactions_generated': num },
        });
        return NextResponse.json(
          { installment: result, transactions_generated: num },
          { status: 201 },
        );
      } catch (err) {
        annotateSpan(span, { statusCode: 500 });
        log.error({ err }, 'POST /api/financas/prestacoes falhou');
        captureException(err instanceof Error ? err : new Error(String(err)), {
          userId: auth.userId,
          route: ROUTE,
        });
        return apiError('INTERNAL_ERROR', 'Erro ao processar pedido. Tenta novamente.', 500);
      }
    },
  );
}
