import type * as React from 'react';

import { captureException } from '@meu-jarvis/observability';

import { getDb } from '@/lib/agent/db-shim';
import { getTasksToday } from '@/lib/visao/queries';
import { formatDueTime, priorityDotClass } from '@/app/(app)/visao/_lib/format';
import { WidgetCard } from '@/app/(app)/visao/_components/WidgetCard';

/**
 * `<TasksTodayWidget>` — widget `tasks_today` (Story 5.6 AC4).
 *
 * RSC-direct via `getDb()` + `getTasksToday` (DP-5.6.A=B). Mostra até 5 tarefas
 * (título + hora). Empty inline: "Sem tarefas para hoje.". Rodapé "Ver todas →"
 * `/tarefas`. Try/catch defensivo (precedente `financas/este-mes`).
 *
 * Trace: Story 5.6 AC4 (tasks_today); RLS NFR5 via `getDb()`.
 */
export async function TasksTodayWidget(): Promise<React.ReactElement> {
  let count = 0;
  let tasks: Awaited<ReturnType<typeof getTasksToday>>['tasks'] = [];
  try {
    const data = await getTasksToday(getDb());
    count = data.count;
    tasks = data.tasks;
  } catch (err) {
    captureException(err instanceof Error ? err : new Error(String(err)), {
      route: '/visao',
      extra: { widget: 'tasks_today' },
    });
  }

  const visible = tasks.slice(0, 5);

  return (
    <WidgetCard title="Tarefas hoje" footer={{ label: 'Ver todas', href: '/tarefas' }}>
      {visible.length === 0 ? (
        <p className="text-neutral-500">Sem tarefas para hoje.</p>
      ) : (
        <ul className="space-y-2">
          {visible.map((task) => {
            const time = formatDueTime(task.dueTime);
            return (
              <li key={task.id} className="flex items-center gap-2">
                <span
                  aria-hidden
                  title={`Prioridade ${task.priority}`}
                  className={`h-2 w-2 shrink-0 rounded-full ${priorityDotClass(task.priority)}`}
                />
                <span className="flex-1 truncate">{task.title}</span>
                {time ? (
                  <span className="shrink-0 tabular-nums text-xs text-neutral-500">{time}</span>
                ) : null}
              </li>
            );
          })}
        </ul>
      )}
      {count > visible.length ? (
        <p className="mt-2 text-xs text-neutral-500">+{count - visible.length} mais</p>
      ) : null}
    </WidgetCard>
  );
}
