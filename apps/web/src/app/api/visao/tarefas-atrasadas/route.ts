/**
 * GET /api/visao/tarefas-atrasadas — Story 5.5 AC2.
 *
 * Retorna tarefas em atraso: `due_date < hoje` (timezone Europe/Lisbon — OBS-2)
 * e status NOT IN ('done', 'archived'). LIMIT 20 na lista. O `count` total
 * (sem LIMIT) é calculado com `COUNT(*)` separado — necessário para o widget
 * exibir "N atrasadas" mesmo quando o LIMIT é atingido (D-5.5.2 / OBS-1:
 * 2-query pattern preferido sobre `COUNT(*) OVER ()` window function porque
 * permite SELECT mais barato quando count >> limit; total cost dominado por
 * `tasks_overdue_idx` em ambos os casos).
 *
 * RLS: `getDb()` exclusivamente. Índice `tasks_overdue_idx` (tasks.ts:106) é
 * explorado pela query.
 *
 * Story 5.6 DP-5.6.A=B: SQL extraído para `@/lib/visao/queries.ts` (`getTasksOverdue`);
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
import { getTasksOverdue } from '@/lib/visao/queries';
import {
  TasksOverdueResponseSchema,
  type TasksOverdueResponse,
} from '@/lib/api-schemas/visao';

const ROUTE = '/api/visao/tarefas-atrasadas';

export async function GET(): Promise<NextResponse> {
  return withSpan(
    'GET /api/visao/tarefas-atrasadas',
    { method: 'GET', route: ROUTE },
    async (span): Promise<NextResponse> => {
      const log = childLogger({ route: ROUTE, method: 'GET' });
      const auth = await requireAuth(span);
      if (auth instanceof NextResponse) return auth;

      try {
        const body = await getTasksOverdue(getDb());

        const validated = TasksOverdueResponseSchema.parse(body);
        annotateSpan(span, { statusCode: 200 });
        return NextResponse.json<TasksOverdueResponse>(validated);
      } catch (err) {
        annotateSpan(span, { statusCode: 500 });
        log.error({ err }, 'GET /api/visao/tarefas-atrasadas falhou');
        captureException(err instanceof Error ? err : new Error(String(err)), {
          userId: auth.userId,
          route: ROUTE,
        });
        return apiError('INTERNAL_ERROR', 'Erro ao processar pedido. Tenta novamente.', 500);
      }
    },
  );
}
