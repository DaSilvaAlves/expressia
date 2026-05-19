'use client';

import Link from 'next/link';
import { useSearchParams } from 'next/navigation';

/**
 * `<ViewTabs>` — tabs Lista / Kanban / Calendário (Story 3.3 AC1 T4.1 · Story 3.5 AC1d · Story 3.6 T7.5).
 *
 * Story 3.6 T7.5 — propaga o query param `tag_id` (e outros filtros relevantes)
 * ao navegar entre tabs (cross-tab persistence). DP-3.6.5 A — URL state Next.js native.
 */
export interface ViewTabsProps {
  readonly current: 'lista' | 'kanban' | 'calendario';
}

// Query params que devem persistir cross-tab. `tag_id` é o foco da Story 3.6;
// futuras stories podem adicionar mais (ex: `search`, `assigned_to_user_id`).
const CROSS_TAB_PARAMS = ['tag_id'];

function buildHref(pathname: string, search: URLSearchParams): string {
  const filtered = new URLSearchParams();
  for (const key of CROSS_TAB_PARAMS) {
    const value = search.get(key);
    if (value) filtered.set(key, value);
  }
  const qs = filtered.toString();
  return qs ? `${pathname}?${qs}` : pathname;
}

export function ViewTabs({ current }: ViewTabsProps): React.ReactElement {
  // Em testes (sem AppRouterContext) `useSearchParams()` pode retornar `null` —
  // fallback defensivo evita TypeError ao chamar `.toString()`.
  const searchParams = useSearchParams();
  const search = new URLSearchParams(searchParams?.toString() ?? '');

  return (
    <nav
      className="flex gap-1 border-b border-black/10 dark:border-white/10"
      aria-label="Vistas de tarefas"
    >
      <Link
        href={buildHref('/tarefas', search)}
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
        href={buildHref('/tarefas/kanban', search)}
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
        href={buildHref('/tarefas/calendario', search)}
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
