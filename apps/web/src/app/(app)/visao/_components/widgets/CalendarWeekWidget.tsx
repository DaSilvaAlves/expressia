import type * as React from 'react';
import { format, parseISO } from 'date-fns';
import { pt } from 'date-fns/locale';

import { captureException } from '@meu-jarvis/observability';

import { getDb } from '@/lib/agent/db-shim';
import { getCalendarWeek } from '@/lib/visao/queries';
import { WidgetCard } from '@/app/(app)/visao/_components/WidgetCard';

/**
 * `<CalendarWeekWidget>` — widget `calendar_week` (Story 5.6 AC4 + PO-FIX-1).
 *
 * RSC-direct via `getDb()` + `getCalendarWeek` (DP-5.6.A=B). Mostra os 7 dias da
 * semana (sempre 7 — a query devolve buckets vazios) com a contagem de tarefas
 * por dia. Rodapé "Ver calendário →" **`/tarefas/calendario`** (PO-FIX-1 — rota
 * dedicada verificada; NÃO `/tarefas`).
 *
 * Dia-da-semana abreviado PT-PT via `date-fns/pt` sobre a data civil (`parseISO`).
 *
 * Trace: Story 5.6 AC4 (calendar_week); PO-FIX-1; RLS NFR5.
 */
export async function CalendarWeekWidget({
  householdId,
}: {
  householdId: string;
}): Promise<React.ReactElement> {
  let days: Awaited<ReturnType<typeof getCalendarWeek>>['days'] = [];
  try {
    const data = await getCalendarWeek(getDb(), householdId);
    days = data.days;
  } catch (err) {
    captureException(err instanceof Error ? err : new Error(String(err)), {
      route: '/visao',
      extra: { widget: 'calendar_week' },
    });
  }

  const totalTasks = days.reduce((sum, d) => sum + d.taskCount, 0);

  return (
    <WidgetCard
      title="Calendário da semana"
      footer={{ label: 'Ver calendário', href: '/tarefas/calendario' }}
    >
      {totalTasks === 0 ? (
        <p className="text-neutral-500">Sem tarefas esta semana.</p>
      ) : (
        <ul className="grid grid-cols-7 gap-1 text-center">
          {days.map((day) => {
            const weekday = format(parseISO(day.date), 'EEEEEE', { locale: pt });
            return (
              <li key={day.date} className="flex flex-col items-center gap-1">
                <span className="text-xs capitalize text-neutral-500">{weekday}</span>
                <span
                  aria-label={`${day.taskCount} ${day.taskCount === 1 ? 'tarefa' : 'tarefas'}`}
                  className={`flex h-7 w-7 items-center justify-center rounded-full text-xs font-medium tabular-nums ${
                    day.taskCount > 0
                      ? 'bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300'
                      : 'text-neutral-400'
                  }`}
                >
                  {day.taskCount}
                </span>
              </li>
            );
          })}
        </ul>
      )}
    </WidgetCard>
  );
}
