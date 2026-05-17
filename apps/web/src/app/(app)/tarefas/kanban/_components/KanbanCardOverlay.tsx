'use client';

import type { TaskRow } from '@/lib/api-helpers/list-tasks';

/**
 * `<KanbanCardOverlay>` — clone portal do card durante drag (Story 3.4 T6.2).
 *
 * Renderizado dentro de `<DragOverlay>` do @dnd-kit. Detalhe visual de "lift":
 *   - shadow forte
 *   - rotate 2deg + scale 1.02
 *   - `prefers-reduced-motion: reduce` → sem rotate/scale
 *
 * Mantém aparência consistente com KanbanCard mas sem listeners (overlay é só visual).
 */
export interface KanbanCardOverlayProps {
  readonly task: Pick<TaskRow, 'title' | 'due_date' | 'priority'>;
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

export function KanbanCardOverlay({ task }: KanbanCardOverlayProps): React.ReactElement {
  return (
    <>
      <style>{`
        @media (prefers-reduced-motion: no-preference) {
          .kanban-overlay-card {
            transform: rotate(2deg) scale(1.02);
          }
        }
      `}</style>
      <div
        className="kanban-overlay-card pointer-events-none w-72 rounded-md border border-black/10 bg-white p-3 dark:border-white/10 dark:bg-neutral-800"
        style={{
          boxShadow: '0 16px 32px rgba(26,26,26,0.20)',
        }}
        aria-hidden="true"
      >
        <div className="flex items-start justify-between gap-2">
          <p className="flex-1 text-sm font-medium leading-snug text-neutral-900 dark:text-neutral-100">
            {task.title}
          </p>
          <span
            aria-hidden="true"
            className={`mt-1 inline-block h-2 w-2 shrink-0 rounded-full ${PRIORITY_DOT[task.priority] ?? 'bg-transparent'}`}
          />
        </div>
        {task.due_date && (
          <div className="mt-2 text-xs text-neutral-600 dark:text-neutral-400">
            <span className="font-mono">📅 {formatPT(task.due_date)}</span>
          </div>
        )}
      </div>
    </>
  );
}
