import Link from 'next/link';

/**
 * `<ViewTabs>` — tabs Lista / Kanban / Calendário (Story 3.3 AC1 T4.1).
 *
 * Lista: active link. Kanban + Calendário: disabled placeholders (Stories 3.4/3.5
 * Backlog). Tooltip PT-PT "Em breve — disponível na próxima versão" via `title` attr.
 */
export interface ViewTabsProps {
  readonly current: 'lista' | 'kanban' | 'calendario';
}

const TOOLTIP_BREVE = 'Em breve — disponível na próxima versão';

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
      <button
        type="button"
        aria-disabled="true"
        disabled
        title={TOOLTIP_BREVE}
        className="cursor-not-allowed px-4 py-2 text-sm text-neutral-400 dark:text-neutral-600"
      >
        Kanban
      </button>
      <button
        type="button"
        aria-disabled="true"
        disabled
        title={TOOLTIP_BREVE}
        className="cursor-not-allowed px-4 py-2 text-sm text-neutral-400 dark:text-neutral-600"
      >
        Calendário
      </button>
    </nav>
  );
}
