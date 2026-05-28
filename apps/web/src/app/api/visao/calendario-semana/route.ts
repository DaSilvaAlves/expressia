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
  CalendarWeekResponseSchema,
  type CalendarWeekDay,
  type CalendarWeekResponse,
} from '@/lib/api-schemas/visao';

const ROUTE = '/api/visao/calendario-semana';

interface TaskRow {
  id: string;
  title: string;
  priority: 'low' | 'medium' | 'high';
  due_date: string;
  due_time: string | null;
}

/**
 * Devolve 'YYYY-MM-DD' em Europe/Lisbon — usado para gerar buckets de dias.
 * `en-CA` produz exactamente o formato ISO `YYYY-MM-DD`.
 */
function toLisbonDateString(d: Date): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Lisbon',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(d);
}

/**
 * Gera 7 strings de data 'YYYY-MM-DD' começando em "hoje (Lisbon)" e
 * incrementando por 1 dia. Avança 24h em UTC e re-formata em Lisbon — pula DST
 * naturalmente porque o `Intl.DateTimeFormat` aplica o offset correcto.
 */
function buildWeekDays(now: Date): string[] {
  const days: string[] = [];
  // Âncora: meio-dia UTC para evitar precision issues perto da meia-noite.
  const anchor = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 12, 0, 0),
  );
  for (let i = 0; i < 7; i++) {
    const d = new Date(anchor.getTime() + i * 24 * 60 * 60 * 1000);
    days.push(toLisbonDateString(d));
  }
  return days;
}

export async function GET(): Promise<NextResponse> {
  return withSpan(
    'GET /api/visao/calendario-semana',
    { method: 'GET', route: ROUTE },
    async (span): Promise<NextResponse> => {
      const log = childLogger({ route: ROUTE, method: 'GET' });
      const auth = await requireAuth(span);
      if (auth instanceof NextResponse) return auth;

      try {
        const db = getDb();
        const rows = await db.execute<TaskRow>(sql`
          select id, title, priority, due_date, due_time
          from public.tasks
          where due_date >= (now() at time zone 'Europe/Lisbon')::date
            and due_date <= ((now() at time zone 'Europe/Lisbon')::date + interval '6 days')
            and status not in ('done', 'archived')
          order by due_date asc, due_time asc nulls last, priority desc
          limit 50
        `);

        const weekDays = buildWeekDays(new Date());
        const days: CalendarWeekDay[] = weekDays.map((date) => {
          const dayTasks = rows
            .filter((r) => r.due_date === date)
            .map((r) => ({
              id: r.id,
              title: r.title,
              priority: r.priority,
              dueTime: r.due_time,
            }));
          return {
            date,
            taskCount: dayTasks.length,
            tasks: dayTasks,
          };
        });

        const body: CalendarWeekResponse = { days };
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
