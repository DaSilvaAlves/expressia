/**
 * GET / POST /api/financas/contas — Story 4.2 AC1 + AC3-AC9.
 *
 * GET:  List per household (RLS filtra). Query param `archived` (boolean, default
 *       `false` = só contas activas, `archived_at IS NULL`; `true` = só arquivadas).
 *       Order: name asc. Hard cap 200 (volume baixo por household — sem paginação).
 *       `balance_cents` é computado on-read (W1 — a coluna stored é morta, nunca
 *       actualizada por trigger): `initial_balance_cents + SUM(income) −
 *       SUM(expense)` via `getAccountBalanceMap` (single source of truth do
 *       saldo, partilhada com a vista Património). O shape da resposta mantém-se
 *       (campo `balance_cents`), só com o valor correcto — contrato compatível.
 * POST: Create — Zod `.strict()`. RLS injecta `household_id` via JWT; `currency`
 *       fixo `'EUR'` (default DB). `balance_cents` inicializado = `initial_balance_cents`
 *       (snapshot, DP-4.2.4).
 *
 * RLS (SEC-3 / ADR-003 Fase 2): a operação principal corre dentro de
 * `withHousehold`, que abre uma transação com `SET LOCAL ROLE authenticated`
 * + JWT claims — activa as 104 RLS policies (2.ª rede). O filtro `household_id`
 * explícito (SEC-1, 1.ª rede) MANTÉM-SE em todas as queries — defense-in-depth.
 * O `insertAuditLog` permanece best-effort FORA do `withHousehold` (PO-FIX-2).
 * Nunca o cliente service-role que ignora RLS — vulnerabilidade crítica R-4.7.
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
import { AccountCreateSchema } from '@/lib/api-schemas/accounts';
import { requireAuth } from '@/lib/api-helpers/auth';
import { insertAuditLog } from '@/lib/api-helpers/audit';
import { getAccountBalanceMap } from '@/lib/finance/account-balances';

const ROUTE = '/api/financas/contas';

interface AccountRow {
  id: string;
  household_id: string;
  name: string;
  bank_name: string | null;
  account_type: string;
  iban_last4: string | null;
  balance_cents: number;
  initial_balance_cents: number;
  currency: string;
  archived_at: string | null;
  created_at: string;
  updated_at: string;
}

const ACCOUNT_COLUMNS = sql`
  id, household_id, name, bank_name, account_type, iban_last4,
  balance_cents, initial_balance_cents, currency, archived_at, created_at, updated_at
`;

export async function GET(req: NextRequest): Promise<NextResponse> {
  return withSpan(
    'GET /api/financas/contas',
    { method: 'GET', route: ROUTE },
    async (span): Promise<NextResponse> => {
      const log = childLogger({ route: ROUTE, method: 'GET' });
      const auth = await requireAuth(span);
      if (auth instanceof NextResponse) return auth;

      // Parse estrito: `archived` aceita APENAS o literal 'true'. Default false.
      const archived = req.nextUrl.searchParams.get('archived') === 'true';

      try {
        // `balance_cents` em DB é coluna morta (nunca actualizada por trigger —
        // W1). Calcula-se o saldo on-read com a fórmula canónica do património
        // (`getAccountBalanceMap`, single source of truth) e sobrepõe-se ao valor
        // stored, mantendo o shape da resposta intacto (campo `balance_cents`).
        // Ambas as queries correm dentro do mesmo `withHousehold` (RLS viva).
        const { rows, balanceById } = await withHousehold(
          { userId: auth.userId, householdId: auth.householdId },
          async (tx) => {
            const [accountRows, balances] = await Promise.all([
              tx.execute<AccountRow>(sql`
                select ${ACCOUNT_COLUMNS}
                from public.accounts
                where ${archived ? sql`archived_at is not null` : sql`archived_at is null`}
                  and household_id = ${auth.householdId}::uuid
                order by name asc
                limit 200
              `),
              getAccountBalanceMap({
                db: tx,
                householdId: auth.householdId,
                includeArchived: archived,
              }),
            ]);
            return { rows: accountRows, balanceById: balances };
          },
        );

        // Sobrepõe `balance_cents` stored pelo saldo computado on-read. Fallback
        // ao valor stored caso a conta não exista no mapa (defensivo — não deve
        // ocorrer, ambas as queries são household-scoped sobre o mesmo conjunto).
        const accounts = rows.map((row) => ({
          ...row,
          balance_cents: balanceById.get(row.id) ?? row.balance_cents,
        }));

        annotateSpan(span, { statusCode: 200 });
        return NextResponse.json({ accounts });
      } catch (err) {
        annotateSpan(span, { statusCode: 500 });
        log.error({ err }, 'GET /api/financas/contas falhou');
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
    'POST /api/financas/contas',
    { method: 'POST', route: ROUTE },
    async (span): Promise<NextResponse> => {
      const log = childLogger({ route: ROUTE, method: 'POST' });
      const auth = await requireAuth(span);
      if (auth instanceof NextResponse) return auth;

      let body;
      try {
        body = AccountCreateSchema.parse(await req.json());
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
        // `balance_cents` inicializado = `initial_balance_cents` (snapshot, DP-4.2.4).
        // Operação principal (INSERT) dentro de `withHousehold` (RLS-enforced, 2.ª rede).
        const rows = await withHousehold(
          { userId: auth.userId, householdId: auth.householdId },
          (tx) =>
            tx.execute<AccountRow>(sql`
              insert into public.accounts
                (household_id, name, account_type, bank_name, iban_last4, initial_balance_cents, balance_cents)
              values (
                ${auth.householdId}::uuid,
                ${body.name},
                ${body.account_type}::account_type,
                ${body.bank_name ?? null},
                ${body.iban_last4 ?? null},
                ${body.initial_balance_cents},
                ${body.initial_balance_cents}
              )
              returning ${ACCOUNT_COLUMNS}
            `),
        );

        const account = rows[0];
        if (!account) throw new Error('INSERT account retornou sem rows.');

        try {
          await insertAuditLog({
            db,
            householdId: auth.householdId,
            userId: auth.userId,
            action: 'account.created',
            entityTable: 'accounts',
            entityId: account.id,
            afterState: {
              name: account.name,
              account_type: account.account_type,
              initial_balance_cents: account.initial_balance_cents,
            },
          });
        } catch (auditErr) {
          log.warn({ err: auditErr }, 'audit_log INSERT falhou (best-effort)');
        }

        annotateSpan(span, { statusCode: 201 });
        return NextResponse.json({ account }, { status: 201 });
      } catch (err) {
        annotateSpan(span, { statusCode: 500 });
        log.error({ err }, 'POST /api/financas/contas falhou');
        captureException(err instanceof Error ? err : new Error(String(err)), {
          userId: auth.userId,
          route: ROUTE,
        });
        return apiError('INTERNAL_ERROR', 'Erro ao processar pedido. Tenta novamente.', 500);
      }
    },
  );
}
