'use client';

import { memo } from 'react';
import { useDroppable } from '@dnd-kit/core';
import { SortableContext, verticalListSortingStrategy } from '@dnd-kit/sortable';

import type { TaskRow } from '@/lib/api-helpers/list-tasks';

import { CalendarTaskCard } from '@/app/(app)/tarefas/calendario/_components/CalendarTaskCard';
import { CalendarAddInline } from '@/app/(app)/tarefas/calendario/_components/CalendarAddInline';
import {
  formatDayShort,
  formatDayMonth,
  isToday,
  type DayIso,
} from '@/app/(app)/tarefas/calendario/_components/week-helpers';

/**
 * Ordem padrão das tasks dentro de um dia.
 *
 * G3.1 Aria: ordenação automática NÃO persistida (DP-3.5.6 KISS).
 *   - Priority desc (high > medium > low)
 *   - Created_at asc (mais antigas no topo)
 *
 * Exportável testable. Comment header documenta intent.
 */
export function sortTasksForDay(tasks: readonly TaskRow[]): readonly TaskRow[] {
  const priorityRank: Record<string, number> = { high: 1, medium: 2, low: 3 };
  return [...tasks].sort((a, b) => {
    const pa = priorityRank[a.priority] ?? 4;
    const pb = priorityRank[b.priority] ?? 4;
    if (pa !== pb) return pa - pb;
    return a.created_at < b.created_at ? -1 : a.created_at > b.created_at ? 1 : 0;
  });
}

/**
 * `<DayColumn>` — coluna sortable para um dia da semana (Story 3.5 AC3).
 *
 * - Header sticky PT-PT ("Seg" + "14 Mai"). Hoje destacado.
 * - Body scrollable: lista filtered + sorted (`sortTasksForDay`).
 * - Footer: `CalendarAddInline` com `initialDueDate=dayIso`.
 * - Drop-target: `useDroppable` com data `{ type: 'day', dayIso }`.
 */
export interface DayColumnProps {
  readonly date: Date;
  readonly dayIso: DayIso;
  readonly tasks: readonly TaskRow[];
  readonly onOpenTask?: (taskId: string) => void;
  readonly onToggleChecked?: (taskId: string, nextChecked: boolean) => void;
}

function DayColumnImpl({
  date,
  dayIso,
  tasks,
  onOpenTask,
  onToggleChecked,
}: DayColumnProps): React.ReactElement {
  const droppable = useDroppable({
    id: `day:${dayIso}`,
    data: { type: 'day', dayIso },
  });

  const today = isToday(date);
  const dayShort = formatDayShort(date);
  const dayMonth = formatDayMonth(date);
  const sorted = sortTasksForDay(tasks);

  return (
    <section
      ref={droppable.setNodeRef}
      role="region"
      aria-label={`Tarefas para ${dayShort} ${dayMonth}`}
      data-day-iso={dayIso}
      className={`flex min-w-[140px] flex-col rounded-md border bg-neutral-50/60 dark:bg-neutral-900/40 ${
        droppable.isOver
          ? 'border-2 border-dashed border-blue-500'
          : 'border-black/10 dark:border-white/10'
      }`}
      style={{
        background: droppable.isOver
          ? 'var(--calendar-drop-target-bg)'
          : today
            ? 'var(--calendar-day-today-bg)'
            : undefined,
        scrollSnapAlign: 'start',
      }}
    >
      <header
        className={`sticky top-0 z-10 flex items-baseline justify-between border-b px-2 ${
          today
            ? 'border-blue-500 bg-white/95 dark:bg-neutral-900/95'
            : 'border-black/5 bg-white/80 dark:border-white/5 dark:bg-neutral-900/80'
        }`}
        style={{ height: 'var(--calendar-day-header-height)' }}
      >
        <span
          className={`text-[11px] font-semibold uppercase tracking-wide ${
            today ? 'text-blue-600 dark:text-blue-400' : 'text-neutral-500 dark:text-neutral-400'
          }`}
        >
          {dayShort}
        </span>
        <span
          className={`text-sm font-semibold ${
            today ? 'text-blue-600 dark:text-blue-400' : 'text-neutral-800 dark:text-neutral-200'
          }`}
        >
          {dayMonth}
        </span>
      </header>

      <div
        className="flex min-h-[60px] flex-1 flex-col overflow-y-auto px-1 py-1"
        style={{ gap: 'var(--calendar-task-card-gap)' }}
      >
        <SortableContext items={sorted.map((t) => t.id)} strategy={verticalListSortingStrategy}>
          {sorted.length === 0 && droppable.isOver && (
            <p className="px-2 py-3 text-center text-[11px] italic text-neutral-500 dark:text-neutral-400">
              Largar aqui
            </p>
          )}
          {sorted.length === 0 && !droppable.isOver && (
            <p className="px-2 py-3 text-center text-[11px] italic text-neutral-400 dark:text-neutral-600">
              —
            </p>
          )}
          {sorted.map((task) => (
            <CalendarTaskCard
              key={task.id}
              task={task}
              onOpen={onOpenTask}
              onToggleChecked={onToggleChecked}
            />
          ))}
        </SortableContext>
      </div>

      <footer className="border-t border-black/5 dark:border-white/5">
        <CalendarAddInline initialDueDate={dayIso} placeholder="+ Adicionar" />
      </footer>
    </section>
  );
}

export const DayColumn = memo(DayColumnImpl);
