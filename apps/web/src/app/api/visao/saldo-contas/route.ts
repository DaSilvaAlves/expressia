/**
 * GET /api/visao/saldo-contas — Story 5.5 AC5.
 *
 * Agrega saldo total das contas activas (`archived_at IS NULL`) do household
 * autenticado. Lê `balance_cents` directamente — sincronização desse campo é
 * responsabilidade de triggers ou recompute on read (finance.ts:96), fora de
 * escopo desta story.
 *
 * `SUM` Drizzle/Postgres devolve string para `numeric` — usa `parseFinanceTotal`
 * defensivo idêntico ao `/financas-mes` (D-5.5.3 / OBS-4).
 */
import { sql } from 'drizzle-orm';
import { NextResponse } from 'next/server';

import {
  annotateSpan,
  captureException,
  childLogger,
  withSpan,
} from '@meu-jarvis/observability';

import { apiError } from '@/lib/errors';
import { getDb } from '@/lib/agent/db-shim';
import { requireAuth } from '@/lib/api-helpers/auth';
import {
  AccountsBalanceResponseSchema,
  type AccountsBalanceResponse,
} from '@/lib/api-schemas/visao';

const ROUTE = '/api/visao/saldo-contas';

interface AggRow {
  account_count: string | number;
  total_balance_cents: string | null;
}

function parseFinanceTotal(value: string | number | null | undefined): number {
  if (value === null || value === undefined) return 0;
  const parsed = typeof value === 'number' ? value : parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : 0;
}

export async function GET(): Promise<NextResponse> {
  return withSpan(
    'GET /api/visao/saldo-contas',
    { method: 'GET', route: ROUTE },
    async (span): Promise<NextResponse> => {
      const log = childLogger({ route: ROUTE, method: 'GET' });
      const auth = await requireAuth(span);
      if (auth instanceof NextResponse) return auth;

      try {
        const db = getDb();
        const rows = await db.execute<AggRow>(sql`
          select
            count(*)::int as account_count,
            sum(balance_cents)::text as total_balance_cents
          from public.accounts
          where archived_at is null
        `);

        const row = rows[0];
        const body: AccountsBalanceResponse = {
          totalBalanceCents: parseFinanceTotal(row?.total_balance_cents ?? null),
          accountCount: parseFinanceTotal(row?.account_count ?? 0),
          currency: 'EUR',
        };

        const validated = AccountsBalanceResponseSchema.parse(body);
        annotateSpan(span, { statusCode: 200 });
        return NextResponse.json<AccountsBalanceResponse>(validated);
      } catch (err) {
        annotateSpan(span, { statusCode: 500 });
        log.error({ err }, 'GET /api/visao/saldo-contas falhou');
        captureException(err instanceof Error ? err : new Error(String(err)), {
          userId: auth.userId,
          route: ROUTE,
        });
        return apiError('INTERNAL_ERROR', 'Erro ao processar pedido. Tenta novamente.', 500);
      }
    },
  );
}
