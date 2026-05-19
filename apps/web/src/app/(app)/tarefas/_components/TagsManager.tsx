'use client';

import { useEffect, useState } from 'react';

import type { Tag, TagWithCount } from '@/lib/api-schemas/tags';

/**
 * `<TagsManager>` — modal CRUD para gestão de tags (Story 3.6 T5 / AC3 + AC8 + AC9).
 *
 * Modal hand-rolled seguindo pattern `EditTaskModal.tsx` (DP-3.6.4 — APPROVED silent
 * por Aria). Zero deps Radix/shadcn. Lista todas as tags do household com count de uso,
 * permite criar (nome + cor da palette de 8), editar inline (nome+cor) e eliminar
 * (visível mas com tratamento 403 PT-PT — RLS é source of truth de owner/admin).
 *
 * DP-3.6.1 palette default: 8 cores predefinidas + `<input type="color">` custom.
 * DEV-DECISION D-3.6.2 → `window.confirm()` para eliminação (KISS — modal nested
 * hand-roll seria over-engineering para confirm simples de eliminar).
 */

const PALETTE: ReadonlyArray<{ hex: string; label: string }> = [
  { hex: '#6B7280', label: 'Cinzento' },
  { hex: '#3B82F6', label: 'Azul' },
  { hex: '#22C55E', label: 'Verde' },
  { hex: '#EF4444', label: 'Vermelho' },
  { hex: '#F97316', label: 'Laranja' },
  { hex: '#A855F7', label: 'Roxo' },
  { hex: '#EC4899', label: 'Rosa' },
  { hex: '#EAB308', label: 'Amarelo' },
];

const DEFAULT_COLOR = PALETTE[0]!.hex;

export interface TagsManagerProps {
  readonly open: boolean;
  readonly onClose: () => void;
}

type FetchState = 'loading' | 'error' | 'ready';

interface EditingState {
  readonly id: string;
  name: string;
  color: string;
}

