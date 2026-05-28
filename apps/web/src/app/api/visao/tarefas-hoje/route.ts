/**
 * GET /api/visao/tarefas-hoje — Story 5.5 AC1.
 *
 * Retorna tarefas do utilizador autenticado cujo `due_date` é hoje (timezone
 * Europe/Lisbon — OBS-2) e cujo status NOT IN ('done', 'archived').
 *
 * Limite defensivo `LIMIT 20` na query (o widget mostra no máximo 5; o `count`
 * total devolvido é exactamente o número de rows lidas — i.e. um `count` maior
 * que 20 saturará em 20). Como o widget só apresenta um teaser, esse trade-off
 * é aceite (NOTE: para a Story 5.6 considerar 2 queries se o utilizador
 * precisar do count exacto acima do limite — fora de escopo aqui).
 *
 * RLS: usa `getDb()` (role authenticated). NUNCA `getServiceDb()` em handlers
 * de utilizador (NFR5).
 *
 * Pattern canónico: D-5.5.1 — alinhado com 28+ route handlers existentes
 * (`@/lib/agent/db-shim`, `requireAuth`, `withSpan`, `apiError`, `childLogger`).
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
  TasksTodayResponseSchema,
  type TasksTodayResponse,
} from '@/lib/api-schemas/visao';

const ROUTE = '/api/visao/tarefas-hoje';

interface TaskRow {
  id: string;
  title: string;
  status: 'todo' | 'doing' | 'done' | 'archived';
  priority: 'low' | 'medium' | 'high';
  due_time: string | null;
}

export async function GET(): Promise<NextResponse> {
  return withSpan(
    'GET /api/visao/tarefas-hoje',
    { method: 'GET', route: ROUTE },
    async (span): Promise<NextResponse> => {
      const log = childLogger({ route: ROUTE, method: 'GET' });
      const auth = await requireAuth(span);
      if (auth instanceof NextResponse) return auth;

      try {
        const db = getDb();
        const rows = await db.execute<TaskRow>(sql`
          select id, title, status, priority, due_time
          from public.tasks
          where due_date = (now() at time zone 'Europe/Lisbon')::date
            and status not in ('done', 'archived')
          order by due_time asc nulls last, priority desc, created_at asc
          limit 20
        `);

        const body: TasksTodayResponse = {
          count: rows.length,
          tasks: rows.map((r) => ({
            id: r.id,
            title: r.title,
            status: r.status,
            priority: r.priority,
            dueTime: r.due_time,
          })),
        };

        // Defesa em profundidade — validação de shape antes de devolver.
        const validated = TasksTodayResponseSchema.parse(body);
        annotateSpan(span, { statusCode: 200 });
        return NextResponse.json<TasksTodayResponse>(validated);
      } catch (err) {
        annotateSpan(span, { statusCode: 500 });
        log.error({ err }, 'GET /api/visao/tarefas-hoje falhou');
        captureException(err instanceof Error ? err : new Error(String(err)), {
          userId: auth.userId,
          route: ROUTE,
        });
        return apiError('INTERNAL_ERROR', 'Erro ao processar pedido. Tenta novamente.', 500);
      }
    },
  );
}
