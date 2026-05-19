'use client';

import { useEffect, useRef, useState } from 'react';

import type { Tag } from '@/lib/api-schemas/tags';

/**
 * `<TagPicker>` — combobox para aplicar/remover tags inline (Story 3.6 T4 / AC2 + AC8 + AC9).
 *
 * Pattern: dropdown hand-rolled (`useRef` + click-outside mousedown listener — G3.1 Aria).
 * Zero deps Radix/shadcn (precedent `EditTaskModal` + `RowActionsMenu`).
 *
 * Funcionalidades:
 *   - Fetch inicial `GET /api/tags` (cacheado em memória durante o ciclo de vida do componente)
 *   - Filtro prefix in-memory (sem debounce, lista <200)
 *   - Apply/Remove optimistic com revert em error + toast inline
 *   - Criação inline ("Criar '#texto'") com cor default `#6B7280` (DP-3.6.3)
 *   - Soft limit 5 tags (DP-3.6.2 — UI enforced)
 *   - ARIA: combobox + listbox + option, keyboard ↓↑/Enter/Esc
 */
const TAG_DEFAULT_COLOR = '#6B7280';
const TAG_SOFT_LIMIT = 5;
const MAX_VISIBLE_ITEMS = 20;

export interface TagPickerProps {
  readonly taskId: string;
  readonly currentTags: readonly Tag[];
  readonly onTagsChange: (tags: Tag[]) => void;
  readonly disabled?: boolean;
}

type FetchState = 'idle' | 'loading' | 'error' | 'ready';

