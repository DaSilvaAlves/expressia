'use client';

import type * as React from 'react';

import type { WidgetId } from '@meu-jarvis/db';

import { WIDGET_LABELS } from '@/app/(app)/visao/_lib/widgets';
import {
  useWidgetEnabled,
  useWidgetConfigActions,
} from '@/lib/stores/widgetConfigStore';

/**
 * `<WidgetSlot>` — wrapper Client de cada widget na grid (Story 5.7 AC2 — DP-5.7.A/B).
 *
 * Envolve o widget RSC (passado como `children`) e:
 *   - **Esconde optimisticamente** o widget quando o utilizador o remove
 *     (`widgetConfigStore` diz `false`) — sem `router.refresh()` (DP-5.7.A:
 *     remover é optimistic client). Enquanto o store não está hidratado
 *     (`null` → `useWidgetEnabled` devolve `true`), mostra sempre, coincidindo
 *     com o que o RSC renderizou (sem hydration mismatch).
 *   - Injecta o controlo `×` ("Remover do painel") como **overlay** no canto
 *     superior direito (não toca os 7 widgets RSC nem o `WidgetCard` — nota
 *     orientadora @po). O card mantém-se acessível; o `×` é um `<button>`
 *     navegável por teclado com `aria-label` PT-PT.
 *
 * `data-widget` + `orderClass` (DP-5.6.F `tasks_today` mobile-first) migram do
 * `WidgetGrid` para aqui, preservando o contrato testado da Story 5.6.
 *
 * Trace: Story 5.7 AC2/AC7; DP-5.7.A/B; preserva Story 5.6 AC3/AC8.
 */
export interface WidgetSlotProps {
  readonly widgetId: WidgetId;
  /** Classe de ordering (DP-5.6.F) — ex.: `order-first md:order-none`. */
  readonly orderClass?: string;
  readonly children: React.ReactNode;
}

export function WidgetSlot({
  widgetId,
  orderClass = '',
  children,
}: WidgetSlotProps): React.ReactElement | null {
  const enabled = useWidgetEnabled(widgetId);
  const { setWidget } = useWidgetConfigActions();

  // Optimistic removal — esconde do DOM (não desmonta dados do servidor; o
  // próximo SSR/refresh natural já não renderiza este slot).
  if (!enabled) return null;

  const label = WIDGET_LABELS[widgetId];

  return (
    <div className={`relative ${orderClass}`.trim()} data-widget={widgetId}>
      <button
        type="button"
        aria-label={`Remover ${label} do painel`}
        title={`Remover ${label} do painel`}
        onClick={() => setWidget(widgetId, false)}
        className="absolute right-2 top-2 z-10 flex h-6 w-6 items-center justify-center rounded-md text-neutral-400 transition-colors hover:bg-black/5 hover:text-neutral-700 focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue-500 dark:text-neutral-500 dark:hover:bg-white/10 dark:hover:text-neutral-200"
      >
        <span aria-hidden="true" className="text-base leading-none">
          ×
        </span>
      </button>
      {children}
    </div>
  );
}
