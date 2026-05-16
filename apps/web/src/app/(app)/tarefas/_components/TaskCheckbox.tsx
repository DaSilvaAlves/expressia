'use client';

import { useBulkSelection } from '@/app/(app)/tarefas/_components/TaskListClient';

/**
 * `<TaskCheckbox>` — checkbox controlado pelo context de selecção (Story 3.3 T4.6).
 */
export interface TaskCheckboxProps {
  readonly taskId: string;
  readonly disabled?: boolean;
}

export function TaskCheckbox({ taskId, disabled }: TaskCheckboxProps): React.ReactElement {
  const { selected, toggle } = useBulkSelection();
  const isChecked = selected.has(taskId);

  return (
    <input
      type="checkbox"
      checked={isChecked}
      onChange={() => toggle(taskId)}
      disabled={disabled}
      aria-label="Seleccionar tarefa"
      className="h-4 w-4 cursor-pointer rounded border-black/20 dark:border-white/20"
    />
  );
}
