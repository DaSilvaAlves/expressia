'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';

import type { TaskRow } from '@/lib/api-helpers/list-tasks';

/**
 * `<RowActionsMenu>` — menu `…` com 4 acções (Story 3.3 T7.2 / AC8):
 *   - Editar → abre modal subset (DP6-3.3 A minimal: description + due_date + priority)
 *   - Eliminar → DELETE soft com confirm dialog PT-PT
 *   - Adiar 1 dia → PATCH `due_date += 1` (ou today+1 se null)
 *   - Mudar prioridade → submenu Alta/Média/Baixa → PATCH priority
 *
 * Keyboard accessibility: `role="menu"`, Escape fecha, focus trap simple.
 */
export interface RowActionsMenuProps {
  readonly task: TaskRow;
  readonly onEdit: () => void;
}

function formatPT(date: Date): string {
  const dd = String(date.getDate()).padStart(2, '0');
  const mm = String(date.getMonth() + 1).padStart(2, '0');
  return `${dd}/${mm}/${date.getFullYear()}`;
}

function todayISO(): string {
  const d = new Date();
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

function addDaysISO(iso: string | null, days: number): string {
  if (!iso) {
    const d = new Date();
    d.setDate(d.getDate() + days);
    return [
      d.getFullYear(),
      String(d.getMonth() + 1).padStart(2, '0'),
      String(d.getDate()).padStart(2, '0'),
    ].join('-');
  }
  const [year, month, day] = iso.split('-').map(Number);
  if (!year || !month || !day) return todayISO();
  const d = new Date(year, month - 1, day);
  d.setDate(d.getDate() + days);
  return [
    d.getFullYear(),
    String(d.getMonth() + 1).padStart(2, '0'),
    String(d.getDate()).padStart(2, '0'),
  ].join('-');
}

export function RowActionsMenu({ task, onEdit }: RowActionsMenuProps): React.ReactElement {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [showPriority, setShowPriority] = useState(false);
  const [pending, setPending] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function onClickOutside(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
        setShowPriority(false);
      }
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        setOpen(false);
        setShowPriority(false);
      }
    }
    if (open) {
      document.addEventListener('mousedown', onClickOutside);
      document.addEventListener('keydown', onKey);
    }
    return () => {
      document.removeEventListener('mousedown', onClickOutside);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  async function patch(body: Record<string, unknown>) {
    setPending(true);
    try {
      const res = await fetch(`/api/tasks/${task.id}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (res.ok) {
        router.refresh();
      } else {
        // eslint-disable-next-line no-alert
        alert('Erro ao actualizar tarefa. Tenta novamente.');
      }
    } catch {
      // eslint-disable-next-line no-alert
      alert('Erro temporário. Tenta novamente.');
    } finally {
      setPending(false);
      setOpen(false);
      setShowPriority(false);
    }
  }

  async function handleDelete() {
    // eslint-disable-next-line no-alert
    if (!confirm('Tens a certeza que queres eliminar esta tarefa? Esta acção é irreversível.')) {
      return;
    }
    setPending(true);
    try {
      const res = await fetch(`/api/tasks/${task.id}`, { method: 'DELETE' });
      if (res.ok) {
        router.refresh();
      } else {
        // eslint-disable-next-line no-alert
        alert('Erro ao eliminar tarefa. Tenta novamente.');
      }
    } catch {
      // eslint-disable-next-line no-alert
      alert('Erro temporário. Tenta novamente.');
    } finally {
      setPending(false);
      setOpen(false);
    }
  }

  async function handlePostpone() {
    const newDate = addDaysISO(task.due_date, 1);
    await patch({ due_date: newDate });
    // Nota: alert é placeholder — toast UI em Story 3.6+
    const [y, m, d] = newDate.split('-');
    // eslint-disable-next-line no-alert
    alert(`Adiada para ${d}/${m}/${y}`);
  }

  void formatPT; // suppresses unused (kept for future toast integration)

  return (
    <div ref={containerRef} className="relative inline-block">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label="Acções da tarefa"
        disabled={pending}
        className="rounded p-1 text-neutral-500 hover:bg-neutral-100 hover:text-neutral-900 disabled:opacity-50 dark:hover:bg-neutral-800 dark:hover:text-neutral-100"
      >
        ⋯
      </button>
      {open && (
        <div
          role="menu"
          className="absolute right-0 z-10 mt-1 w-48 rounded-md border border-black/10 bg-white shadow-md dark:border-white/10 dark:bg-neutral-800"
        >
          <button
            type="button"
            role="menuitem"
            onClick={() => {
              setOpen(false);
              onEdit();
            }}
            className="block w-full px-3 py-2 text-left text-sm hover:bg-neutral-100 dark:hover:bg-neutral-700"
          >
            Editar
          </button>
          <button
            type="button"
            role="menuitem"
            onClick={handlePostpone}
            className="block w-full px-3 py-2 text-left text-sm hover:bg-neutral-100 dark:hover:bg-neutral-700"
          >
            Adiar 1 dia
          </button>
          <button
            type="button"
            role="menuitem"
            onClick={() => setShowPriority((s) => !s)}
            aria-haspopup="menu"
            aria-expanded={showPriority}
            className="block w-full px-3 py-2 text-left text-sm hover:bg-neutral-100 dark:hover:bg-neutral-700"
          >
            Mudar prioridade ▸
          </button>
          {showPriority && (
            <div role="menu" className="ml-3 border-l border-black/10 dark:border-white/10">
              <button
                type="button"
                role="menuitem"
                onClick={() => patch({ priority: 'high' })}
                className="block w-full px-3 py-1.5 text-left text-sm hover:bg-neutral-100 dark:hover:bg-neutral-700"
              >
                Alta
              </button>
              <button
                type="button"
                role="menuitem"
                onClick={() => patch({ priority: 'medium' })}
                className="block w-full px-3 py-1.5 text-left text-sm hover:bg-neutral-100 dark:hover:bg-neutral-700"
              >
                Média
              </button>
              <button
                type="button"
                role="menuitem"
                onClick={() => patch({ priority: 'low' })}
                className="block w-full px-3 py-1.5 text-left text-sm hover:bg-neutral-100 dark:hover:bg-neutral-700"
              >
                Baixa
              </button>
            </div>
          )}
          <button
            type="button"
            role="menuitem"
            onClick={handleDelete}
            className="block w-full border-t border-black/10 px-3 py-2 text-left text-sm text-red-600 hover:bg-red-50 dark:border-white/10 dark:text-red-400 dark:hover:bg-red-950/30"
          >
            Eliminar
          </button>
        </div>
      )}
    </div>
  );
}
