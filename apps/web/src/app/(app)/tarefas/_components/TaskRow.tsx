'use client';

import { useState } from 'react';

import type { TaskRow as TaskRowType } from '@/lib/api-helpers/list-tasks';

import { EditTaskModal } from '@/app/(app)/tarefas/_components/EditTaskModal';
import { InlineEditTitle } from '@/app/(app)/tarefas/_components/InlineEditTitle';
import { RowActionsMenu } from '@/app/(app)/tarefas/_components/RowActionsMenu';
import { TagBadge } from '@/app/(app)/tarefas/_components/TagBadge';
import { TaskCheckbox } from '@/app/(app)/tarefas/_components/TaskCheckbox';
import { getDaysOverdue } from '@/app/(app)/tarefas/_lib/task-sections';

/**
 * `<TaskRow>` — linha individual de tarefa (Story 3.3 T4.5).
 *
 * Responsive: `< md` empilha vertical (card); `>= md` horizontal table-like.
 * Componentes interactivos (checkbox, inline edit, row actions menu) são
 * client islands compostas. Visual destacado para Atrasadas (border-l + label).
 */
export interface TaskRowProps {
  readonly task: TaskRowType;
  readonly highlightOverdue?: boolean;
}

const PRIORITY_LABEL_PT: Record<string, string> = {
  high: 'Alta',
  medium: 'Média',
  low: 'Baixa',
};

const PRIORITY_BADGE_CLASS: Record<string, string> = {
  high: 'bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300',
  medium: 'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300',
  low: 'bg-neutral-100 text-neutral-700 dark:bg-neutral-800 dark:text-neutral-300',
};

const STATUS_LABEL_PT: Record<string, string> = {
  todo: 'A fazer',
  doing: 'Em curso',
  done: 'Concluído',
  archived: 'Arquivado',
};

function formatDuePT(due_date: string | null): string | null {
  if (!due_date) return null;
  const [y, m, d] = due_date.split('-');
  if (!y || !m || !d) return null;
  return `${d}/${m}/${y}`;
}

const TAG_LIST_LIMIT = 3;

export function TaskRow({ task, highlightOverdue }: TaskRowProps): React.ReactElement {
  const [editOpen, setEditOpen] = useState(false);
  const dueLabel = formatDuePT(task.due_date);
  const overdueLabel = highlightOverdue ? getDaysOverdue(task.due_date) : null;
  const isDone = task.status === 'done';
  // Story 3.6 T6.1 — até 3 badges + chip muted `+N` se excede (SF-3.6.1).
  const tags = task.tags ?? [];
  const visibleTags = tags.slice(0, TAG_LIST_LIMIT);
  const extraTagCount = Math.max(0, tags.length - TAG_LIST_LIMIT);

  return (
    <>
      <div
        className={
          (highlightOverdue
            ? 'border-l-2 border-l-red-500 '
            : 'border-l-2 border-l-transparent ') +
          'flex flex-col items-stretch gap-2 rounded-md border border-black/10 bg-white p-3 dark:border-white/10 dark:bg-neutral-900 md:flex-row md:items-center md:gap-3'
        }
      >
        <div className="flex items-center gap-2">
          <TaskCheckbox taskId={task.id} disabled={isDone} />
        </div>
        <div className="flex-1 min-w-0">
          <div className={isDone ? 'text-sm text-neutral-500 line-through' : 'text-sm'}>
            <InlineEditTitle taskId={task.id} initialTitle={task.title} />
          </div>
          {task.project && (
            <span className="mt-0.5 inline-block text-xs text-neutral-500 dark:text-neutral-500">
              {task.project}
            </span>
          )}
          {tags.length > 0 && (
            <ul role="list" aria-label="Tags" className="mt-1 flex flex-wrap items-center gap-1">
              {visibleTags.map((t) => (
                <TagBadge key={t.id} tag={t} size="sm" />
              ))}
              {extraTagCount > 0 && (
                <span className="rounded-full bg-neutral-100 px-2 py-0.5 text-xs text-neutral-600 dark:bg-neutral-800 dark:text-neutral-400">
                  +{extraTagCount}
                </span>
              )}
            </ul>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-2 text-xs">
          {dueLabel && (
            <span
              className={
                highlightOverdue
                  ? 'rounded bg-red-50 px-1.5 py-0.5 text-red-700 dark:bg-red-950/40 dark:text-red-300'
                  : 'rounded bg-neutral-50 px-1.5 py-0.5 text-neutral-700 dark:bg-neutral-800 dark:text-neutral-300'
              }
              aria-label="prazo"
            >
              {dueLabel}
            </span>
          )}
          {overdueLabel && (
            <span className="text-xs text-red-700 dark:text-red-300" aria-label="dias atrasada">
              ⚠ {overdueLabel}
            </span>
          )}
          <span
            className={
              'rounded px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide ' +
              (PRIORITY_BADGE_CLASS[task.priority] ?? PRIORITY_BADGE_CLASS.low)
            }
          >
            {PRIORITY_LABEL_PT[task.priority] ?? task.priority}
          </span>
          {task.status !== 'todo' && (
            <span className="text-xs text-neutral-500 dark:text-neutral-500">
              {STATUS_LABEL_PT[task.status] ?? task.status}
            </span>
          )}
        </div>
        <div className="flex justify-end">
          <RowActionsMenu task={task} onEdit={() => setEditOpen(true)} />
        </div>
      </div>
      <EditTaskModal task={task} open={editOpen} onClose={() => setEditOpen(false)} />
    </>
  );
}
