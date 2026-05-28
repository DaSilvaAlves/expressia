import type * as React from 'react';
import { parseISO } from 'date-fns';

import { captureException } from '@meu-jarvis/observability';
import { DateDisplay } from '@meu-jarvis/ui';

import { getDb } from '@/lib/agent/db-shim';
import { getTasksOverdue } from '@/lib/visao/queries';
import { formatDueTime, priorityDotClass } from '@/app/(app)/visao/_lib/format';
import { WidgetCard } from '@/app/(app)/visao/_components/WidgetCard';

/**
 * `<TasksOverdueWidget>` — widget `tasks_overdue` (Story 5.6 AC4 + AC4.b).
 *
 * RSC-direct via `getDb()` + `getTasksOverdue` (DP-5.6.A=B). **Hidden se vazio**
 * (DP-5.6.E / AC4.b): quando `count === 0` o widget **não renderiza nada** (nem
 * card) — devolve `null`. Caso contrário mostra até 5 atrasadas (data + título)
 * e rodapé "Ver todas →" `/tarefas`.
 *
 * Em erro de fetch, trata-se como "sem atrasadas" (`null`) — não bloqueia a
 * Visão nem mostra card de erro (decisão defensiva alinhada com `financas`).
 *
 * Trace: Story 5.6 AC4 (tasks_overdue), AC4.b, DP-5.6.E; RLS NFR5.
 */
export async function TasksOverdueWidget(): Promise<React.ReactElement | null> {
  let count = 0;
  let tasks: Awaited<ReturnType<typeof getTasksOverdue>>['tasks'] = [];
  try {
    const data = await getTasksOverdue(getDb());
    count = data.count;
    tasks = data.tasks;
  } catch (err) {
    captureException(err instanceof Error ? err : new Error(String(err)), {
      route: '/visao',
      extra: { widget: 'tasks_overdue' },
    });
    return null;
  }

  // DP-5.6.E — hidden se vazio: não renderiza nada quando não há atrasadas.
  if (count === 0) return null;

  const visible = tasks.slice(0, 5);

  return (
    <WidgetCard title="Tarefas atrasadas" footer={{ label: 'Ver todas', href: '/tarefas' }}>
      <p className="mb-2 text-xs font-medium text-red-600 dark:text-red-400">
        {count} {count === 1 ? 'tarefa atrasada' : 'tarefas atrasadas'}
      </p>
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
              <span className="shrink-0 tabular-nums text-xs text-neutral-500">
                <DateDisplay value={parseISO(task.dueDate)} preset="short" />
                {time ? ` ${time}` : ''}
              </span>
            </li>
          );
        })}
      </ul>
    </WidgetCard>
  );
}
