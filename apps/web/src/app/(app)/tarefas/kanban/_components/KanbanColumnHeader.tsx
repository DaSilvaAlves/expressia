'use client';

import type { KanbanColumnRow } from '@/lib/api-schemas/kanban-columns';

/**
 * `<KanbanColumnHeader>` — header sticky de uma coluna (Story 3.4 T5.3).
 *
 * Mostra título h3 + count (mono). Acções "configurar/eliminar/renomear" ficam
 * todas centralizadas no `<ColumnConfigSheet>` para evitar UI fragmentada (KISS).
 */
export interface KanbanColumnHeaderProps {
  readonly column: KanbanColumnRow;
  readonly count: number;
}

export function KanbanColumnHeader({
  column,
  count,
}: KanbanColumnHeaderProps): React.ReactElement {
  return (
    <header
      className="sticky top-0 z-10 flex items-center justify-between border-b border-black/10 bg-neutral-100/95 px-3 py-2 backdrop-blur dark:border-white/10 dark:bg-neutral-800/95"
      style={{ borderTopLeftRadius: 8, borderTopRightRadius: 8 }}
    >
      <h3 className="text-sm font-semibold text-neutral-900 dark:text-neutral-100">
        {column.name}
        {column.is_done_column && (
          <span
            title="Coluna final — tarefas movidas para aqui ficam concluídas"
            aria-label="Coluna final"
            className="ml-2 inline-block rounded bg-green-100 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wider text-green-700 dark:bg-green-950/40 dark:text-green-300"
          >
            Final
          </span>
        )}
      </h3>
      <span
        aria-hidden="true"
        className="font-mono text-xs text-neutral-500 dark:text-neutral-400"
      >
        {count}
      </span>
    </header>
  );
}
