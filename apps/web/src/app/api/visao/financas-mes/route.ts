/**
 * GET /api/visao/financas-mes — Story 5.5 AC3.
 *
 * Agrega transacções reais (não projecções) do mês corrente, agrupadas por
 * `kind`. Retorna totais em cêntimos para `<MoneyDisplay>` formatar (CON9).
 *
 * - Mês corrente determinado a nível SQL via
 *   `date_trunc('month', (now() at time zone 'Europe/Lisbon')::date)` — evita
 *   timezone edge cases (OBS-2). Janela inclusiva: [primeiro_dia_mês, hoje].
 * - `is_projected = false` exclui projecções futuras.
 * - `SUM` Drizzle/Postgres devolve `numeric` (string em JS). OBS-4: usa
 *   `parseFinanceTotal` defensivo com `Number.isFinite` (D-5.5.3) antes de
 *   colocar na resposta — fallback 0.
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
  FinancesMonthResponseSchema,
  type FinancesMonthResponse,
} from '@/lib/api-schemas/visao';

const ROUTE = '/api/visao/financas-mes';

interface AggRow {
  kind: 'expense' | 'income' | 'transfer';
  total_cents: string | null;
  transaction_count: string | number;
}

/**
 * Converte `numeric`/`bigint` (Postgres) ou `string|null` (Drizzle) para inteiro
 * defensivo. Retorna 0 quando o valor não é finito (NaN, null, undefined,
 * string mal formada). Critério Number.isFinite após parseInt (OBS-4 / D-5.5.3).
 */
function parseFinanceTotal(value: string | number | null | undefined): number {
  if (value === null || value === undefined) return 0;
  const parsed = typeof value === 'number' ? value : parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : 0;
}

export async function GET(): Promise<NextResponse> {
  return withSpan(
    'GET /api/visao/financas-mes',
    { method: 'GET', route: ROUTE },
    async (span): Promise<NextResponse> => {
      const log = childLogger({ route: ROUTE, method: 'GET' });
      const auth = await requireAuth(span);
      if (auth instanceof NextResponse) return auth;

      try {
        const db = getDb();
        const rows = await db.execute<AggRow>(sql`
          select
            kind,
            sum(amount_cents)::text as total_cents,
            count(*)::int as transaction_count
          from public.transactions
          where transaction_date >= date_trunc('month', (now() at time zone 'Europe/Lisbon')::date)
            and transaction_date <= (now() at time zone 'Europe/Lisbon')::date
            and is_projected = false
          group by kind
        `);

        let incomeTotal = 0;
        let expenseTotal = 0;
        let transactionCount = 0;
        for (const r of rows) {
          const total = parseFinanceTotal(r.total_cents);
          const cnt = parseFinanceTotal(r.transaction_count);
          transactionCount += cnt;
          if (r.kind === 'income') incomeTotal += total;
          else if (r.kind === 'expense') expenseTotal += total;
          // 'transfer' não conta como receita nem despesa — apenas no count.
        }

        const body: FinancesMonthResponse = {
          incomeTotal,
          expenseTotal,
          balance: incomeTotal - expenseTotal,
          transactionCount,
          currency: 'EUR',
        };

        const validated = FinancesMonthResponseSchema.parse(body);
        annotateSpan(span, { statusCode: 200 });
        return NextResponse.json<FinancesMonthResponse>(validated);
      } catch (err) {
        annotateSpan(span, { statusCode: 500 });
        log.error({ err }, 'GET /api/visao/financas-mes falhou');
        captureException(err instanceof Error ? err : new Error(String(err)), {
          userId: auth.userId,
          route: ROUTE,
        });
        return apiError('INTERNAL_ERROR', 'Erro ao processar pedido. Tenta novamente.', 500);
      }
    },
  );
}
