'use client';

import { useEffect, useState, useTransition } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';

import type { Tag } from '@/lib/api-schemas/tags';

import { TagBadge } from '@/app/(app)/tarefas/_components/TagBadge';

/**
 * `<TagFilterSelect>` — dropdown de filtro por tag (Story 3.6 T7 / AC5).
 *
 * Lê `?tag_id=` da URL, lista tags via `GET /api/tags`, e ao seleccionar uma
 * actualiza a URL preservando outros query params (combinável com `status`,
 * `priority`, `due_date_from/to`, `project`). Badge activo + botão `×` para
 * remover o filtro. DP-3.6.5 A — URL state Next.js native.
 */
export function TagFilterSelect(): React.ReactElement {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [tags, setTags] = useState<Tag[]>([]);
  const [, startTransition] = useTransition();

  const activeTagId = searchParams.get('tag_id') ?? '';

  useEffect(() => {
    let cancelled = false;
    fetch('/api/tags')
      .then(async (res) => {
        if (!res.ok) return;
        const body = (await res.json()) as { tags: Tag[] };
        if (!cancelled) setTags(body.tags);
      })
      .catch(() => {
        // Silent — empty list é um estado aceitável
      });
    return () => {
      cancelled = true;
    };
  }, []);

  function pushTag(value: string) {
    const params = new URLSearchParams(searchParams.toString());
    if (value) params.set('tag_id', value);
    else params.delete('tag_id');
    params.delete('cursor');
    startTransition(() => {
      router.push(`${pathname}?${params.toString()}`, { scroll: false });
    });
  }

  const activeTag = tags.find((t) => t.id === activeTagId) ?? null;

  return (
    <div className="flex items-center gap-2">
      <label className="flex flex-col gap-1 text-sm">
        <span className="text-xs text-neutral-600 dark:text-neutral-400">Tag</span>
        <select
          value={activeTagId}
          onChange={(e) => pushTag(e.target.value)}
          aria-label="Filtrar por tag"
          className="rounded-md border border-black/15 bg-white px-2 py-1 dark:border-white/15 dark:bg-neutral-900"
        >
          <option value="">Todas</option>
          {tags.map((t) => (
            <option key={t.id} value={t.id}>
              {t.name}
            </option>
          ))}
        </select>
      </label>
      {activeTag && (
        <div className="flex items-end gap-1 pb-1 text-xs text-neutral-700 dark:text-neutral-300">
          <span>A filtrar por:</span>
          <TagBadge tag={activeTag} size="sm" />
          <button
            type="button"
            aria-label="Remover filtro de tag"
            onClick={() => pushTag('')}
            className="ml-1 rounded-full px-1 hover:bg-neutral-100 dark:hover:bg-neutral-800"
          >
            ×
          </button>
        </div>
      )}
    </div>
  );
}
