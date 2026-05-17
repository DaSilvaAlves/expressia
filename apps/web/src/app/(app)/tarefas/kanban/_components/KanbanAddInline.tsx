'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

/**
 * `<KanbanAddInline>` — botão fantasma → input criar tarefa inline (Story 3.4 T7.2).
 *
 * Estados:
 *   - rest: botão fantasma "+ Adicionar tarefa"
 *   - editing: input editável + Enter cria + Esc cancela
 *   - saving: input disabled + texto "A guardar..."
 *   - error: input mantém valor + alerta inline PT-PT
 */
export interface KanbanAddInlineProps {
  readonly columnId: string;
  readonly nextPosition: number;
}

export function KanbanAddInline({
  columnId,
  nextPosition,
}: KanbanAddInlineProps): React.ReactElement {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleCreate(): Promise<void> {
    const title = value.trim();
    if (!title) return;
    setSaving(true);
    setError(null);
    try {
      const res = await fetch('/api/tasks', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title,
          kanban_column_id: columnId,
          kanban_position: nextPosition,
        }),
      });
      if (!res.ok) {
        const respBody = (await res.json().catch(() => ({}))) as { error?: { message?: string } };
        setError(respBody.error?.message ?? 'Erro ao criar tarefa.');
        return;
      }
      setValue('');
      router.refresh();
    } catch {
      setError('Erro temporário. Tenta novamente.');
    } finally {
      setSaving(false);
    }
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>): void {
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      void handleCreate();
      return;
    }
    if (e.key === 'Enter') {
      e.preventDefault();
      void handleCreate();
      return;
    }
    if (e.key === 'Escape') {
      e.preventDefault();
      setValue('');
      setEditing(false);
      setError(null);
    }
  }

  if (!editing) {
    return (
      <button
        type="button"
        onClick={() => setEditing(true)}
        className="block w-full rounded-md border border-dashed border-black/15 px-3 py-1.5 text-left text-xs text-neutral-500 hover:bg-neutral-100 hover:text-neutral-900 dark:border-white/15 dark:hover:bg-neutral-800/40 dark:hover:text-neutral-100"
      >
        + Adicionar tarefa
      </button>
    );
  }

  return (
    <div className="space-y-1">
      <input
        type="text"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={handleKeyDown}
        onBlur={() => {
          if (!value.trim()) setEditing(false);
        }}
        disabled={saving}
        autoFocus
        placeholder="Nova tarefa..."
        maxLength={200}
        aria-label="Título da nova tarefa"
        className="block w-full rounded-md border border-black/15 bg-white px-2 py-1 text-sm dark:border-white/15 dark:bg-neutral-800"
      />
      {error && (
        <div role="alert" className="text-xs text-red-600 dark:text-red-400">
          {error}
        </div>
      )}
      {saving && (
        <div className="text-xs text-neutral-500 dark:text-neutral-400">A guardar...</div>
      )}
    </div>
  );
}
