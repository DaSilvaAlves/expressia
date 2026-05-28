'use client';

import { useState } from 'react';
import type * as React from 'react';
import { useRouter } from 'next/navigation';

import type { WidgetsEnabled } from '@meu-jarvis/db';

import { WIDGET_LABELS, WIDGET_ORDER } from '@/app/(app)/visao/_lib/widgets';
import {
  useWidgetsEnabledMap,
  useWidgetConfigActions,
} from '@/lib/stores/widgetConfigStore';

/**
 * `<AddWidgetMenu>` — botão ghost `[+ Adicionar widget]` + lista dos widgets
 * OFF para re-activar (Story 5.7 AC3/AC6 — DP-5.7.E).
 *
 * - Lista apenas os widgets actualmente `false`, na ordem canónica
 *   `WIDGET_ORDER`, com a label PT-PT de `WIDGET_LABELS`.
 * - Activar um widget: `setWidget(id, true)` (optimistic no store) →
 *   `flushNow()` (PATCH imediato) → `router.refresh()` para o RSC re-renderizar
 *   a grid com o widget novo (DP-5.7.A — adicionar exige re-fetch server-side).
 * - Se **todos os widgets já estão ON**, o botão fica `disabled` com texto
 *   "Todos os widgets já estão no painel" (sem abrir lista vazia).
 * - Disclosure acessível (`aria-expanded` / `aria-controls`), navegável por
 *   teclado.
 *
 * `initial` (do RSC) é fallback do estado antes da hidratação do store.
 *
 * Trace: Story 5.7 AC3/AC6/AC7; DP-5.7.A/E; front-end-spec §5.4 l.525.
 */
export interface AddWidgetMenuProps {
  readonly initial: WidgetsEnabled;
}

export function AddWidgetMenu({ initial }: AddWidgetMenuProps): React.ReactElement {
  const router = useRouter();
  const map = useWidgetsEnabledMap() ?? initial;
  const { setWidget, flushNow } = useWidgetConfigActions();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  const offWidgets = WIDGET_ORDER.filter((id) => !map[id]);
  const allOn = offWidgets.length === 0;

  async function handleAdd(id: (typeof WIDGET_ORDER)[number]): Promise<void> {
    if (busy) return;
    setBusy(true);
    setOpen(false);
    setWidget(id, true);
    const ok = await flushNow();
    if (ok) {
      // Adicionar exige re-render RSC — o widget novo não veio no HTML inicial.
      router.refresh();
    }
    setBusy(false);
  }

  if (allOn) {
    return (
      <button
        type="button"
        disabled
        className="rounded-md border border-dashed border-black/15 px-4 py-2 text-sm text-neutral-400 dark:border-white/15 dark:text-neutral-500"
      >
        Todos os widgets já estão no painel
      </button>
    );
  }

  return (
    <div className="relative inline-block">
      <button
        type="button"
        aria-expanded={open}
        aria-controls="add-widget-list"
        disabled={busy}
        onClick={() => setOpen((v) => !v)}
        className="rounded-md border border-dashed border-black/20 px-4 py-2 text-sm font-medium text-neutral-600 transition-colors hover:border-blue-500 hover:text-blue-600 focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue-500 disabled:cursor-not-allowed disabled:opacity-60 dark:border-white/20 dark:text-neutral-300 dark:hover:border-blue-400 dark:hover:text-blue-400"
      >
        + Adicionar widget
      </button>

      {open && (
        <ul
          id="add-widget-list"
          className="absolute z-20 mt-1 min-w-[14rem] overflow-hidden rounded-md border border-black/10 bg-white py-1 shadow-lg dark:border-white/10 dark:bg-neutral-900"
        >
          {offWidgets.map((id) => (
            <li key={id}>
              <button
                type="button"
                disabled={busy}
                onClick={() => void handleAdd(id)}
                className="block w-full px-4 py-2 text-left text-sm text-neutral-700 transition-colors hover:bg-black/5 focus-visible:bg-black/5 focus-visible:outline-none disabled:cursor-not-allowed disabled:opacity-60 dark:text-neutral-200 dark:hover:bg-white/10 dark:focus-visible:bg-white/10"
              >
                {WIDGET_LABELS[id]}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
