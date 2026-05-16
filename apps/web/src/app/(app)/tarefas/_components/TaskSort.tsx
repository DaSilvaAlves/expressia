'use client';

import { useRouter, useSearchParams } from 'next/navigation';
import { useTransition } from 'react';

/**
 * `<TaskSort>` — dropdown ordenação com URL-state (Story 3.3 T5.2 / AC4).
 *
 * 4 opções alinhadas com `TaskSortSchema` backend:
 *   - `due_date_asc` (default) Prazo crescente
 *   - `created_at_desc` Criação mais recentes
 *   - `priority_desc` Prioridade alta primeiro
 *   - `title_asc` Título A-Z
 *
 * Cursor pagination optimal apenas para `due_date_asc` (DP5-3.3 limitation
 * documentada — non-default sorts podem degradar boundary em datasets grandes).
 */
export function TaskSort(): React.ReactElement {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [, startTransition] = useTransition();

  const current = searchParams.get('sort') ?? 'due_date_asc';

  function onChange(value: string) {
    const params = new URLSearchParams(searchParams.toString());
    if (value === 'due_date_asc') params.delete('sort');
    else params.set('sort', value);
    params.delete('cursor');
    startTransition(() => {
      router.push(`/tarefas?${params.toString()}`, { scroll: false });
    });
  }

  return (
    <label className="flex items-center gap-2 text-sm">
      <span className="text-xs text-neutral-600 dark:text-neutral-400">Ordenar por</span>
      <select
        value={current}
        onChange={(e) => onChange(e.target.value)}
        aria-label="Ordenar por"
        className="rounded-md border border-black/15 bg-white px-2 py-1 dark:border-white/15 dark:bg-neutral-900"
      >
        <option value="due_date_asc">Prazo (crescente)</option>
        <option value="created_at_desc">Criação (mais recentes)</option>
        <option value="priority_desc">Prioridade (alta primeiro)</option>
        <option value="title_asc">Título (A-Z)</option>
      </select>
    </label>
  );
}
