'use client';

import { useRouter, useSearchParams } from 'next/navigation';
import { useEffect, useRef, useState, useTransition } from 'react';

/**
 * `<TaskFilters>` — barra de filtros client-side com URL-state (Story 3.3 T5.1 / AC3).
 *
 * Pattern DP2-3.3 A — Next.js native `useSearchParams` + `useRouter`. Deeplinkable,
 * zero deps extra, RSC navigation idiomatic Next 15. Mudança em filter → `router.push`
 * → RSC re-fetch server-side com novos params.
 *
 * Search input usa debounce 300ms (NFR15) para evitar push por cada keystroke.
 *
 * 7 controls alinhados com Story 3.2 endpoint:
 *   - Search (filtra `project` ILIKE — limitation Story 3.2; tooltip explica)
 *   - Estado (todo/doing/done/archived)
 *   - Tag (placeholder dropdown — Story 3.6 cria TagPicker real)
 *   - Prazo (De / Até)
 *   - Prioridade (Alta/Média/Baixa)
 *   - Atribuído (Todos/Eu)
 *   - Limpar filtros (visível se ≥1 filter activo)
 */
const SEARCH_DEBOUNCE_MS = 300;

export function TaskFilters(): React.ReactElement {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [, startTransition] = useTransition();

  // Search debounced — mantém input local sync com URL inicialmente
  const initialSearch = searchParams.get('project') ?? '';
  const [searchValue, setSearchValue] = useState(initialSearch);
  const searchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  function pushParams(updater: (params: URLSearchParams) => void) {
    const params = new URLSearchParams(searchParams.toString());
    updater(params);
    // Reset cursor quando filtros mudam (paginação anterior já não aplica)
    params.delete('cursor');
    startTransition(() => {
      router.push(`/tarefas?${params.toString()}`, { scroll: false });
    });
  }

  function updateFilter(key: string, value: string) {
    pushParams((p) => {
      if (value) p.set(key, value);
      else p.delete(key);
    });
  }

  // Debounced search
  function onSearchChange(value: string) {
    setSearchValue(value);
    if (searchTimer.current) clearTimeout(searchTimer.current);
    searchTimer.current = setTimeout(() => {
      updateFilter('project', value);
    }, SEARCH_DEBOUNCE_MS);
  }

  useEffect(() => {
    return () => {
      if (searchTimer.current) clearTimeout(searchTimer.current);
    };
  }, []);

  // Tem algum filter activo? (excluir limit/sort/cursor que não são filters)
  const hasActiveFilters = Array.from(searchParams.keys()).some(
    (k) => k !== 'limit' && k !== 'sort' && k !== 'cursor',
  );

  function clearFilters() {
    setSearchValue('');
    startTransition(() => {
      router.push('/tarefas', { scroll: false });
    });
  }

  return (
    <div className="flex flex-wrap items-end gap-2 text-sm">
      <label className="flex flex-col gap-1">
        <span className="text-xs text-neutral-600 dark:text-neutral-400">Procurar</span>
        <input
          type="search"
          value={searchValue}
          onChange={(e) => onSearchChange(e.target.value)}
          placeholder="Por projecto..."
          title="Procura por projecto"
          className="rounded-md border border-black/15 bg-white px-2 py-1 dark:border-white/15 dark:bg-neutral-900"
          aria-label="Procurar por projecto"
        />
      </label>

      <label className="flex flex-col gap-1">
        <span className="text-xs text-neutral-600 dark:text-neutral-400">Estado</span>
        <select
          value={searchParams.get('status') ?? ''}
          onChange={(e) => updateFilter('status', e.target.value)}
          aria-label="Estado"
          className="rounded-md border border-black/15 bg-white px-2 py-1 dark:border-white/15 dark:bg-neutral-900"
        >
          <option value="">Todos</option>
          <option value="todo">A fazer</option>
          <option value="doing">Em curso</option>
          <option value="done">Concluído</option>
          <option value="archived">Arquivado</option>
        </select>
      </label>

      {/* Story 3.6: tag filter movido para `<TagFilterSelect>` ao lado do `<TaskSort>` no header
          (substitui o placeholder Story 3.3 §AC3). */}

      <label className="flex flex-col gap-1">
        <span className="text-xs text-neutral-600 dark:text-neutral-400">Prazo de</span>
        <input
          type="date"
          value={searchParams.get('due_date_from') ?? ''}
          onChange={(e) => updateFilter('due_date_from', e.target.value)}
          aria-label="Prazo de"
          className="rounded-md border border-black/15 bg-white px-2 py-1 dark:border-white/15 dark:bg-neutral-900"
        />
      </label>

      <label className="flex flex-col gap-1">
        <span className="text-xs text-neutral-600 dark:text-neutral-400">Prazo até</span>
        <input
          type="date"
          value={searchParams.get('due_date_to') ?? ''}
          onChange={(e) => updateFilter('due_date_to', e.target.value)}
          aria-label="Prazo até"
          className="rounded-md border border-black/15 bg-white px-2 py-1 dark:border-white/15 dark:bg-neutral-900"
        />
      </label>

      <label className="flex flex-col gap-1">
        <span className="text-xs text-neutral-600 dark:text-neutral-400">Prioridade</span>
        <select
          value={searchParams.get('priority') ?? ''}
          onChange={(e) => updateFilter('priority', e.target.value)}
          aria-label="Prioridade"
          className="rounded-md border border-black/15 bg-white px-2 py-1 dark:border-white/15 dark:bg-neutral-900"
        >
          <option value="">Todas</option>
          <option value="high">Alta</option>
          <option value="medium">Média</option>
          <option value="low">Baixa</option>
        </select>
      </label>

      {hasActiveFilters && (
        <button
          type="button"
          onClick={clearFilters}
          className="self-end rounded-md border border-black/15 bg-white px-3 py-1 text-xs font-medium hover:bg-neutral-50 dark:border-white/15 dark:bg-neutral-800 dark:hover:bg-neutral-700"
        >
          Limpar filtros
        </button>
      )}
    </div>
  );
}
