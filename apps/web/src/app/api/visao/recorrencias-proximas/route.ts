/**
 * GET /api/visao/recorrencias-proximas — Story 5.5 AC4.
 *
 * Retorna recorrências activas com `next_run_on` na janela
 * (hoje, hoje+30 dias]. Limite 10. Ordenadas por data ascendente.
 *
 * Timezone: a janela é calculada em Europe/Lisbon (OBS-2) — mesmo critério
 * dos handlers de tarefas.
 *
 * Índice explorado: `recurrences_next_run_idx` (finance.ts:268).
 *
 * Schema `kind` validado contra `transactionKindEnum` (finance.ts:52 — match
 * byte-a-byte: expense | income | transfer) e `frequency` contra
 * `recurrenceFreqFinanceEnum` (finance.ts:68 — daily | weekly | biweekly |
 * monthly | quarterly | yearly | custom).
 *
 * Story 5.6 DP-5.6.A=B: SQL extraído para `@/lib/visao/queries.ts`
 * (`getRecurrencesNext`); handler é wrapper fino (mesmo Zod parse → contrato 1:1).
 */
import { NextResponse } from 'next/server';

import {
  annotateSpan,
  captureException,
  childLogger,
  withSpan,
} from '@meu-jarvis/observability';

import { apiError } from '@/lib/errors';
import { withHousehold } from '@/lib/agent/db-shim';
import { requireAuth } from '@/lib/api-helpers/auth';
import { getRecurrencesNext } from '@/lib/visao/queries';
import {
  RecurrencesNextResponseSchema,
  type RecurrencesNextResponse,
} from '@/lib/api-schemas/visao';

const ROUTE = '/api/visao/recorrencias-proximas';

export async function GET(): Promise<NextResponse> {
  return withSpan(
    'GET /api/visao/recorrencias-proximas',
    { method: 'GET', route: ROUTE },
    async (span): Promise<NextResponse> => {
      const log = childLogger({ route: ROUTE, method: 'GET' });
      const auth = await requireAuth(span);
      if (auth instanceof NextResponse) return auth;

      try {
        // SEC-6 — RLS-enforced em runtime (2.ª rede); 1.ª rede mantida no helper.
        const body = await withHousehold(
          { userId: auth.userId, householdId: auth.householdId },
          (tx) => getRecurrencesNext(tx, auth.householdId),
        );

        const validated = RecurrencesNextResponseSchema.parse(body);
        annotateSpan(span, { statusCode: 200 });
        return NextResponse.json<RecurrencesNextResponse>(validated);
      } catch (err) {
        annotateSpan(span, { statusCode: 500 });
        log.error({ err }, 'GET /api/visao/recorrencias-proximas falhou');
        captureException(err instanceof Error ? err : new Error(String(err)), {
          userId: auth.userId,
          route: ROUTE,
        });
        return apiError('INTERNAL_ERROR', 'Erro ao processar pedido. Tenta novamente.', 500);
      }
    },
  );
}
