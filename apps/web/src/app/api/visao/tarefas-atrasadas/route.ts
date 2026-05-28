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
  TasksOverdueResponseSchema,
  type TasksOverdueResponse,
} from '@/lib/api-schemas/visao';

const ROUTE = '/api/visao/tarefas-atrasadas';

interface TaskRow {
  id: string;
  title: string;
  status: 'todo' | 'doing' | 'done' | 'archived';
  priority: 'low' | 'medium' | 'high';
  due_date: string;
  due_time: string | null;
}

interface CountRow {
  total: number;
}

export async function GET(): Promise<NextResponse> {
  return withSpan(
    'GET /api/visao/tarefas-atrasadas',
    { method: 'GET', route: ROUTE },
    async (span): Promise<NextResponse> => {
      const log = childLogger({ route: ROUTE, method: 'GET' });
      const auth = await requireAuth(span);
      if (auth instanceof NextResponse) return auth;

      try {
        const db = getDb();

        // 1. COUNT total (sem LIMIT) — para o widget exibir contador real.
        const countRows = await db.execute<CountRow>(sql`
          select count(*)::int as total
          from public.tasks
          where due_date < (now() at time zone 'Europe/Lisbon')::date
            and status not in ('done', 'archived')
        `);
        const total = countRows[0]?.total ?? 0;

        // 2. Lista paginada — LIMIT 20.
        const rows = await db.execute<TaskRow>(sql`
          select id, title, status, priority, due_date, due_time
          from public.tasks
          where due_date < (now() at time zone 'Europe/Lisbon')::date
            and status not in ('done', 'archived')
          order by due_date asc, priority desc
          limit 20
        `);

        const body: TasksOverdueResponse = {
          count: total,
          tasks: rows.map((r) => ({
            id: r.id,
            title: r.title,
            status: r.status,
            priority: r.priority,
            dueDate: r.due_date,
            dueTime: r.due_time,
          })),
        };

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
