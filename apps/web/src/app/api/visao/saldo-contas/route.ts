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
 *
 * Story 5.6 DP-5.6.A=B: SQL extraído para `@/lib/visao/queries.ts`
 * (`getAccountsBalance`); handler é wrapper fino (mesmo Zod parse → contrato 1:1).
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
import { getAccountsBalance } from '@/lib/visao/queries';
import {
  AccountsBalanceResponseSchema,
  type AccountsBalanceResponse,
} from '@/lib/api-schemas/visao';

const ROUTE = '/api/visao/saldo-contas';

export async function GET(): Promise<NextResponse> {
  return withSpan(
    'GET /api/visao/saldo-contas',
    { method: 'GET', route: ROUTE },
    async (span): Promise<NextResponse> => {
      const log = childLogger({ route: ROUTE, method: 'GET' });
      const auth = await requireAuth(span);
      if (auth instanceof NextResponse) return auth;

      try {
        const body = await getAccountsBalance(getDb(), auth.householdId);

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
