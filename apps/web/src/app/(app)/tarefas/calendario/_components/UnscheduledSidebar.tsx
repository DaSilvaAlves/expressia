'use client';

import { memo } from 'react';
import Link from 'next/link';
import { useDroppable } from '@dnd-kit/core';
import { SortableContext, verticalListSortingStrategy } from '@dnd-kit/sortable';

import type { TaskRow } from '@/lib/api-helpers/list-tasks';

import { CalendarTaskCard } from '@/app/(app)/tarefas/calendario/_components/CalendarTaskCard';
import { CalendarAddInline } from '@/app/(app)/tarefas/calendario/_components/CalendarAddInline';

/**
 * `<UnscheduledSidebar>` — coluna lateral "Por agendar" (Story 3.5 AC6).
 *
 * - Lista tarefas com `due_date IS NULL` (limit 50 server-side).
 * - Drop-target bidirecional via `useDroppable` id `unscheduled`.
 * - Empty state PT-PT.
 * - "Ver mais" link se count > 50.
 */
export interface UnscheduledSidebarProps {
  readonly tasks: readonly TaskRow[];
  readonly totalCount?: number;
  readonly onOpenTask?: (taskId: string) => void;
  readonly onToggleChecked?: (taskId: string, nextChecked: boolean) => void;
  readonly compact?: boolean;
}

function UnscheduledSidebarImpl({
  tasks,
  totalCount,
  onOpenTask,
  onToggleChecked,
  compact,
}: UnscheduledSidebarProps): React.ReactElement {
  const droppable = useDroppable({
    id: 'unscheduled',
    data: { type: 'unscheduled' },
  });

  const count = tasks.length;
  const hasMore = typeof totalCount === 'number' && totalCount > tasks.length;

  return (
    <aside
      ref={droppable.setNodeRef}
      role="region"
      aria-label="Tarefas por agendar"
      className={`flex flex-col rounded-md border bg-white text-sm dark:bg-neutral-900 ${
        droppable.isOver
          ? 'border-2 border-dashed border-blue-500'
          : 'border-black/10 dark:border-white/10'
      } ${compact ? '' : 'min-w-[140px]'}`}
      style={{
        background: droppable.isOver ? 'var(--calendar-drop-target-bg)' : undefined,
      }}
    >
      <header
        className="flex items-center justify-between border-b border-black/5 px-3 dark:border-white/5"
        style={{ height: 'var(--calendar-day-header-height)' }}
      >
        <span className="text-sm font-semibold text-neutral-800 dark:text-neutral-200">
          Por agendar
        </span>
        <span
          aria-label={`${count} por agendar`}
          className="rounded-full bg-neutral-200 px-2 py-0.5 text-[11px] font-semibold text-neutral-700 dark:bg-neutral-700 dark:text-neutral-200"
        >
          {count}
        </span>
      </header>

      <div
        className="flex min-h-[80px] flex-1 flex-col overflow-y-auto px-1 py-1"
        style={{ gap: 'var(--calendar-task-card-gap)' }}
      >
        <SortableContext items={tasks.map((t) => t.id)} strategy={verticalListSortingStrategy}>
          {count === 0 && (
            <div className="px-3 py-6 text-center text-xs italic text-neutral-500 dark:text-neutral-400">
              Não tens tarefas por agendar. Adiciona aqui ou arrasta uma para cá.
            </div>
          )}
          {tasks.map((task) => (
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
        <CalendarAddInline initialDueDate={null} placeholder="+ Adicionar sem data" />
        {hasMore && (
          <Link
            href="/tarefas?filter=sem-data"
            className="block px-3 py-2 text-center text-[11px] text-blue-600 hover:underline dark:text-blue-400"
          >
            Ver todas ({totalCount})
          </Link>
        )}
      </footer>
    </aside>
  );
}

export const UnscheduledSidebar = memo(UnscheduledSidebarImpl);
