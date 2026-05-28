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
 *
 * Story 5.6 DP-5.6.A=B: SQL extraído para `@/lib/visao/queries.ts` (`getFinancesMonth`);
 * este handler é wrapper fino (chama a função + mesmo Zod parse → contrato 1:1).
 */
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
import { getFinancesMonth } from '@/lib/visao/queries';
import {
  FinancesMonthResponseSchema,
  type FinancesMonthResponse,
} from '@/lib/api-schemas/visao';

const ROUTE = '/api/visao/financas-mes';

export async function GET(): Promise<NextResponse> {
  return withSpan(
    'GET /api/visao/financas-mes',
    { method: 'GET', route: ROUTE },
    async (span): Promise<NextResponse> => {
      const log = childLogger({ route: ROUTE, method: 'GET' });
      const auth = await requireAuth(span);
      if (auth instanceof NextResponse) return auth;

      try {
        const body = await getFinancesMonth(getDb());

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
