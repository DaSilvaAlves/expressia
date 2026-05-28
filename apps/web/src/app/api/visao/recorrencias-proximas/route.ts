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
  RecurrencesNextResponseSchema,
  type RecurrencesNextResponse,
} from '@/lib/api-schemas/visao';

const ROUTE = '/api/visao/recorrencias-proximas';

interface RecurrenceRow {
  id: string;
  description: string;
  kind: 'expense' | 'income' | 'transfer';
  amount_cents: number;
  frequency:
    | 'daily'
    | 'weekly'
    | 'biweekly'
    | 'monthly'
    | 'quarterly'
    | 'yearly'
    | 'custom';
  next_run_on: string;
}

export async function GET(): Promise<NextResponse> {
  return withSpan(
    'GET /api/visao/recorrencias-proximas',
    { method: 'GET', route: ROUTE },
    async (span): Promise<NextResponse> => {
      const log = childLogger({ route: ROUTE, method: 'GET' });
      const auth = await requireAuth(span);
      if (auth instanceof NextResponse) return auth;

      try {
        const db = getDb();
        const rows = await db.execute<RecurrenceRow>(sql`
          select id, description, kind, amount_cents, frequency, next_run_on
          from public.recurrences
          where active = true
            and next_run_on > (now() at time zone 'Europe/Lisbon')::date
            and next_run_on <= ((now() at time zone 'Europe/Lisbon')::date + interval '30 days')
          order by next_run_on asc
          limit 10
        `);

        const body: RecurrencesNextResponse = {
          count: rows.length,
          recurrences: rows.map((r) => ({
            id: r.id,
            description: r.description,
            kind: r.kind,
            amountCents: r.amount_cents,
            frequency: r.frequency,
            nextRunOn: r.next_run_on,
          })),
        };

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
