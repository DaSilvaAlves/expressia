'use client';

import { useEffect } from 'react';

import type { WidgetsEnabled } from '@meu-jarvis/db';

import { useWidgetConfigStore } from '@/lib/stores/widgetConfigStore';

/**
 * `<WidgetConfigHydrator>` — hidrata o `widgetConfigStore` com o
 * `widgets_enabled` lido RSC-direct na `/visao` (Story 5.7 — DP-5.7.B).
 *
 * Renderiza `null` (não tem UI). Hidrata em **`useEffect` (client-only)** — o
 * efeito NÃO corre durante o SSR, logo o `widgetConfigStore` (singleton de
 * módulo) **nunca é mutado no servidor**. Isto evita o cross-request state leak
 * que existiria se a hidratação corresse no corpo do render (que executa também
 * no SSR dos Client Components em App Router) — ver FIX-1 do gate @architect.
 *
 * Pré-hidratação (entre SSR e o efeito): `useWidgetEnabled(null)` devolve `true`
 * → os consumidores mostram os widgets que o RSC renderizou (que já são apenas
 * os ON deste utilizador) e o `AddWidgetMenu` usa `?? initial` → estado correcto
 * sem hydration mismatch. O `hydrate` do store é idempotente (`if (hydrated)
 * return`), preservando o estado optimistic do utilizador entre `router.refresh()`.
 *
 * Trace: Story 5.7 DP-5.7.B; FIX-1 (gate @architect — SSR-safety via useEffect).
 */
export interface WidgetConfigHydratorProps {
  readonly initial: WidgetsEnabled;
}

export function WidgetConfigHydrator({ initial }: WidgetConfigHydratorProps): null {
  useEffect(() => {
    // Client-only — não corre no SSR (zero mutação do store no servidor).
    // `hydrate` é idempotente → seguro re-correr quando `initial` muda após
    // `router.refresh()` (preserva o optimistic).
    useWidgetConfigStore.getState().hydrate(initial);
  }, [initial]);
  return null;
}
