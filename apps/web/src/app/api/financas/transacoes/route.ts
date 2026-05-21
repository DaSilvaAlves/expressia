/**
 * GET / POST /api/financas/transacoes — Story 4.3 AC1 + AC3-AC9.
 *
 * GET:  List per household (RLS filtra). Paginação cursor (DP-4.3.2) — params
 *       `cursor` (opaque base64url), `limit` (1-100, default 50). Filtros:
 *       `from`/`to` (data sobre `transaction_date`), `category_id`, `account_id`,
 *       `card_id`, `kind`, `origin` (`manual`/`recurrence`/`installment`/`all`).
 *       Order: `transaction_date desc, id desc`.
 * POST: Create — Zod `.strict()`. Cria SÓ transacções variáveis (manuais):
 *       `recurrence_id`/`installment_id`/`installment_index`/`agent_run_id` NULL;
 *       `is_projected` false (default DB). `household_id` + `created_by_user_id`
 *       via JWT. `currency` fixo `'EUR'`.
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
import {
  TRANSACTION_KINDS,
  TRANSACTION_ORIGINS,
  TransactionCreateSchema,
  decodeTransactionCursor,
  encodeTransactionCursor,
} from '@/lib/api-schemas/transactions';
import { requireAuth } from '@/lib/api-helpers/auth';
import { insertAuditLog } from '@/lib/api-helpers/audit';

const ROUTE = '/api/financas/transacoes';
const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 100;

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

/** Filtros de query do GET — todos opcionais. */
const ListFilterSchema = z.object({
  from: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, 'Filtro `from` inválido — formato YYYY-MM-DD.')
    .optional(),
  to: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, 'Filtro `to` inválido — formato YYYY-MM-DD.')
    .optional(),
  category_id: z.string().uuid('Filtro category_id inválido.').optional(),
  account_id: z.string().uuid('Filtro account_id inválido.').optional(),
  card_id: z.string().uuid('Filtro card_id inválido.').optional(),
  kind: z.enum(TRANSACTION_KINDS).optional(),
  origin: z.enum(TRANSACTION_ORIGINS).default('all'),
  limit: z.coerce
    .number()
    .int()
    .min(1, 'limit deve estar entre 1 e 100.')
    .max(MAX_LIMIT, 'limit deve estar entre 1 e 100.')
    .default(DEFAULT_LIMIT),
});

