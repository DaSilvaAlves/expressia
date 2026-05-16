'use client';

import { createContext, useCallback, useContext, useMemo, useState } from 'react';

import type { TaskRow } from '@/lib/api-helpers/list-tasks';

import { BulkActionsBar } from '@/app/(app)/tarefas/_components/BulkActionsBar';
import { SectionGroup } from '@/app/(app)/tarefas/_components/SectionGroup';
import type { SectionGroup as SectionGroupShape } from '@/app/(app)/tarefas/_lib/task-sections';

/**
 * `<TaskListClient>` — wrapper client para state de multi-select + bulk actions
 * (Story 3.3 T6.1). Provê context aos `<TaskRow>` filhos para que o checkbox
 * cada um conheça o estado de selecção sem prop drilling.
 *
 * Renderiza secções (passadas já agrupadas via prop `sections`) + `BulkActionsBar`
 * sticky-bottom quando há ≥1 seleccionada.
 */
interface BulkSelectionContextValue {
  readonly selected: ReadonlySet<string>;
  readonly toggle: (taskId: string) => void;
  readonly clear: () => void;
  readonly selectAll: (taskIds: readonly string[]) => void;
}

const BulkSelectionContext = createContext<BulkSelectionContextValue | null>(null);

export function useBulkSelection(): BulkSelectionContextValue {
  const ctx = useContext(BulkSelectionContext);
  if (!ctx) throw new Error('useBulkSelection deve ser chamado dentro de <TaskListClient>');
  return ctx;
}

export interface TaskListClientProps {
  readonly sections: readonly SectionGroupShape[];
  readonly allTaskIds: readonly string[];
  readonly nextCursor?: string | null;
}

export function TaskListClient({
  sections,
  allTaskIds,
  nextCursor,
}: TaskListClientProps): React.ReactElement {
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());

  const toggle = useCallback((taskId: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(taskId)) next.delete(taskId);
      else next.add(taskId);
      return next;
    });
  }, []);

  const clear = useCallback(() => setSelected(new Set()), []);

  const selectAll = useCallback((ids: readonly string[]) => {
    setSelected(new Set(ids));
  }, []);

  const contextValue = useMemo(
    () => ({ selected, toggle, clear, selectAll }),
    [selected, toggle, clear, selectAll],
  );

  function findTask(id: string): TaskRow | undefined {
    for (const section of sections) {
      const found = section.tasks.find((t) => t.id === id);
      if (found) return found;
    }
    return undefined;
  }

  const selectedTasks: TaskRow[] = [];
  for (const id of selected) {
    const t = findTask(id);
    if (t) selectedTasks.push(t);
  }

  return (
    <BulkSelectionContext.Provider value={contextValue}>
      <div className="space-y-6 pb-20">
        {sections.map((section) => (
          <SectionGroup key={section.key} section={section} />
        ))}
        {nextCursor && (
          <div className="flex justify-center pt-4">
            <button
              type="button"
              disabled
              title="Paginação adicional disponível na próxima versão"
              className="cursor-not-allowed rounded-md border border-black/15 bg-white px-4 py-2 text-sm font-medium text-neutral-500 dark:border-white/15 dark:bg-neutral-800"
            >
              Mostrar mais
            </button>
          </div>
        )}
      </div>
      {selected.size > 0 && (
        <BulkActionsBar
          selectedTasks={selectedTasks}
          onClear={clear}
          onSelectAll={() => selectAll(allTaskIds)}
          totalCount={allTaskIds.length}
        />
      )}
    </BulkSelectionContext.Provider>
  );
}
