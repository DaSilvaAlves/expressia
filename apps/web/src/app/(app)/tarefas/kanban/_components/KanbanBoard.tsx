'use client';

import type { TaskRow } from '@/lib/api-helpers/list-tasks';
import type { KanbanColumnRow } from '@/lib/api-schemas/kanban-columns';

import { KanbanColumn } from '@/app/(app)/tarefas/kanban/_components/KanbanColumn';

/**
 * `<KanbanBoard>` — layout grid CSS das colunas (Story 3.4 T5.1 / AC2).
 *
 * Renderiza grid horizontal scrollable com snap mobile. Cada `<KanbanColumn>`
 * traz o seu próprio `SortableContext`. Tokens CSS definidos em `globals.css`
 * (ver T5 + DP-3.4.4 G1.2 — `--kanban-column-min-tasks-virtualize` configurável).
 */
export interface KanbanBoardProps {
  readonly columns: readonly KanbanColumnRow[];
  readonly tasks: readonly TaskRow[];
  readonly onOpenTask: (taskId: string) => void;
}

export function KanbanBoard({ columns, tasks, onOpenTask }: KanbanBoardProps): React.ReactElement {
  return (
    <div
      role="region"
      aria-label="Quadro Kanban de tarefas"
      aria-describedby="kanban-instructions"
      className="kanban-board flex gap-4 overflow-x-auto pb-4"
      style={{
        scrollSnapType: 'x mandatory',
        scrollPaddingInline: '16px',
      }}
    >
      {columns.map((column) => {
        const colTasks = tasks
          .filter((t) => t.kanban_column_id === column.id)
          .sort((a, b) => a.kanban_position - b.kanban_position);
        return (
          <KanbanColumn
            key={column.id}
            column={column}
            tasks={colTasks}
            onOpenTask={onOpenTask}
          />
        );
      })}
    </div>
  );
}
