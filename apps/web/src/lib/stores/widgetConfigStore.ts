/**
 * `widgetConfigStore` — estado client da configuração de widgets da Visão
 * (Story 5.7 AC2/AC3/AC4 — DP-5.7.B).
 *
 * Zustand store **sem middleware `persist`** — a fonte de verdade é a DB
 * (`user_prefs.widgets_enabled`), lida RSC-direct na `/visao` e injectada como
 * estado inicial via `hydrate()` (precedente: o `widgetsEnabled` vem do RSC
 * `page.tsx`, não de `localStorage`). Persistência é por PATCH
 * `/api/conta/preferencias` (AC1).
 *
 * **SSR-safety:** o `create()` inicializa `widgetsEnabled = null` e o store
 * **nunca é mutado no servidor** (só `hydrate`/`setWidget` correm em client
 * components após mount). Logo não há leak de estado entre requests SSR
 * (problema clássico de Zustand singleton). Os consumidores tratam `null` como
 * "mostrar tudo" (o RSC já só renderiza os widgets ON), evitando hydration
 * mismatch.
 *
 * **Optimistic + revert (precedente `prefs-toggle.tsx`):** `setWidget` actualiza
 * já o estado e agenda um PATCH debounced (DP-5.7.D, ~600ms). Em erro de PATCH,
 * reverte para `lastPersisted` e mostra banner de erro.
 *
 * **Adicionar widget (DP-5.7.A):** o componente que adiciona chama
 * `setWidget(id, true)` seguido de `flushNow()` (PATCH imediato) e depois
 * `router.refresh()` — o widget RSC novo só vem no re-render do servidor.
 *
 * Trace: Story 5.7 AC2/AC3/AC4; DP-5.7.A/B/D; precedente `shellStore`/`chatStore`.
 */
'use client';

import { create } from 'zustand';

import type { WidgetId, WidgetsEnabled } from '@meu-jarvis/db';

/** Banner de feedback de persistência (PT-PT). */
export type WidgetConfigBanner =
  | { kind: 'idle' }
  | { kind: 'success'; text: string }
  | { kind: 'error'; text: string };

/** Janela de debounce do PATCH (DP-5.7.D). */
const DEBOUNCE_MS = 600;

/**
 * Timer de debounce — fora do estado (não serializável, irrelevante para
 * render). Variável de módulo: só há uma `/visao` montada de cada vez.
 */
let debounceTimer: ReturnType<typeof setTimeout> | null = null;

/**
 * PATCH `/api/conta/preferencias` com o objecto `widgets_enabled` completo
 * (7 chaves — `WidgetsEnabledSchema.strict()`). Devolve `true` se persistiu.
 */
async function patchWidgets(widgets: WidgetsEnabled): Promise<boolean> {
  try {
    const res = await fetch('/api/conta/preferencias', {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ widgets_enabled: widgets }),
    });
    return res.ok;
  } catch {
    return false;
  }
}

interface WidgetConfigState {
  /** Estado corrente (optimistic). `null` até `hydrate()`. */
  widgetsEnabled: WidgetsEnabled | null;
  /** Último estado confirmado pela DB — alvo de revert em erro. */
  lastPersisted: WidgetsEnabled | null;
  /** PATCH em curso. */
  pending: boolean;
  /** Feedback de persistência. */
  banner: WidgetConfigBanner;
  /** `hydrate()` já correu (idempotência). */
  hydrated: boolean;

  /** Inicializa o estado a partir do valor lido no RSC (idempotente). */
  hydrate: (initial: WidgetsEnabled) => void;
  /** Define um widget ON/OFF (optimistic) + agenda PATCH debounced. */
  setWidget: (id: WidgetId, on: boolean) => void;
  /** Força o PATCH imediato (cancela o debounce). Devolve sucesso. */
  flushNow: () => Promise<boolean>;
  /** Limpa o banner (auto-clear pós-success). */
  clearBanner: () => void;
}

export const useWidgetConfigStore = create<WidgetConfigState>()((set, get) => ({
  widgetsEnabled: null,
  lastPersisted: null,
  pending: false,
  banner: { kind: 'idle' },
  hydrated: false,

  hydrate: (initial) => {
    if (get().hydrated) return;
    set({ widgetsEnabled: initial, lastPersisted: initial, hydrated: true });
  },

  setWidget: (id, on) => {
    const current = get().widgetsEnabled;
    if (!current) return;
    const next: WidgetsEnabled = { ...current, [id]: on };
    set({ widgetsEnabled: next, banner: { kind: 'idle' } });

    if (debounceTimer) clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => {
      void get().flushNow();
    }, DEBOUNCE_MS);
  },

  flushNow: async () => {
    if (debounceTimer) {
      clearTimeout(debounceTimer);
      debounceTimer = null;
    }
    const target = get().widgetsEnabled;
    if (!target) return false;

    set({ pending: true });
    const ok = await patchWidgets(target);
    if (ok) {
      set({
        pending: false,
        lastPersisted: target,
        banner: { kind: 'success', text: 'Guardado.' },
      });
    } else {
      set({
        pending: false,
        widgetsEnabled: get().lastPersisted,
        banner: { kind: 'error', text: 'Erro ao guardar. Tenta de novo.' },
      });
    }
    return ok;
  },

  clearBanner: () => set({ banner: { kind: 'idle' } }),
}));

// ───────────────────────────────────────────────────────────────────────────
// Selectores tipados
// ───────────────────────────────────────────────────────────────────────────

/**
 * Indica se um widget deve estar visível. `null` (não hidratado) → `true`
 * (mostrar — o RSC já só renderiza os ON, evitando mismatch). Após hidratação,
 * reflecte o estado optimistic.
 */
export function useWidgetEnabled(id: WidgetId): boolean {
  return useWidgetConfigStore((s) =>
    s.widgetsEnabled === null ? true : (s.widgetsEnabled[id] ?? true),
  );
}

/** Mapa corrente completo (ou `null` antes de hidratar). */
export function useWidgetsEnabledMap(): WidgetsEnabled | null {
  return useWidgetConfigStore((s) => s.widgetsEnabled);
}

/** Banner de feedback. */
export function useWidgetConfigBanner(): WidgetConfigBanner {
  return useWidgetConfigStore((s) => s.banner);
}

/** Acções (estabilidade referencial garantida pelo Zustand). */
export interface WidgetConfigActions {
  hydrate: (initial: WidgetsEnabled) => void;
  setWidget: (id: WidgetId, on: boolean) => void;
  flushNow: () => Promise<boolean>;
  clearBanner: () => void;
}

export function useWidgetConfigActions(): WidgetConfigActions {
  const hydrate = useWidgetConfigStore((s) => s.hydrate);
  const setWidget = useWidgetConfigStore((s) => s.setWidget);
  const flushNow = useWidgetConfigStore((s) => s.flushNow);
  const clearBanner = useWidgetConfigStore((s) => s.clearBanner);
  return { hydrate, setWidget, flushNow, clearBanner };
}