export function TagPicker({
  taskId,
  currentTags,
  onTagsChange,
  disabled,
}: TagPickerProps): React.ReactElement {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [allTags, setAllTags] = useState<Tag[]>([]);
  const [fetchState, setFetchState] = useState<FetchState>('idle');
  const [toast, setToast] = useState<string | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Fetch tags na primeira abertura (cache para subsequentes — tags são estáveis).
  // React.StrictMode (dev) duplica useEffect — usar `hasFetchedRef` em vez de
  // fetchState para evitar bailout no segundo run que cancelaria o primeiro.
  const hasFetchedRef = useRef(false);
  useEffect(() => {
    if (!open || hasFetchedRef.current) return;
    hasFetchedRef.current = true;
    setFetchState('loading');
    fetch('/api/tags')
      .then(async (res) => {
        if (!res.ok) throw new Error('Fetch tags falhou');
        const body = (await res.json()) as { tags: Tag[] };
        setAllTags(body.tags);
        setFetchState('ready');
      })
      .catch(() => {
        setFetchState('error');
        hasFetchedRef.current = false; // permite retry
      });
  }, [open]);

  // Click-outside (G3.1 Aria) + Esc
  useEffect(() => {
    if (!open) return;
    function onDocClick(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        setOpen(false);
        triggerRef.current?.focus();
      }
    }
    document.addEventListener('mousedown', onDocClick);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDocClick);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  // Auto-foco no input ao abrir
  useEffect(() => {
    if (open && inputRef.current) {
      inputRef.current.focus();
    }
  }, [open]);

  function showToast(message: string) {
    setToast(message);
    setTimeout(() => setToast(null), 3500);
  }

  const selectedIds = new Set(currentTags.map((t) => t.id));
  const lowerQuery = query.trim().toLowerCase();
  const filtered = allTags
    .filter((t) => t.name.toLowerCase().startsWith(lowerQuery))
    .slice(0, MAX_VISIBLE_ITEMS);
  const exactMatch = allTags.some((t) => t.name.toLowerCase() === lowerQuery);
  const showCreateOption = lowerQuery.length > 0 && !exactMatch;
  const atSoftLimit = currentTags.length >= TAG_SOFT_LIMIT;

  async function applyTag(tag: Tag) {
    if (selectedIds.has(tag.id)) return;
    if (atSoftLimit) return;
    const optimistic = [...currentTags, tag];
    onTagsChange(optimistic);
    try {
      const res = await fetch(`/api/tasks/${taskId}/tags`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ tag_id: tag.id }),
      });
      if (!res.ok) throw new Error('apply tag falhou');
    } catch {
      onTagsChange(currentTags.slice());
      showToast('Não foi possível aplicar a tag. Tenta de novo.');
    }
  }

  async function removeTag(tag: Tag) {
    const optimistic = currentTags.filter((t) => t.id !== tag.id);
    onTagsChange(optimistic);
    try {
      const res = await fetch(`/api/tasks/${taskId}/tags/${tag.id}`, { method: 'DELETE' });
      if (!res.ok) throw new Error('remove tag falhou');
    } catch {
      onTagsChange(currentTags.slice());
      showToast('Não foi possível remover a tag. Tenta de novo.');
    }
  }

  async function createInlineAndApply() {
    const name = query.trim();
    if (!name) return;
    if (atSoftLimit) return;
    try {
      const res = await fetch('/api/tags', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name, color: TAG_DEFAULT_COLOR }),
      });
      if (!res.ok) throw new Error('create tag falhou');
      const body = (await res.json()) as { tag: Tag };
      const newTag = body.tag;
      setAllTags((prev) => [...prev, newTag].sort((a, b) => a.name.localeCompare(b.name)));
      setQuery('');
      await applyTag(newTag);
    } catch {
      showToast('Não foi possível criar a tag. Tenta de novo.');
    }
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Enter') {
      e.preventDefault();
      if (showCreateOption) {
        void createInlineAndApply();
      } else if (filtered[0]) {
        const first = filtered[0];
        if (selectedIds.has(first.id)) {
          void removeTag(first);
        } else {
          void applyTag(first);
        }
      }
    }
  }

  return (
    <div ref={containerRef} className="relative inline-block">
      <button
        ref={triggerRef}
        type="button"
        disabled={disabled}
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="listbox"
        aria-expanded={open}
        className="inline-flex items-center gap-1 rounded-md border border-black/15 bg-white px-2 py-0.5 text-xs text-neutral-600 hover:bg-neutral-50 disabled:opacity-50 dark:border-white/15 dark:bg-neutral-900 dark:text-neutral-400 dark:hover:bg-neutral-800"
      >
        + Tag
      </button>
      {open && (
        <div
          role="dialog"
          aria-label="Selecionar ou criar tag"
          className="absolute left-0 z-30 mt-1 w-64 rounded-md border border-black/15 bg-white p-2 shadow-lg dark:border-white/15 dark:bg-neutral-900"
        >
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Pesquisar ou criar tag…"
            role="combobox"
            aria-controls="tagpicker-listbox"
            aria-expanded={open}
            aria-label="Pesquisar ou criar tag"
            className="w-full rounded-md border border-black/15 bg-white px-2 py-1 text-xs dark:border-white/15 dark:bg-neutral-800"
          />
          {fetchState === 'loading' && (
            <div className="mt-2 flex items-center justify-center py-2">
              <span
                role="status"
                aria-label="A carregar"
                className="inline-block h-4 w-4 animate-spin rounded-full border-2 border-neutral-300 border-t-blue-600"
              />
            </div>
          )}
          {fetchState === 'error' && (
            <div className="mt-2 text-xs text-red-700 dark:text-red-300">
              Não foi possível carregar as tags. Tenta de novo.
              <button
                type="button"
                onClick={() => {
                  hasFetchedRef.current = false;
                  setFetchState('idle');
                }}
                className="ml-2 underline"
              >
                Tentar
              </button>
            </div>
          )}
          {fetchState === 'ready' && (
            <ul
              id="tagpicker-listbox"
              role="listbox"
              className="mt-2 max-h-48 overflow-y-auto"
            >
              {allTags.length === 0 && !showCreateOption && (
                <li className="px-2 py-1 text-xs text-neutral-500">
                  Ainda sem tags — escreve para criar a primeira.
                </li>
              )}
              {filtered.map((tag) => {
                const isSelected = selectedIds.has(tag.id);
                const isDisabled = !isSelected && atSoftLimit;
                return (
                  <li key={tag.id} role="option" aria-selected={isSelected}>
                    <button
                      type="button"
                      onClick={() => (isSelected ? removeTag(tag) : applyTag(tag))}
                      disabled={isDisabled}
                      title={isDisabled ? 'Limite de 5 tags atingido.' : undefined}
                      className="flex w-full items-center gap-2 rounded-md px-2 py-1 text-left text-xs hover:bg-neutral-100 disabled:cursor-not-allowed disabled:opacity-50 dark:hover:bg-neutral-800"
                    >
                      <span
                        aria-hidden="true"
                        className="inline-block h-3 w-3 rounded-full"
                        style={{ backgroundColor: tag.color }}
                      />
                      <span className="flex-1 truncate">{tag.name}</span>
                      {isSelected && <span aria-hidden="true">✓</span>}
                    </button>
                  </li>
                );
              })}
              {showCreateOption && (
                <li role="option" aria-selected={false}>
                  <button
                    type="button"
                    onClick={() => void createInlineAndApply()}
                    disabled={atSoftLimit}
                    title={atSoftLimit ? 'Limite de 5 tags atingido.' : undefined}
                    className="flex w-full items-center gap-2 rounded-md px-2 py-1 text-left text-xs text-blue-700 hover:bg-blue-50 disabled:cursor-not-allowed disabled:opacity-50 dark:text-blue-300 dark:hover:bg-blue-950/30"
                  >
                    <span aria-hidden="true">+</span>
                    <span>Criar &apos;#{query.trim()}&apos;</span>
                  </button>
                </li>
              )}
            </ul>
          )}
        </div>
      )}
      {toast && (
        <div
          role="status"
          aria-live="polite"
          className="fixed bottom-4 right-4 z-50 rounded-md bg-red-600 px-3 py-2 text-xs text-white shadow-lg"
        >
          {toast}
        </div>
      )}
    </div>
  );
}
