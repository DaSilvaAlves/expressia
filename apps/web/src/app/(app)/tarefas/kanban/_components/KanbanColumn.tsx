'use client';

import { useMemo, useState } from 'react';
import { useDroppable } from '@dnd-kit/core';
import { SortableContext, verticalListSortingStrategy } from '@dnd-kit/sortable';

import type { TaskRow } from '@/lib/api-helpers/list-tasks';
import type { KanbanColumnRow } from '@/lib/api-schemas/kanban-columns';

import { KanbanColumnHeader } from '@/app/(app)/tarefas/kanban/_components/KanbanColumnHeader';
import { KanbanCard } from '@/app/(app)/tarefas/kanban/_components/KanbanCard';
import { KanbanAddInline } from '@/app/(app)/tarefas/kanban/_components/KanbanAddInline';

/**
 * `<KanbanColumn>` — uma coluna do quadro (Story 3.4 T5.2).
 *
 * - SortableContext per coluna com vertical strategy (@dnd-kit pattern para listas)
 * - Droppable (useDroppable) para que drops sobre header / espaço vazio funcionem
 * - Footer "Ver mais N →" se tasks > VIRTUALIZE_THRESHOLD (G1.3 — scroll vertical interno)
 *
 * Naive render — sem virtualização (DP-3.4.4 A — token configurável, default 50).
 * Acima de 50, mostra 50 + "Ver mais" link que faz scroll vertical interno + revela
 * próximo chunk incrementalmente (G1.3 — chunk size 25).
 */
export interface KanbanColumnProps {
  readonly column: KanbanColumnRow;
  readonly tasks: readonly TaskRow[];
  readonly onOpenTask: (taskId: string) => void;
}

const DEFAULT_INITIAL_VISIBLE = 50;
const CHUNK_SIZE = 25;

export function KanbanColumn({ column, tasks, onOpenTask }: KanbanColumnProps): React.ReactElement {
  const [visibleCount, setVisibleCount] = useState(DEFAULT_INITIAL_VISIBLE);
  const { setNodeRef, isOver } = useDroppable({
    id: column.id,
    data: { type: 'column', columnId: column.id },
  });

  const taskIds = useMemo(() => tasks.map((t) => t.id), [tasks]);
  const visibleTasks = useMemo(() => tasks.slice(0, visibleCount), [tasks, visibleCount]);
  const hiddenCount = tasks.length - visibleTasks.length;

  function handleShowMore(): void {
    setVisibleCount((prev) => Math.min(prev + CHUNK_SIZE, tasks.length));
  }

  return (
    <section
      ref={setNodeRef}
      aria-label={`${column.name}, ${tasks.length} tarefas`}
      className={
        isOver
          ? 'flex w-72 shrink-0 flex-col rounded-lg border-2 border-dashed border-blue-500 bg-blue-50/50 transition-colors dark:bg-blue-950/20'
          : 'flex w-72 shrink-0 flex-col rounded-lg border border-black/10 bg-neutral-50 transition-colors dark:border-white/10 dark:bg-neutral-900/40'
      }
      style={{ scrollSnapAlign: 'start', minHeight: 200 }}
    >
      <KanbanColumnHeader column={column} count={tasks.length} />

      <div
        className="flex-1 overflow-y-auto px-2 py-2"
        style={{ contentVisibility: 'auto', containIntrinsicSize: '0 500px' }}
      >
        <SortableContext items={taskIds} strategy={verticalListSortingStrategy}>
          <ul role="list" className="flex flex-col gap-2">
            {visibleTasks.length === 0 ? (
              <li
                role="listitem"
                className="rounded-md border border-dashed border-black/15 px-3 py-4 text-center text-xs italic text-neutral-500 dark:border-white/15 dark:text-neutral-400"
              >
                {isOver ? 'Arrasta aqui.' : 'Sem tarefas. Adiciona uma.'}
              </li>
            ) : (
              visibleTasks.map((task) => (
                <KanbanCard
                  key={task.id}
                  taskId={task.id}
                  title={task.title}
                  dueDate={task.due_date}
                  priority={task.priority}
                  status={task.status}
                  isOverdue={isOverdueTask(task)}
                  onOpen={() => onOpenTask(task.id)}
                />
              ))
            )}
          </ul>
        </SortableContext>

        {hiddenCount > 0 && (
          <button
            type="button"
            onClick={handleShowMore}
            className="mt-2 w-full rounded-md border border-black/10 bg-white px-2 py-1.5 text-xs text-blue-700 hover:bg-blue-50 dark:border-white/10 dark:bg-neutral-800 dark:text-blue-300 dark:hover:bg-blue-950/30"
          >
            Ver mais {hiddenCount} →
          </button>
        )}
      </div>

      <div className="border-t border-black/5 px-2 py-2 dark:border-white/5">
        <KanbanAddInline columnId={column.id} nextPosition={tasks.length} />
      </div>
    </section>
  );
}

function isOverdueTask(task: TaskRow): boolean {
  if (!task.due_date) return false;
  if (task.status === 'done' || task.status === 'archived') return false;
  const today = new Date();
  const todayISO = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(
    today.getDate(),
  ).padStart(2, '0')}`;
  return task.due_date < todayISO;
}
