/**
 * GET /api/visao/briefing — Story 5.5 AC7.
 *
 * Stub do briefing diário. A geração real (LLM) será introduzida numa story
 * futura (Epic 5 ou integração Epic 2) — virá de uma tabela de cache populada
 * por um Inngest job nocturno, não chamada inline ao agent.
 *
 * Shape forward-compatible com `version: 1` (D-5.5.5 / OBS-5) — futura v2
 * poderá adicionar campos sem partir consumidores que validem contra v1.
 *
 * Auth: obrigatório (401 sem sessão).
 *
 * Story 5.6 DP-5.6.A=B: stub extraído para `@/lib/visao/queries.ts` (`getBriefing`);
 * handler é wrapper fino (mesmo Zod parse → contrato 1:1).
 */
import { NextResponse } from 'next/server';

import {
  annotateSpan,
  captureException,
  childLogger,
  withSpan,
} from '@meu-jarvis/observability';

import { apiError } from '@/lib/errors';
import { requireAuth } from '@/lib/api-helpers/auth';
import { getBriefing } from '@/lib/visao/queries';
import {
  BriefingResponseSchema,
  type BriefingResponse,
} from '@/lib/api-schemas/visao';

const ROUTE = '/api/visao/briefing';

export async function GET(): Promise<NextResponse> {
  return withSpan(
    'GET /api/visao/briefing',
    { method: 'GET', route: ROUTE },
    async (span): Promise<NextResponse> => {
      const log = childLogger({ route: ROUTE, method: 'GET' });
      const auth = await requireAuth(span);
      if (auth instanceof NextResponse) return auth;

      try {
        const body: BriefingResponse = getBriefing();
        const validated = BriefingResponseSchema.parse(body);
        annotateSpan(span, { statusCode: 200 });
        return NextResponse.json<BriefingResponse>(validated);
      } catch (err) {
        annotateSpan(span, { statusCode: 500 });
        log.error({ err }, 'GET /api/visao/briefing falhou');
        captureException(err instanceof Error ? err : new Error(String(err)), {
          userId: auth.userId,
          route: ROUTE,
        });
        return apiError('INTERNAL_ERROR', 'Erro ao processar pedido. Tenta novamente.', 500);
      }
    },
  );
}
