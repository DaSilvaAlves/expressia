'use client';

import { useMemo } from 'react';

import type { TaskRow } from '@/lib/api-helpers/list-tasks';

import { DayColumn } from '@/app/(app)/tarefas/calendario/_components/DayColumn';
import {
  buildWeekDays,
  toDayIso,
} from '@/app/(app)/tarefas/calendario/_components/week-helpers';

/**
 * `<WeekView>` — grid 7 colunas (Story 3.5 AC2, AC3).
 *
 * - Desktop ≥ 1024px: 7 colunas iguais.
 * - Mobile/tablet: scroll-snap horizontal (DP-3.5.3 A). 1 dia por viewport com snap.
 * - Agrupa tasks por `due_date` (string compare `YYYY-MM-DD` — sem TZ shift).
 */
export interface WeekViewProps {
  readonly weekStart: Date;
  readonly tasks: readonly TaskRow[];
  readonly onOpenTask?: (taskId: string) => void;
  readonly onToggleChecked?: (taskId: string, nextChecked: boolean) => void;
}

export function WeekView({
  weekStart,
  tasks,
  onOpenTask,
  onToggleChecked,
}: WeekViewProps): React.ReactElement {
  const days = useMemo(() => buildWeekDays(weekStart), [weekStart]);

  /** Agrupamento O(n) por `due_date` string — sem TZ shift (G1.3). */
  const tasksByDay = useMemo(() => {
    const map = new Map<string, TaskRow[]>();
    for (const task of tasks) {
      if (!task.due_date) continue;
      // task.due_date é PG `date` type — string YYYY-MM-DD directa.
      const bucket = map.get(task.due_date);
      if (bucket) {
        bucket.push(task);
      } else {
        map.set(task.due_date, [task]);
      }
    }
    return map;
  }, [tasks]);

  return (
    <div
      className="grid w-full snap-x snap-mandatory grid-flow-col auto-cols-[100%] gap-2 overflow-x-auto pb-2 md:auto-cols-[33%] lg:grid-flow-row lg:auto-cols-auto lg:grid-cols-7 lg:overflow-visible"
      style={{ gap: 'var(--calendar-day-gap)' }}
    >
      {days.map((date) => {
        const dayIso = toDayIso(date);
        const dayTasks = tasksByDay.get(dayIso) ?? [];
        return (
          <DayColumn
            key={dayIso}
            date={date}
            dayIso={dayIso}
            tasks={dayTasks}
            onOpenTask={onOpenTask}
            onToggleChecked={onToggleChecked}
          />
        );
      })}
    </div>
  );
}
