'use client';

import { memo } from 'react';
import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';

/**
 * `<KanbanCard>` — card draggable de tarefa (Story 3.4 T6.1 / AC3).
 *
 * Guidance Aria G1.1 — `memo` com comparador shallow (props primitivas). Todas as
 * props são strings, numbers, booleans ou refs estáveis (callbacks via useCallback
 * no parent). Comparator default do `memo` é shallow `Object.is`.
 *
 * Drag handle implícito (DP-3.4.1 A — todo o card draggable). Click body abre
 * EditTaskModal (gerido no parent via onOpen). `activationConstraint distance: 8`
 * configurado no PointerSensor distingue click de drag.
 *
 * Estados visuais:
 *   - rest: shadow-sm + cursor padrão
 *   - hover: shadow-md + cursor grab
 *   - focus-visible: ring 2px var(--primary)
 *   - dragging: opacity 0.4 (original card stays in place)
 *   - overdue: border-left 3px var(--danger)
 *   - prefers-reduced-motion: sem rotate/scale transitions
 */
export interface KanbanCardProps {
  readonly taskId: string;
  readonly title: string;
  readonly dueDate: string | null;
  readonly priority: string;
  readonly status: string;
  readonly isOverdue: boolean;
  readonly onOpen: () => void;
}

function formatPT(iso: string): string {
  const [, m, d] = iso.split('-');
  return `${d}/${m}`;
}

const PRIORITY_DOT: Record<string, string> = {
  high: 'bg-red-500',
  medium: 'bg-yellow-500',
  low: 'bg-transparent',
};

function KanbanCardImpl({
  taskId,
  title,
  dueDate,
  priority,
  status,
  isOverdue,
  onOpen,
}: KanbanCardProps): React.ReactElement {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({
    id: taskId,
    data: { type: 'task', taskId },
  });

  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.4 : 1,
    touchAction: 'manipulation',
  };

  const isCompleted = status === 'done';
  const overdueClass = isOverdue ? 'border-l-4 border-l-red-500' : '';
  const completedClass = isCompleted ? 'line-through opacity-60' : '';

  function handleClick(e: React.MouseEvent): void {
    // Evita abrir modal se foi um drag (drag suprime o click no @dnd-kit listeners).
    // Stop propagation para evitar duplo dispatch quando o card também é droppable
    e.stopPropagation();
    onOpen();
  }

  function handleKeyDown(e: React.KeyboardEvent): void {
    // Enter sobre card (sem drag activo) abre modal. Space é reservado para @dnd-kit pick-up.
    if (e.key === 'Enter' && !isDragging) {
      e.preventDefault();
      onOpen();
    }
  }

  return (
    <li
      ref={setNodeRef}
      style={style}
      {...attributes}
      {...listeners}
      role="listitem"
      aria-roledescription="Tarefa arrastável"
      aria-label={`Tarefa: ${title}${isOverdue ? ', atrasada' : ''}${isCompleted ? ', concluída' : ''}`}
      tabIndex={0}
      onClick={handleClick}
      onKeyDown={handleKeyDown}
      className={`group cursor-grab rounded-md border border-black/10 bg-white p-3 shadow-sm transition-shadow hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 active:cursor-grabbing dark:border-white/10 dark:bg-neutral-800 ${overdueClass} ${completedClass}`}
    >
      <div className="flex items-start justify-between gap-2">
        <p className="flex-1 text-sm font-medium leading-snug text-neutral-900 dark:text-neutral-100">
          {title}
        </p>
        <span
          aria-hidden="true"
          className={`mt-1 inline-block h-2 w-2 shrink-0 rounded-full ${PRIORITY_DOT[priority] ?? 'bg-transparent'}`}
          title={`Prioridade: ${priority}`}
        />
      </div>

      {dueDate && (
        <div className="mt-2 flex items-center gap-2 text-xs text-neutral-600 dark:text-neutral-400">
          <span
            aria-label={`Prazo: ${formatPT(dueDate)}`}
            className={`font-mono ${isOverdue ? 'font-semibold text-red-600 dark:text-red-400' : ''}`}
          >
            📅 {formatPT(dueDate)}
          </span>
        </div>
      )}
    </li>
  );
}

export const KanbanCard = memo(KanbanCardImpl);
