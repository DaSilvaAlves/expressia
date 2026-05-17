'use client';

import { useEffect, useState } from 'react';

import type { KanbanColumnRow } from '@/lib/api-schemas/kanban-columns';

/**
 * `<ColumnConfigSheet>` — Sheet lateral para configurar colunas (Story 3.4 T7.1 / AC12).
 *
 * MVP simplificado (sem drag interno para reorder — apenas botões up/down):
 *   - Lista de colunas existentes editáveis inline (nome + radio "Coluna final")
 *   - Botão "+ Adicionar coluna" (disabled se 6/6)
 *   - Botão "🗑" eliminar com confirm — opção mover tasks se >0
 *   - "Guardar" → PATCH /api/kanban-columns/batch (single transaction)
 *   - "Cancelar" → descarta alterações locais
 *
 * Implementação: overlay simples em vez de Radix Sheet (zero dep nova — KISS).
 */
export interface ColumnConfigSheetProps {
  readonly currentColumns: readonly KanbanColumnRow[];
  readonly onClose: () => void;
  readonly onSaved: (newColumns: readonly KanbanColumnRow[]) => void;
}

interface DraftColumn {
  /** id null = nova coluna (criar via creates[] no batch). */
  id: string | null;
  name: string;
  sort_order: number;
  is_done_column: boolean;
  /** id original — preserved para deletes[] tracking. */
  originalId?: string;
}

const MIN_COLUMNS = 3;
const MAX_COLUMNS = 6;

