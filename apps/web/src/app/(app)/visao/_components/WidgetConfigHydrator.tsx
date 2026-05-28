'use client';

import { useRef } from 'react';

import type { WidgetsEnabled } from '@meu-jarvis/db';

import { useWidgetConfigStore } from '@/lib/stores/widgetConfigStore';

/**
 * `<WidgetConfigHydrator>` — hidrata o `widgetConfigStore` com o
 * `widgets_enabled` lido RSC-direct na `/visao` (Story 5.7 — DP-5.7.B).
 *
 * Renderiza `null` (não tem UI). Hidrata uma única vez no primeiro render
 * client (via `useRef` guard — evita re-hidratar em re-renders e mantém o
 * estado optimistic do utilizador após `router.refresh()`). O `hydrate` do
 * store é idempotente, mas o guard local evita chamadas desnecessárias.
 *
 * Montado pela `page.tsx` (RSC) com o valor inicial — o store nunca é mutado no
 * servidor (SSR-safety).
 *
 * Trace: Story 5.7 DP-5.7.B.
 */
export interface WidgetConfigHydratorProps {
  readonly initial: WidgetsEnabled;
}

export function WidgetConfigHydrator({ initial }: WidgetConfigHydratorProps): null {
  const done = useRef(false);
  if (!done.current) {
    // Hidratação síncrona no primeiro render client — `hydrate` é idempotente
    // (só corre se `hydrated === false`), preservando o estado optimistic do
    // utilizador entre `router.refresh()`.
    useWidgetConfigStore.getState().hydrate(initial);
    done.current = true;
  }
  return null;
}