export async function GET(req: NextRequest): Promise<NextResponse> {
  return withSpan(
    'GET /api/financas/transacoes',
    { method: 'GET', route: ROUTE },
    async (span): Promise<NextResponse> => {
      const log = childLogger({ route: ROUTE, method: 'GET' });
      const auth = await requireAuth(span);
      if (auth instanceof NextResponse) return auth;

      const params = req.nextUrl.searchParams;

      let filters;
      try {
        filters = ListFilterSchema.parse({
          from: params.get('from') ?? undefined,
          to: params.get('to') ?? undefined,
          category_id: params.get('category_id') ?? undefined,
          account_id: params.get('account_id') ?? undefined,
          card_id: params.get('card_id') ?? undefined,
          kind: params.get('kind') ?? undefined,
          origin: params.get('origin') ?? undefined,
          limit: params.get('limit') ?? undefined,
        });
      } catch (err) {
        annotateSpan(span, { statusCode: 400 });
        if (err instanceof z.ZodError) {
          return apiError('VALIDATION_ERROR', 'Filtros inválidos.', 400, {
            issues: err.issues.map((i) => ({ path: i.path, message: i.message })),
          });
        }
        return apiError('VALIDATION_ERROR', 'Filtros inválidos.', 400);
      }

      // Cursor opcional — parse estrito (cursor malformado → 400).
      const rawCursor = params.get('cursor');
      let cursor = null;
      if (rawCursor !== null) {
        cursor = decodeTransactionCursor(rawCursor);
        if (cursor === null) {
          annotateSpan(span, { statusCode: 400 });
          return apiError('VALIDATION_ERROR', 'Cursor de paginação inválido.', 400);
        }
      }

      try {
        const db = getDb();
        const conditions = [];
        if (filters.from) conditions.push(sql`transaction_date >= ${filters.from}::date`);
        if (filters.to) conditions.push(sql`transaction_date <= ${filters.to}::date`);
        if (filters.category_id) {
          conditions.push(sql`category_id = ${filters.category_id}::uuid`);
        }
        if (filters.account_id) {
          conditions.push(sql`account_id = ${filters.account_id}::uuid`);
        }
        if (filters.card_id) conditions.push(sql`card_id = ${filters.card_id}::uuid`);
        if (filters.kind) conditions.push(sql`kind = ${filters.kind}::transaction_kind`);
        if (filters.origin === 'manual') {
          conditions.push(sql`recurrence_id is null and installment_id is null`);
        } else if (filters.origin === 'recurrence') {
          conditions.push(sql`recurrence_id is not null`);
        } else if (filters.origin === 'installment') {
          conditions.push(sql`installment_id is not null`);
        }
        // Keyset cursor — order `transaction_date desc, id desc`.
        if (cursor) {
          conditions.push(sql`(
            transaction_date < ${cursor.last_transaction_date}::date
            or (transaction_date = ${cursor.last_transaction_date}::date and id < ${cursor.last_id}::uuid)
          )`);
        }

        const whereSql =
          conditions.length > 0
            ? conditions.reduce((acc, c, idx) => (idx === 0 ? c : sql`${acc} and ${c}`))
            : sql`true`;

        // limit + 1 — a row extra sinaliza que há próxima página.
        const rows = await db.execute<TransactionRow>(sql`
          select ${TRANSACTION_COLUMNS}
          from public.transactions
          where ${whereSql}
          order by transaction_date desc, id desc
          limit ${filters.limit + 1}
        `);

        const hasMore = rows.length > filters.limit;
        const page = hasMore ? rows.slice(0, filters.limit) : rows;
        const last = page[page.length - 1];
        const nextCursor =
          hasMore && last
            ? encodeTransactionCursor({
                last_transaction_date: last.transaction_date,
                last_id: last.id,
              })
            : null;

        annotateSpan(span, { statusCode: 200 });
        return NextResponse.json({ transactions: page, next_cursor: nextCursor });
      } catch (err) {
        annotateSpan(span, { statusCode: 500 });
        log.error({ err }, 'GET /api/financas/transacoes falhou');
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
    'POST /api/financas/transacoes',
    { method: 'POST', route: ROUTE },
    async (span): Promise<NextResponse> => {
      const log = childLogger({ route: ROUTE, method: 'POST' });
      const auth = await requireAuth(span);
      if (auth instanceof NextResponse) return auth;

      let body;
      try {
        body = TransactionCreateSchema.parse(await req.json());
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

        // AC6(b) — `account_id`/`card_id`/`category_id` (quando presentes) têm de
        // pertencer ao household. SELECT RLS-scoped não encontra rows cross-household
        // (categorias globais — `household_id NULL` — são visíveis e válidas).
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

        const rows = await db.execute<TransactionRow>(sql`
          insert into public.transactions
            (household_id, created_by_user_id, account_id, card_id, category_id,
             amount_cents, kind, description, transaction_date, payment_method, notes)
          values (
            ${auth.householdId}::uuid,
            ${auth.userId}::uuid,
            ${body.account_id ?? null},
            ${body.card_id ?? null},
            ${body.category_id ?? null},
            ${body.amount_cents},
            ${body.kind}::transaction_kind,
            ${body.description},
            ${body.transaction_date}::date,
            ${body.payment_method}::payment_method_finance,
            ${body.notes ?? null}
          )
          returning ${TRANSACTION_COLUMNS}
        `);

        const transaction = rows[0];
        if (!transaction) throw new Error('INSERT transaction retornou sem rows.');

        try {
          await insertAuditLog({
            db,
            householdId: auth.householdId,
            userId: auth.userId,
            action: 'transaction.created',
            entityTable: 'transactions',
            entityId: transaction.id,
            afterState: {
              kind: transaction.kind,
              amount_cents: transaction.amount_cents,
              transaction_date: transaction.transaction_date,
            },
          });
        } catch (auditErr) {
          log.warn({ err: auditErr }, 'audit_log INSERT falhou (best-effort)');
        }

        annotateSpan(span, { statusCode: 201 });
        return NextResponse.json({ transaction }, { status: 201 });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        // Defesa em profundidade — `account_or_card` violado (ambos NULL).
        if (/transactions_account_or_card/i.test(message)) {
          annotateSpan(span, { statusCode: 400 });
          return apiError('VALIDATION_ERROR', 'Transacção requer conta ou cartão.', 400);
        }
        annotateSpan(span, { statusCode: 500 });
        log.error({ err }, 'POST /api/financas/transacoes falhou');
        captureException(err instanceof Error ? err : new Error(String(err)), {
          userId: auth.userId,
          route: ROUTE,
        });
        return apiError('INTERNAL_ERROR', 'Erro ao processar pedido. Tenta novamente.', 500);
      }
    },
  );
}