export function ColumnConfigSheet({
  currentColumns,
  onClose,
  onSaved,
}: ColumnConfigSheetProps): React.ReactElement {
  const [drafts, setDrafts] = useState<DraftColumn[]>(() =>
    currentColumns
      .slice()
      .sort((a, b) => a.sort_order - b.sort_order)
      .map((c) => ({
        id: c.id,
        name: c.name,
        sort_order: c.sort_order,
        is_done_column: c.is_done_column,
        originalId: c.id,
      })),
  );
  const [deletes, setDeletes] = useState<Array<{ id: string; move_to?: string }>>([]);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape' && !saving) onClose();
    }
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose, saving]);

  function updateName(index: number, name: string): void {
    setDrafts((prev) => prev.map((d, i) => (i === index ? { ...d, name } : d)));
  }

  function setDoneColumn(index: number): void {
    setDrafts((prev) => prev.map((d, i) => ({ ...d, is_done_column: i === index })));
  }

  function moveUp(index: number): void {
    if (index === 0) return;
    setDrafts((prev) => {
      const next = prev.slice();
      const a = next[index - 1];
      const b = next[index];
      if (!a || !b) return prev;
      next[index - 1] = b;
      next[index] = a;
      return next.map((d, i) => ({ ...d, sort_order: i }));
    });
  }

  function moveDown(index: number): void {
    setDrafts((prev) => {
      if (index === prev.length - 1) return prev;
      const next = prev.slice();
      const a = next[index];
      const b = next[index + 1];
      if (!a || !b) return prev;
      next[index] = b;
      next[index + 1] = a;
      return next.map((d, i) => ({ ...d, sort_order: i }));
    });
  }

  function addColumn(): void {
    if (drafts.length >= MAX_COLUMNS) return;
    setDrafts((prev) => [
      ...prev,
      {
        id: null,
        name: `Coluna ${prev.length + 1}`,
        sort_order: prev.length,
        is_done_column: false,
      },
    ]);
  }

  function deleteColumn(index: number): void {
    const draft = drafts[index];
    if (!draft) return;
    if (drafts.length - 1 < MIN_COLUMNS) {
      setError(`Mínimo de ${MIN_COLUMNS} colunas obrigatório.`);
      return;
    }
    // Se é uma coluna existente, regista no deletes[]; senão, apenas remove do draft local.
    const originalId = draft.originalId;
    if (originalId) {
      const moveTo = window.prompt(
        'Para que coluna queres mover as tarefas desta coluna? Insere o nome exacto. Deixa em branco para tentar sem mover (se a coluna não tiver tarefas).',
        '',
      );
      const trimmed = moveTo?.trim();
      const target = trimmed
        ? drafts.find((d, i) => i !== index && d.name === trimmed)
        : undefined;
      setDeletes((prev) => [
        ...prev,
        {
          id: originalId,
          move_to: target?.originalId,
        },
      ]);
    }
    setDrafts((prev) => prev.filter((_, i) => i !== index).map((d, i) => ({ ...d, sort_order: i })));
    setError(null);
  }

  function validate(): string | null {
    if (drafts.length < MIN_COLUMNS) return `Mínimo de ${MIN_COLUMNS} colunas obrigatório.`;
    if (drafts.length > MAX_COLUMNS) return `Máximo de ${MAX_COLUMNS} colunas atingido.`;
    const doneCount = drafts.filter((d) => d.is_done_column).length;
    if (doneCount === 0) return 'Tem de existir exactamente 1 coluna marcada como "Final".';
    if (doneCount > 1) return 'Apenas 1 coluna pode ser "Final".';
    const lowerNames = drafts.map((d) => d.name.trim().toLowerCase());
    if (lowerNames.some((n) => n === '')) return 'Todas as colunas precisam de um nome.';
    if (new Set(lowerNames).size !== lowerNames.length) {
      return 'Os nomes das colunas devem ser únicos.';
    }
    return null;
  }

  async function handleSave(): Promise<void> {
    const validation = validate();
    if (validation) {
      setError(validation);
      return;
    }
    setError(null);
    setSaving(true);
    try {
      // Build batch payload:
      const columnsUpdates = drafts
        .filter((d) => d.originalId)
        .map((d) => ({
          id: d.originalId!,
          sort_order: d.sort_order,
          name: d.name.trim(),
          is_done_column: d.is_done_column,
        }));
      const creates = drafts
        .filter((d) => !d.originalId)
        .map((d) => ({
          name: d.name.trim(),
          sort_order: d.sort_order,
        }));

      const body: Record<string, unknown> = { columns: columnsUpdates };
      if (creates.length > 0) body.creates = creates;
      if (deletes.length > 0) body.deletes = deletes;

      const res = await fetch('/api/kanban-columns/batch', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const respBody = (await res.json().catch(() => ({}))) as {
          error?: { message?: string; details?: { violations?: string[] } };
        };
        const violations = respBody.error?.details?.violations;
        let message = respBody.error?.message ?? 'Não foi possível guardar a configuração.';
        if (violations && violations.length > 0) {
          message += ` (${violations.join(', ')})`;
        }
        setError(message);
        return;
      }
      const respBody = (await res.json()) as { columns: KanbanColumnRow[] };
      onSaved(respBody.columns);
    } catch {
      setError('Erro temporário. Tenta novamente.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="config-sheet-title"
      className="fixed inset-0 z-50 flex justify-end bg-black/40"
      onClick={() => !saving && onClose()}
    >
      <div
        className="flex h-full w-full max-w-md flex-col bg-white shadow-xl dark:bg-neutral-900"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="flex items-center justify-between border-b border-black/10 px-4 py-3 dark:border-white/10">
          <h2 id="config-sheet-title" className="text-lg font-semibold">
            Configurar colunas
          </h2>
          <button
            type="button"
            onClick={onClose}
            disabled={saving}
            aria-label="Fechar"
            className="rounded p-1 text-neutral-500 hover:bg-neutral-100 hover:text-neutral-900 disabled:opacity-50 dark:hover:bg-neutral-800 dark:hover:text-neutral-100"
          >
            ✕
          </button>
        </header>

        <div className="flex-1 overflow-y-auto px-4 py-4">
          <p className="mb-3 text-sm text-neutral-600 dark:text-neutral-400">
            Colunas ({drafts.length} de {MAX_COLUMNS})
          </p>

          <ul className="space-y-2">
            {drafts.map((d, i) => (
              <li
                key={`${d.originalId ?? 'new'}-${i}`}
                className="rounded-md border border-black/10 bg-neutral-50 p-3 dark:border-white/10 dark:bg-neutral-800/40"
              >
                <div className="flex items-start gap-2">
                  <div className="flex flex-col gap-1">
                    <button
                      type="button"
                      onClick={() => moveUp(i)}
                      disabled={i === 0 || saving}
                      aria-label={`Subir coluna ${d.name}`}
                      className="rounded text-xs text-neutral-500 hover:text-neutral-900 disabled:opacity-30 dark:hover:text-neutral-100"
                    >
                      ▲
                    </button>
                    <button
                      type="button"
                      onClick={() => moveDown(i)}
                      disabled={i === drafts.length - 1 || saving}
                      aria-label={`Descer coluna ${d.name}`}
                      className="rounded text-xs text-neutral-500 hover:text-neutral-900 disabled:opacity-30 dark:hover:text-neutral-100"
                    >
                      ▼
                    </button>
                  </div>
                  <div className="flex-1 space-y-2">
                    <input
                      type="text"
                      value={d.name}
                      onChange={(e) => updateName(i, e.target.value)}
                      disabled={saving}
                      maxLength={40}
                      aria-label="Nome da coluna"
                      className="block w-full rounded-md border border-black/15 bg-white px-2 py-1 text-sm dark:border-white/15 dark:bg-neutral-800"
                    />
                    <label className="flex items-center gap-2 text-xs text-neutral-700 dark:text-neutral-300">
                      <input
                        type="radio"
                        name="done-column"
                        checked={d.is_done_column}
                        onChange={() => setDoneColumn(i)}
                        disabled={saving}
                      />
                      Coluna final (tarefas concluídas)
                    </label>
                  </div>
                  <button
                    type="button"
                    onClick={() => deleteColumn(i)}
                    disabled={saving || drafts.length <= MIN_COLUMNS}
                    aria-label={`Eliminar coluna ${d.name}`}
                    className="rounded p-1 text-red-600 hover:bg-red-50 disabled:opacity-30 dark:text-red-400 dark:hover:bg-red-950/30"
                  >
                    🗑
                  </button>
                </div>
              </li>
            ))}
          </ul>

          <button
            type="button"
            onClick={addColumn}
            disabled={drafts.length >= MAX_COLUMNS || saving}
            title={drafts.length >= MAX_COLUMNS ? 'Máximo de 6 colunas atingido.' : ''}
            className="mt-3 w-full rounded-md border border-dashed border-black/20 px-3 py-2 text-sm text-neutral-700 hover:bg-neutral-50 disabled:cursor-not-allowed disabled:opacity-50 dark:border-white/20 dark:text-neutral-300 dark:hover:bg-neutral-800/40"
          >
            + Adicionar coluna
          </button>

          {error && (
            <div
              role="alert"
              className="mt-3 rounded-md bg-red-50 px-3 py-2 text-xs text-red-800 dark:bg-red-950/30 dark:text-red-200"
            >
              {error}
            </div>
          )}
        </div>

        <footer className="flex justify-end gap-2 border-t border-black/10 px-4 py-3 dark:border-white/10">
          <button
            type="button"
            onClick={onClose}
            disabled={saving}
            className="rounded-md border border-black/15 bg-white px-3 py-1.5 text-sm font-medium hover:bg-neutral-50 disabled:opacity-50 dark:border-white/15 dark:bg-neutral-800 dark:hover:bg-neutral-700"
          >
            Cancelar
          </button>
          <button
            type="button"
            onClick={handleSave}
            disabled={saving}
            className="rounded-md bg-blue-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
          >
            {saving ? 'A guardar...' : 'Guardar'}
          </button>
        </footer>
      </div>
    </div>
  );
}
