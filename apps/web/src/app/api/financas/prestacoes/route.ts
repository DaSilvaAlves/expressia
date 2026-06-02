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
 * RLS (SEC-3 / ADR-003 Fase 2): a operação principal corre dentro de
 * `withHousehold` (2.ª rede, RLS activa). O filtro `household_id` (SEC-1, 1.ª rede)
 * MANTÉM-SE. No POST (AC6 — transação aninhada), o `tx.transaction()` interno é um
 * savepoint Postgres que HERDA o contexto RLS (role + claims) da transação exterior
 * de `withHousehold` — sem fuga de contexto, atomicidade preservada. As sub-queries
 * FK `cards`/`categories` correm no mesmo `tx` exterior (AC5). O `insertAuditLog`
 * permanece best-effort FORA do `withHousehold` (PO-FIX-2). Nunca o cliente
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
import { getDb, withHousehold } from '@/lib/agent/db-shim';
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
        const whereSql = rawCardId
          ? sql`household_id = ${auth.householdId}::uuid and card_id = ${rawCardId}::uuid`
          : sql`household_id = ${auth.householdId}::uuid`;

        const rows = await withHousehold(
          { userId: auth.userId, householdId: auth.householdId },
          (tx) =>
            tx.execute<InstallmentRow>(sql`
              select ${INSTALLMENT_COLUMNS}
              from public.installments
              where ${whereSql}
              order by purchased_on desc, id desc
              limit ${HARD_CAP}
            `),
        );

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

      // AC6(c) + R-4.1 — `per = floor(total / num)` (cálculo puro, sem IO). As
      // transactions 1..N-1 recebem `per`; a N recebe o resto. A guarda Zod F1
      // garante `total >= num` — `per >= 1`, sem violar `amount_positive`.
      const total = body.total_amount_cents;
      const num = body.num_installments;
      const per = Math.floor(total / num);

      try {
        // PO-FIX-2: `getDb()` mantém-se para o `insertAuditLog` best-effort (abaixo).
        const db = getDb();

        // AC5/AC6 — sub-queries FK + transação aninhada (savepoint) correm dentro do
        // MESMO `withHousehold`. O `tx.transaction()` interno herda o contexto RLS.
        // Retorno discriminado preserva os early-returns 404 por FK sem `return`.
        const result = await withHousehold(
          { userId: auth.userId, householdId: auth.householdId },
          async (
            tx,
          ): Promise<{ error: 'card_not_found' | 'category_not_found' } | { installment: InstallmentRow }> => {
            // AC6(b) + SEC-1-F1 — `card_id` (obrigatório) e `category_id` (opcional)
            // têm de pertencer ao household. Filtro `household_id` app-enforced
            // explícito (1.ª rede). Categorias globais são válidas para todos (AC-E1).
            const cardRows = await tx.execute<{ id: string }>(sql`
              select id from public.cards
              where id = ${body.card_id}::uuid and household_id = ${auth.householdId}::uuid
              limit 1
            `);
            if (cardRows.length === 0) return { error: 'card_not_found' };
            if (body.category_id) {
              const catRows = await tx.execute<{ id: string }>(sql`
                select id from public.categories
                where id = ${body.category_id}::uuid
                  and (household_id = ${auth.householdId}::uuid or household_id is null)
                limit 1
              `);
              if (catRows.length === 0) return { error: 'category_not_found' };
            }

            // DP-4.4.4 — geração atómica: installment + N transactions. Transação
            // aninhada (savepoint Postgres) que herda o contexto RLS do `withHousehold`.
            // Rollback total se qualquer INSERT falhar (AC6).
            const installment = await tx.transaction(async (innerTx) => {
              const installmentRows = await innerTx.execute<InstallmentRow>(sql`
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

              const created = installmentRows[0];
              if (!created) throw new Error('INSERT installment retornou sem rows.');

              for (let k = 1; k <= num; k++) {
                // Resto na última parcela (R-4.1).
                const amount = k < num ? per : total - (num - 1) * per;
                await innerTx.execute(sql`
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
                    ${created.id}::uuid,
                    ${k},
                    true
                  )
                `);
              }

              return created;
            });

            return { installment };
          },
        );

        if ('error' in result) {
          annotateSpan(span, { statusCode: 404 });
          return apiError(
            'NOT_FOUND',
            result.error === 'card_not_found' ? 'Cartão não encontrado.' : 'Categoria não encontrada.',
            404,
          );
        }

        const installment = result.installment;

        try {
          await insertAuditLog({
            db,
            householdId: auth.householdId,
            userId: auth.userId,
            action: 'installment.created',
            entityTable: 'installments',
            entityId: installment.id,
            afterState: {
              total_amount_cents: installment.total_amount_cents,
              num_installments: installment.num_installments,
              per_installment_cents: installment.per_installment_cents,
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
          { installment, transactions_generated: num },
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
