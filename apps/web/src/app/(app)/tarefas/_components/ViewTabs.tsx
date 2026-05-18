import Link from 'next/link';

/**
 * `<ViewTabs>` — tabs Lista / Kanban / Calendário (Story 3.3 AC1 T4.1 · Story 3.5 AC1d).
 *
 * Todos os 3 tabs activos. Story 3.5 v1.3 activou Calendário (era disabled placeholder).
 */
export interface ViewTabsProps {
  readonly current: 'lista' | 'kanban' | 'calendario';
}

export function ViewTabs({ current }: ViewTabsProps): React.ReactElement {
  return (
    <nav
      className="flex gap-1 border-b border-black/10 dark:border-white/10"
      aria-label="Vistas de tarefas"
    >
      <Link
        href="/tarefas"
        aria-current={current === 'lista' ? 'page' : undefined}
        className={
          current === 'lista'
            ? 'border-b-2 border-blue-600 px-4 py-2 text-sm font-medium text-blue-600'
            : 'px-4 py-2 text-sm text-neutral-600 hover:text-neutral-900 dark:text-neutral-400 dark:hover:text-neutral-100'
        }
      >
        Lista
      </Link>
      <Link
        href="/tarefas/kanban"
        aria-current={current === 'kanban' ? 'page' : undefined}
        className={
          current === 'kanban'
            ? 'border-b-2 border-blue-600 px-4 py-2 text-sm font-medium text-blue-600'
            : 'px-4 py-2 text-sm text-neutral-600 hover:text-neutral-900 dark:text-neutral-400 dark:hover:text-neutral-100'
        }
      >
        Kanban
      </Link>
      <Link
        href="/tarefas/calendario"
        aria-current={current === 'calendario' ? 'page' : undefined}
        className={
          current === 'calendario'
            ? 'border-b-2 border-blue-600 px-4 py-2 text-sm font-medium text-blue-600'
            : 'px-4 py-2 text-sm text-neutral-600 hover:text-neutral-900 dark:text-neutral-400 dark:hover:text-neutral-100'
        }
      >
        Calendário
      </Link>
    </nav>
  );
}