export function TagsManager({ open, onClose }: TagsManagerProps): React.ReactElement | null {
  const [tags, setTags] = useState<TagWithCount[]>([]);
  const [fetchState, setFetchState] = useState<FetchState>('loading');
  const [createName, setCreateName] = useState('');
  const [createColor, setCreateColor] = useState(DEFAULT_COLOR);
  const [createError, setCreateError] = useState<string | null>(null);
  const [editing, setEditing] = useState<EditingState | null>(null);
  const [editError, setEditError] = useState<string | null>(null);
  const [globalError, setGlobalError] = useState<string | null>(null);

  // Reset state + fetch ao abrir
  useEffect(() => {
    if (!open) return;
    setCreateName('');
    setCreateColor(DEFAULT_COLOR);
    setCreateError(null);
    setEditing(null);
    setEditError(null);
    setGlobalError(null);
    setFetchState('loading');
    let cancelled = false;
    fetch('/api/tags?with_counts=true')
      .then(async (res) => {
        if (!res.ok) throw new Error('fetch falhou');
        const body = (await res.json()) as { tags: TagWithCount[] };
        if (!cancelled) {
          setTags(body.tags);
          setFetchState('ready');
        }
      })
      .catch(() => {
        if (!cancelled) setFetchState('error');
      });
    return () => {
      cancelled = true;
    };
  }, [open]);

  // Esc fecha modal
  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
    }
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    const name = createName.trim();
    if (!name) return;
    setCreateError(null);
    try {
      const res = await fetch('/api/tags', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name, color: createColor }),
      });
      if (res.status === 409) {
        setCreateError('Já existe uma tag com este nome.');
        return;
      }
      if (!res.ok) throw new Error('create falhou');
      const body = (await res.json()) as { tag: Tag };
      const newTag: TagWithCount = { ...body.tag, task_count: 0 };
      setTags((prev) =>
        [...prev, newTag].sort((a, b) => a.name.localeCompare(b.name, 'pt-PT')),
      );
      setCreateName('');
      setCreateColor(DEFAULT_COLOR);
    } catch {
      setCreateError('Não foi possível criar a tag. Tenta de novo.');
    }
  }

  function startEdit(tag: TagWithCount) {
    setEditing({ id: tag.id, name: tag.name, color: tag.color });
    setEditError(null);
  }

  async function handleSaveEdit() {
    if (!editing) return;
    const name = editing.name.trim();
    if (!name) return;
    setEditError(null);
    try {
      const res = await fetch(`/api/tags/${editing.id}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name, color: editing.color }),
      });
      if (res.status === 409) {
        setEditError('Já existe uma tag com este nome.');
        return;
      }
      if (!res.ok) throw new Error('patch falhou');
      const body = (await res.json()) as { tag: Tag };
      setTags((prev) =>
        prev
          .map((t) => (t.id === editing.id ? { ...t, name: body.tag.name, color: body.tag.color } : t))
          .sort((a, b) => a.name.localeCompare(b.name, 'pt-PT')),
      );
      setEditing(null);
    } catch {
      setEditError('Não foi possível guardar. Tenta de novo.');
    }
  }

  async function handleDelete(tag: TagWithCount) {
    const ok = typeof window !== 'undefined'
      ? window.confirm(`Eliminar a tag '#${tag.name}'? Será removida de todas as tarefas associadas.`)
      : true;
    if (!ok) return;
    setGlobalError(null);
    try {
      const res = await fetch(`/api/tags/${tag.id}`, { method: 'DELETE' });
      if (res.status === 403) {
        setGlobalError('Sem permissão para eliminar tags. Apenas owner ou admin pode eliminar.');
        return;
      }
      if (!res.ok) throw new Error('delete falhou');
      setTags((prev) => prev.filter((t) => t.id !== tag.id));
    } catch {
      setGlobalError('Não foi possível eliminar a tag. Tenta de novo.');
    }
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="tags-manager-title"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-0 md:p-4"
      onClick={onClose}
    >
      <div
        className="flex h-full w-full flex-col bg-white shadow-lg dark:bg-neutral-900 md:h-auto md:max-h-[80vh] md:max-w-2xl md:rounded-lg"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-black/10 p-4 dark:border-white/10">
          <h2 id="tags-manager-title" className="text-lg font-semibold">
            Gerir tags
          </h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Fechar"
            className="rounded-md p-1 text-neutral-500 hover:bg-neutral-100 dark:hover:bg-neutral-800"
          >
            ×
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-4">
          <form onSubmit={handleCreate} className="space-y-2 rounded-md border border-black/10 bg-neutral-50 p-3 dark:border-white/10 dark:bg-neutral-800/40">
            <label className="block">
              <span className="text-xs font-medium">Nome da tag</span>
              <input
                type="text"
                value={createName}
                onChange={(e) => setCreateName(e.target.value)}
                maxLength={50}
                placeholder="ex: trabalho, compras…"
                className="mt-1 block w-full rounded-md border border-black/15 bg-white px-2 py-1 text-sm dark:border-white/15 dark:bg-neutral-900"
              />
            </label>
            <div>
              <span className="text-xs font-medium">Cor</span>
              <div className="mt-1 flex flex-wrap items-center gap-2">
                {PALETTE.map((c) => (
                  <button
                    key={c.hex}
                    type="button"
                    onClick={() => setCreateColor(c.hex)}
                    aria-label={c.label}
                    aria-pressed={createColor === c.hex}
                    title={c.label}
                    style={{ backgroundColor: c.hex }}
                    className={
                      'h-6 w-6 rounded-full border-2 ' +
                      (createColor === c.hex
                        ? 'border-black dark:border-white'
                        : 'border-transparent')
                    }
                  />
                ))}
                <label className="flex items-center gap-1 text-xs text-neutral-600 dark:text-neutral-400">
                  <span>Personalizada</span>
                  <input
                    type="color"
                    value={createColor}
                    onChange={(e) => setCreateColor(e.target.value)}
                    aria-label="Cor personalizada"
                    className="h-6 w-8 cursor-pointer rounded border border-black/15"
                  />
                </label>
              </div>
            </div>
            {createError && (
              <div role="alert" className="rounded-md bg-red-50 px-2 py-1 text-xs text-red-800 dark:bg-red-950/30 dark:text-red-200">
                {createError}
              </div>
            )}
            <button
              type="submit"
              disabled={!createName.trim()}
              className="rounded-md bg-blue-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-blue-700 disabled:opacity-50"
            >
              Criar tag
            </button>
          </form>

          {globalError && (
            <div role="alert" className="mt-3 rounded-md bg-red-50 px-3 py-2 text-xs text-red-800 dark:bg-red-950/30 dark:text-red-200">
              {globalError}
            </div>
          )}

          <div className="mt-4">
            {fetchState === 'loading' && (
              <div aria-busy="true" className="space-y-2">
                {[0, 1, 2].map((i) => (
                  <div key={i} className="h-10 animate-pulse rounded-md bg-neutral-100 dark:bg-neutral-800" />
                ))}
              </div>
            )}
            {fetchState === 'error' && (
              <div role="alert" className="rounded-md border border-red-200 bg-red-50 p-3 text-xs text-red-800 dark:border-red-900 dark:bg-red-950/30 dark:text-red-200">
                Não foi possível carregar as tags. Tenta de novo.
              </div>
            )}
            {fetchState === 'ready' && tags.length === 0 && (
              <div className="rounded-md border border-dashed border-black/15 p-4 text-center text-xs text-neutral-600 dark:border-white/15 dark:text-neutral-400">
                Ainda não tens tags. Cria a primeira para organizar as tuas tarefas.
              </div>
            )}
            {fetchState === 'ready' && tags.length > 0 && (
              <ul className="space-y-1">
                {tags.map((tag) => {
                  const isEditing = editing?.id === tag.id;
                  return (
                    <li
                      key={tag.id}
                      className="flex items-center gap-3 rounded-md border border-black/10 bg-white p-2 text-sm dark:border-white/10 dark:bg-neutral-900"
                    >
                      {isEditing ? (
                        <>
                          <input
                            type="text"
                            value={editing.name}
                            onChange={(e) => setEditing({ ...editing, name: e.target.value })}
                            maxLength={50}
                            className="flex-1 rounded-md border border-black/15 bg-white px-2 py-1 text-sm dark:border-white/15 dark:bg-neutral-800"
                          />
                          <div className="flex items-center gap-1">
                            {PALETTE.map((c) => (
                              <button
                                key={c.hex}
                                type="button"
                                onClick={() => setEditing({ ...editing, color: c.hex })}
                                aria-label={c.label}
                                style={{ backgroundColor: c.hex }}
                                className={
                                  'h-5 w-5 rounded-full border-2 ' +
                                  (editing.color === c.hex
                                    ? 'border-black dark:border-white'
                                    : 'border-transparent')
                                }
                              />
                            ))}
                          </div>
                          <button
                            type="button"
                            onClick={handleSaveEdit}
                            className="rounded-md bg-blue-600 px-2 py-1 text-xs font-medium text-white hover:bg-blue-700"
                          >
                            Guardar
                          </button>
                          <button
                            type="button"
                            onClick={() => setEditing(null)}
                            className="rounded-md border border-black/15 bg-white px-2 py-1 text-xs hover:bg-neutral-50 dark:border-white/15 dark:bg-neutral-800"
                          >
                            Cancelar
                          </button>
                        </>
                      ) : (
                        <>
                          <span
                            aria-hidden="true"
                            className="inline-block h-4 w-4 shrink-0 rounded-full"
                            style={{ backgroundColor: tag.color }}
                          />
                          <span className="flex-1 truncate">{tag.name}</span>
                          <span className="text-xs text-neutral-500 dark:text-neutral-400">
                            {tag.task_count} {tag.task_count === 1 ? 'tarefa' : 'tarefas'}
                          </span>
                          <button
                            type="button"
                            onClick={() => startEdit(tag)}
                            aria-label={`Editar ${tag.name}`}
                            className="rounded-md p-1 text-xs hover:bg-neutral-100 dark:hover:bg-neutral-800"
                          >
                            Editar
                          </button>
                          <button
                            type="button"
                            onClick={() => handleDelete(tag)}
                            aria-label={`Eliminar ${tag.name}`}
                            className="rounded-md p-1 text-xs text-red-600 hover:bg-red-50 dark:text-red-400 dark:hover:bg-red-950/30"
                          >
                            Eliminar
                          </button>
                        </>
                      )}
                    </li>
                  );
                })}
              </ul>
            )}
            {editError && (
              <div role="alert" className="mt-2 rounded-md bg-red-50 px-2 py-1 text-xs text-red-800 dark:bg-red-950/30 dark:text-red-200">
                {editError}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
