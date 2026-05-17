'use client';

import { useCallback, useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';

/**
 * `<KanbanFilterBar>` — subset filtros (DP-3.4.3 B Aria APPROVE).
 *
 * Apenas `search` (debounce 300ms). Tag dropdown será adicionado pela Story 3.6
 * quando TagPicker existir (placeholder visible-disabled aqui).
 *
 * URL-state pattern: lê `?q=` do searchParams, push history em onChange. Limpa
 * filtros = remover `q` param.
 */
export function KanbanFilterBar(): React.ReactElement {
  const router = useRouter();
  const searchParams = useSearchParams();
  const initialQ = searchParams.get('q') ?? '';
  const [q, setQ] = useState(initialQ);

  // Debounce 300ms para push URL state
  useEffect(() => {
    if (q === initialQ) return;
    const timer = setTimeout(() => {
      const params = new URLSearchParams(Array.from(searchParams.entries()));
      if (q.trim()) {
        params.set('q', q.trim());
      } else {
        params.delete('q');
      }
      router.replace(`/tarefas/kanban${params.toString() ? `?${params.toString()}` : ''}`);
    }, 300);
    return () => clearTimeout(timer);
  }, [q, initialQ, router, searchParams]);

  const handleClear = useCallback(() => {
    setQ('');
    router.replace('/tarefas/kanban');
  }, [router]);

  return (
    <div className="flex items-center gap-2">
      <input
        type="search"
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder="Pesquisar tarefas..."
        aria-label="Pesquisar tarefas"
        className="rounded-md border border-black/15 bg-white px-3 py-1.5 text-sm placeholder:text-neutral-400 dark:border-white/15 dark:bg-neutral-800 dark:placeholder:text-neutral-600"
      />
      <button
        type="button"
        disabled
        title="Disponível na próxima versão (Story 3.6 — Tags)"
        className="cursor-not-allowed rounded-md border border-black/15 bg-white px-3 py-1.5 text-sm text-neutral-400 dark:border-white/15 dark:bg-neutral-800 dark:text-neutral-600"
      >
        Filtrar por etiqueta
      </button>
      {q && (
        <button
          type="button"
          onClick={handleClear}
          className="text-xs text-blue-600 hover:underline dark:text-blue-400"
        >
          Limpar filtros
        </button>
      )}
    </div>
  );
}
