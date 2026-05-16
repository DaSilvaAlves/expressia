'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';

import type { TaskRow } from '@/lib/api-helpers/list-tasks';

/**
 * `<BulkActionsBar>` — barra sticky-bottom com acções bulk (Story 3.3 T6.1-T6.6 / AC7).
 *
 * DP1-3.3 A — parallel `Promise.all` client-side. Sem novo endpoint server.
 * Reusa Story 3.2 PATCH/DELETE → audit_log per-row (FR21).
 *
 * 3 acções: Marcar concluídas / Eliminar / Mudar prioridade.
 * Partial failure handling: toast PT-PT "N de M atualizadas".
 */
export interface BulkActionsBarProps {
  readonly selectedTasks: readonly TaskRow[];
  readonly onClear: () => void;
  readonly onSelectAll: () => void;
  readonly totalCount: number;
}

type Banner =
  | { kind: 'idle' }
  | { kind: 'progress'; done: number; total: number }
  | { kind: 'success'; text: string }
  | { kind: 'partial'; text: string }
  | { kind: 'error'; text: string };

export function BulkActionsBar({
  selectedTasks,
  onClear,
  onSelectAll,
  totalCount,
}: BulkActionsBarProps): React.ReactElement {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [showPriority, setShowPriority] = useState(false);
  const [banner, setBanner] = useState<Banner>({ kind: 'idle' });

  const count = selectedTasks.length;

  async function bulkPatch(payload: Record<string, unknown>) {
    setPending(true);
    setBanner({ kind: 'progress', done: 0, total: count });
    let done = 0;
    const results = await Promise.allSettled(
      selectedTasks.map(async (t) => {
        const res = await fetch(`/api/tasks/${t.id}`, {
          method: 'PATCH',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(payload),
        });
        done++;
        setBanner({ kind: 'progress', done, total: count });
        if (!res.ok) throw new Error(`PATCH ${t.id} failed`);
        return t.id;
      }),
    );
    const ok = results.filter((r) => r.status === 'fulfilled').length;
    setPending(false);
    setShowPriority(false);
    if (ok === count) {
      setBanner({ kind: 'success', text: `${ok} tarefas atualizadas.` });
    } else if (ok > 0) {
      setBanner({
        kind: 'partial',
        text: `${ok} de ${count} tarefas atualizadas. As restantes falharam.`,
      });
    } else {
      setBanner({ kind: 'error', text: 'Nenhuma tarefa foi atualizada. Tenta novamente.' });
    }
    if (ok > 0) {
      onClear();
      router.refresh();
    }
    setTimeout(() => setBanner({ kind: 'idle' }), 4000);
  }

  async function bulkDelete() {
    // eslint-disable-next-line no-alert
    if (
      !confirm(
        `Tens a certeza que queres eliminar ${count} tarefa(s)? Esta acção é irreversível.`,
      )
    ) {
      return;
    }
    setPending(true);
    setBanner({ kind: 'progress', done: 0, total: count });
    let done = 0;
    const results = await Promise.allSettled(
      selectedTasks.map(async (t) => {
        const res = await fetch(`/api/tasks/${t.id}`, { method: 'DELETE' });
        done++;
        setBanner({ kind: 'progress', done, total: count });
        if (!res.ok) throw new Error(`DELETE ${t.id} failed`);
        return t.id;
      }),
    );
    const ok = results.filter((r) => r.status === 'fulfilled').length;
    setPending(false);
    if (ok === count) {
      setBanner({ kind: 'success', text: `${ok} tarefas eliminadas.` });
    } else if (ok > 0) {
      setBanner({
        kind: 'partial',
        text: `${ok} de ${count} tarefas eliminadas. As restantes falharam.`,
      });
    } else {
      setBanner({ kind: 'error', text: 'Nenhuma tarefa foi eliminada. Tenta novamente.' });
    }
    if (ok > 0) {
      onClear();
      router.refresh();
    }
    setTimeout(() => setBanner({ kind: 'idle' }), 4000);
  }

  async function bulkComplete() {
    await bulkPatch({ status: 'done' });
  }

  return (
    <div
      role="region"
      aria-label="Acções em massa"
      className="fixed inset-x-0 bottom-0 z-40 border-t border-black/10 bg-white p-3 shadow-md dark:border-white/10 dark:bg-neutral-900"
    >
      <div className="mx-auto flex max-w-5xl flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <span className="font-medium">
            {count} tarefa{count === 1 ? '' : 's'} seleccionada{count === 1 ? '' : 's'}
          </span>
          {count < totalCount && (
            <button
              type="button"
              onClick={onSelectAll}
              disabled={pending}
              className="text-xs text-blue-600 hover:underline disabled:opacity-50 dark:text-blue-400"
            >
              Seleccionar todas ({totalCount})
            </button>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={bulkComplete}
            disabled={pending}
            className="rounded-md bg-green-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-green-700 disabled:opacity-50"
          >
            Marcar como concluídas
          </button>
          <button
            type="button"
            onClick={bulkDelete}
            disabled={pending}
            className="rounded-md border border-red-300 bg-white px-3 py-1.5 text-sm font-medium text-red-700 hover:bg-red-50 disabled:opacity-50 dark:border-red-700 dark:bg-neutral-800 dark:text-red-300 dark:hover:bg-red-950/30"
          >
            Eliminar
          </button>
          <div className="relative">
            <button
              type="button"
              onClick={() => setShowPriority((s) => !s)}
              disabled={pending}
              aria-haspopup="menu"
              aria-expanded={showPriority}
              className="rounded-md border border-black/15 bg-white px-3 py-1.5 text-sm font-medium hover:bg-neutral-50 disabled:opacity-50 dark:border-white/15 dark:bg-neutral-800 dark:hover:bg-neutral-700"
            >
              Mudar prioridade ▾
            </button>
            {showPriority && (
              <div
                role="menu"
                className="absolute bottom-full right-0 mb-1 w-32 rounded-md border border-black/10 bg-white shadow-md dark:border-white/10 dark:bg-neutral-800"
              >
                <button
                  type="button"
                  role="menuitem"
                  onClick={() => bulkPatch({ priority: 'high' })}
                  className="block w-full px-3 py-1.5 text-left text-sm hover:bg-neutral-100 dark:hover:bg-neutral-700"
                >
                  Alta
                </button>
                <button
                  type="button"
                  role="menuitem"
                  onClick={() => bulkPatch({ priority: 'medium' })}
                  className="block w-full px-3 py-1.5 text-left text-sm hover:bg-neutral-100 dark:hover:bg-neutral-700"
                >
                  Média
                </button>
                <button
                  type="button"
                  role="menuitem"
                  onClick={() => bulkPatch({ priority: 'low' })}
                  className="block w-full px-3 py-1.5 text-left text-sm hover:bg-neutral-100 dark:hover:bg-neutral-700"
                >
                  Baixa
                </button>
              </div>
            )}
          </div>
          <button
            type="button"
            onClick={onClear}
            disabled={pending}
            className="text-sm text-neutral-600 hover:underline disabled:opacity-50 dark:text-neutral-400"
          >
            Cancelar
          </button>
        </div>
      </div>
      {banner.kind === 'progress' && (
        <p role="status" className="mx-auto mt-2 max-w-5xl text-xs text-neutral-600 dark:text-neutral-400">
          {banner.done} de {banner.total}...
        </p>
      )}
      {banner.kind === 'success' && (
        <p role="status" className="mx-auto mt-2 max-w-5xl text-xs text-green-700 dark:text-green-400">
          {banner.text}
        </p>
      )}
      {banner.kind === 'partial' && (
        <p role="alert" className="mx-auto mt-2 max-w-5xl text-xs text-amber-700 dark:text-amber-400">
          {banner.text}
        </p>
      )}
      {banner.kind === 'error' && (
        <p role="alert" className="mx-auto mt-2 max-w-5xl text-xs text-red-700 dark:text-red-400">
          {banner.text}
        </p>
      )}
    </div>
  );
}
