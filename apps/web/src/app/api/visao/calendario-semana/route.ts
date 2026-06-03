/**
 * GET /api/visao/calendario-semana — Story 5.5 AC6.
 *
 * Retorna tarefas com `due_date` na janela [hoje, hoje+6] (timezone
 * Europe/Lisbon — OBS-2). Status NOT IN ('done', 'archived').
 *
 * Agrupamento por dia é feito em TypeScript após a query — preserva os items
 * individuais que o widget precisa de renderizar (não usar GROUP BY SQL).
 * Sempre devolve 7 entradas (dias sem tarefas têm `taskCount: 0, tasks: []`).
 *
 * Timezone: as boundaries são calculadas em Europe/Lisbon (D-5.5.4) — usamos
 * `Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Lisbon' })` para obter
 * 'YYYY-MM-DD' do dia local sem dependência de offset do servidor. Os 7 dias
 * são gerados em UTC mas formatados em Europe/Lisbon — a query SQL aplica a
 * mesma conversão para garantir consistência entre filtro e bucketing.
 *
 * Story 5.6 DP-5.6.A=B: SQL + bucketing extraídos para `@/lib/visao/queries.ts`
 * (`getCalendarWeek`); handler é wrapper fino (mesmo Zod parse → contrato 1:1).
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
import { getCalendarWeek } from '@/lib/visao/queries';
import {
  CalendarWeekResponseSchema,
  type CalendarWeekResponse,
} from '@/lib/api-schemas/visao';

const ROUTE = '/api/visao/calendario-semana';

export async function GET(): Promise<NextResponse> {
  return withSpan(
    'GET /api/visao/calendario-semana',
    { method: 'GET', route: ROUTE },
    async (span): Promise<NextResponse> => {
      const log = childLogger({ route: ROUTE, method: 'GET' });
      const auth = await requireAuth(span);
      if (auth instanceof NextResponse) return auth;

      try {
        // SEC-6 — RLS-enforced em runtime (2.ª rede); 1.ª rede mantida no helper.
        const body = await withHousehold(
          { userId: auth.userId, householdId: auth.householdId },
          (tx) => getCalendarWeek(tx, auth.householdId),
        );

        const validated = CalendarWeekResponseSchema.parse(body);
        annotateSpan(span, { statusCode: 200 });
        return NextResponse.json<CalendarWeekResponse>(validated);
      } catch (err) {
        annotateSpan(span, { statusCode: 500 });
        log.error({ err }, 'GET /api/visao/calendario-semana falhou');
        captureException(err instanceof Error ? err : new Error(String(err)), {
          userId: auth.userId,
          route: ROUTE,
        });
        return apiError('INTERNAL_ERROR', 'Erro ao processar pedido. Tenta novamente.', 500);
      }
    },
  );
}
