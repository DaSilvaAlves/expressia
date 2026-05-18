'use client';

import { memo } from 'react';
import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';

import type { TaskRow } from '@/lib/api-helpers/list-tasks';
import { CalendarTaskCheckbox } from '@/app/(app)/tarefas/calendario/_components/CalendarTaskCheckbox';

/**
 * `<CalendarTaskCard>` — card compacto vista calendário (Story 3.5 AC4).
 *
 * DP-3.5.2 A: NOVO componente independente (~30px altura). Calendar denso ≠ kanban
 * espaçoso. Variant prop forçaria 2 layouts diff num componente — KISS prefere split.
 *
 * - Layout horizontal: checkbox + title truncado + priority dot.
 * - Click body → EditTaskModal (event handled em parent via onOpenTask).
 * - `useSortable` para drag entre dias.
 * - `React.memo` shallow (props primitivas).
 */

type CalendarTaskCardMode = 'cell' | 'overlay';

export interface CalendarTaskCardProps {
  readonly task: TaskRow;
  readonly mode?: CalendarTaskCardMode;
  readonly onOpen?: (taskId: string) => void;
  readonly onToggleChecked?: (taskId: string, nextChecked: boolean) => void;
}

function priorityDotClass(priority: string): string {
  switch (priority) {
    case 'high':
      return 'bg-red-500';
    case 'medium':
      return 'bg-amber-500';
    case 'low':
    default:
      return 'bg-neutral-400';
  }
}

function isOverdue(task: TaskRow): boolean {
  if (!task.due_date) return false;
  if (task.status === 'done' || task.status === 'archived') return false;
  const today = new Date();
  const todayIso = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
  return task.due_date < todayIso;
}

function CalendarTaskCardImpl({
  task,
  mode = 'cell',
  onOpen,
  onToggleChecked,
}: CalendarTaskCardProps): React.ReactElement {
  const sortable = useSortable({
    id: task.id,
    data: { type: 'task', taskId: task.id, sourceDayIso: task.due_date ?? null },
    disabled: mode === 'overlay',
  });

  const style: React.CSSProperties = {
    transform: CSS.Translate.toString(sortable.transform),
    transition: sortable.transition,
    opacity: sortable.isDragging ? 0.4 : 1,
    padding: 'var(--calendar-task-card-padding)',
  };

  const overdue = isOverdue(task);
  const isDone = task.status === 'done';

  return (
    <div
      ref={mode === 'overlay' ? undefined : sortable.setNodeRef}
      style={style}
      {...(mode === 'overlay' ? {} : sortable.attributes)}
      {...(mode === 'overlay' ? {} : sortable.listeners)}
      role={mode === 'overlay' ? undefined : 'button'}
      tabIndex={mode === 'overlay' ? undefined : 0}
      aria-label={`Tarefa ${task.title}${overdue ? ' (atrasada)' : ''}`}
      onClick={(event) => {
        if (mode === 'overlay') return;
        // Ignorar click se veio do checkbox (já tem stopPropagation no input).
        const target = event.target as HTMLElement;
        if (target.tagName === 'INPUT') return;
        onOpen?.(task.id);
      }}
      onKeyDown={(event) => {
        if (mode === 'overlay') return;
        if (event.key === 'Enter' && !event.defaultPrevented) {
          event.preventDefault();
          onOpen?.(task.id);
        }
      }}
      className={`group flex cursor-grab items-center gap-2 rounded-md border bg-white text-xs shadow-sm hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 dark:bg-neutral-900 ${
        overdue
          ? 'border-l-2 border-l-red-500 border-black/10 dark:border-white/10'
          : 'border-black/10 dark:border-white/10'
      } ${mode === 'overlay' ? 'shadow-lg ring-2 ring-blue-500' : ''}`}
    >
      <CalendarTaskCheckbox
        taskId={task.id}
        checked={isDone}
        title={task.title}
        disabled={mode === 'overlay'}
        onToggle={(nextChecked) => onToggleChecked?.(task.id, nextChecked)}
      />
      <span
        className={`flex-1 truncate text-[12px] font-medium leading-tight text-neutral-800 dark:text-neutral-200 ${
          isDone ? 'text-neutral-400 line-through dark:text-neutral-600' : ''
        }`}
      >
        {task.title}
      </span>
      <span
        aria-hidden="true"
        title={`Prioridade ${task.priority}`}
        className={`h-2 w-2 shrink-0 rounded-full ${priorityDotClass(task.priority)}`}
      />
    </div>
  );
}

export const CalendarTaskCard = memo(CalendarTaskCardImpl);
