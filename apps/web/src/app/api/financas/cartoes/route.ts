/**
 * GET / POST /api/financas/cartoes — Story 4.2 AC2 + AC3-AC9.
 *
 * GET:  List per household (RLS filtra). Filters: `archived` (boolean default
 *       false), `account_id` (uuid), `card_type` (`credit`/`debit`).
 *       Order: name asc. Hard cap 200.
 * POST: Create — Zod `.strict()` + refinamento credit⇒limit (AC6). `account_id`
 *       tem de pertencer ao household e não estar arquivada (SELECT RLS-scoped).
 *
 * RLS (SEC-3 / ADR-003 Fase 2): a operação principal corre dentro de
 * `withHousehold` (2.ª rede, RLS activa). O filtro `household_id` (SEC-1, 1.ª rede)
 * MANTÉM-SE. No POST, a sub-query FK `accounts` corre no mesmo `tx` que o INSERT
 * `cards` (AC5 — atomicidade). O `insertAuditLog` permanece best-effort FORA do
 * `withHousehold` (PO-FIX-2). Nunca o cliente service-role — vulnerabilidade R-4.7.
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
import { CARD_TYPES, CardCreateSchema } from '@/lib/api-schemas/cards';
import { requireAuth } from '@/lib/api-helpers/auth';
import { insertAuditLog } from '@/lib/api-helpers/audit';
import { revalidateFinanceViews } from '@/lib/api-helpers/revalidate';

const ROUTE = '/api/financas/cartoes';

interface CardRow {
  id: string;
  household_id: string;
  account_id: string;
  name: string;
  last4: string | null;
  card_type: string;
  closing_day: number | null;
  due_day: number | null;
  credit_limit_cents: number | null;
  archived_at: string | null;
  created_at: string;
  updated_at: string;
}

const CARD_COLUMNS = sql`
  id, household_id, account_id, name, last4, card_type,
  closing_day, due_day, credit_limit_cents, archived_at, created_at, updated_at
`;

/** Filtros de query do GET — todos opcionais. */
const CardListFilterSchema = z.object({
  account_id: z.string().uuid('Filtro account_id inválido.').optional(),
  card_type: z.enum(CARD_TYPES).optional(),
});

export async function GET(req: NextRequest): Promise<NextResponse> {
  return withSpan(
    'GET /api/financas/cartoes',
    { method: 'GET', route: ROUTE },
    async (span): Promise<NextResponse> => {
      const log = childLogger({ route: ROUTE, method: 'GET' });
      const auth = await requireAuth(span);
      if (auth instanceof NextResponse) return auth;

      const params = req.nextUrl.searchParams;
      const archived = params.get('archived') === 'true';

      let filters;
      try {
        filters = CardListFilterSchema.parse({
          account_id: params.get('account_id') ?? undefined,
          card_type: params.get('card_type') ?? undefined,
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

      try {
        const conditions = [
          archived ? sql`archived_at is not null` : sql`archived_at is null`,
          sql`household_id = ${auth.householdId}::uuid`,
        ];
        if (filters.account_id) {
          conditions.push(sql`account_id = ${filters.account_id}::uuid`);
        }
        if (filters.card_type) {
          conditions.push(sql`card_type = ${filters.card_type}::card_type`);
        }
        const whereSql = conditions.reduce((acc, c, idx) =>
          idx === 0 ? c : sql`${acc} and ${c}`,
        );

        const rows = await withHousehold(
          { userId: auth.userId, householdId: auth.householdId },
          (tx) =>
            tx.execute<CardRow>(sql`
              select ${CARD_COLUMNS}
              from public.cards
              where ${whereSql}
              order by name asc
              limit 200
            `),
        );
        annotateSpan(span, { statusCode: 200 });
        return NextResponse.json({ cards: rows });
      } catch (err) {
        annotateSpan(span, { statusCode: 500 });
        log.error({ err }, 'GET /api/financas/cartoes falhou');
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
    'POST /api/financas/cartoes',
    { method: 'POST', route: ROUTE },
    async (span): Promise<NextResponse> => {
      const log = childLogger({ route: ROUTE, method: 'POST' });
      const auth = await requireAuth(span);
      if (auth instanceof NextResponse) return auth;

      let body;
      try {
        body = CardCreateSchema.parse(await req.json());
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
        // PO-FIX-2: `getDb()` mantém-se para o `insertAuditLog` best-effort (abaixo).
        const db = getDb();

        // AC5 — sub-query FK `accounts` + INSERT `cards` correm no MESMO `tx`
        // (atomicidade + contexto RLS consistente). Retorno discriminado para
        // preservar a semântica de early-return 404 sem `return` dentro do callback.
        const result = await withHousehold(
          { userId: auth.userId, householdId: auth.householdId },
          async (tx): Promise<{ notFound: true } | { card: CardRow }> => {
            // AC6 + SEC-1-F1 — `account_id` tem de existir, pertencer ao household
            // (filtro `household_id` app-enforced explícito — 1.ª rede) e não estar
            // arquivada (PO_FIX F1: impede cartão sobre conta arquivada).
            const accountRows = await tx.execute<{ id: string }>(sql`
              select id from public.accounts
              where id = ${body.account_id}::uuid
                and household_id = ${auth.householdId}::uuid
                and archived_at is null
              limit 1
            `);
            if (accountRows.length === 0) return { notFound: true };

            const inserted = await tx.execute<CardRow>(sql`
              insert into public.cards
                (household_id, account_id, name, card_type, last4, closing_day, due_day, credit_limit_cents)
              values (
                ${auth.householdId}::uuid,
                ${body.account_id}::uuid,
                ${body.name},
                ${body.card_type}::card_type,
                ${body.last4 ?? null},
                ${body.closing_day ?? null},
                ${body.due_day ?? null},
                ${body.credit_limit_cents ?? null}
              )
              returning ${CARD_COLUMNS}
            `);
            const row = inserted[0];
            if (!row) throw new Error('INSERT card retornou sem rows.');
            return { card: row };
          },
        );

        if ('notFound' in result) {
          annotateSpan(span, { statusCode: 404 });
          return apiError('NOT_FOUND', 'Conta não encontrada.', 404);
        }

        const card = result.card;

        try {
          await insertAuditLog({
            db,
            householdId: auth.householdId,
            userId: auth.userId,
            action: 'card.created',
            entityTable: 'cards',
            entityId: card.id,
            afterState: {
              name: card.name,
              card_type: card.card_type,
              account_id: card.account_id,
            },
          });
        } catch (auditErr) {
          log.warn({ err: auditErr }, 'audit_log INSERT falhou (best-effort)');
        }

        // W2 (A3): sem isto o cartão novo não aparece em /financas/cartoes nem
        // nas restantes vistas financeiras sem hard refresh — o
        // `router.refresh()` do modal só revalida o segmento actual.
        revalidateFinanceViews();

        annotateSpan(span, { statusCode: 201 });
        return NextResponse.json({ card }, { status: 201 });
      } catch (err) {
        annotateSpan(span, { statusCode: 500 });
        log.error({ err }, 'POST /api/financas/cartoes falhou');
        captureException(err instanceof Error ? err : new Error(String(err)), {
          userId: auth.userId,
          route: ROUTE,
        });
        return apiError('INTERNAL_ERROR', 'Erro ao processar pedido. Tenta novamente.', 500);
      }
    },
  );
}
