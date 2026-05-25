/**
 * `shellStore` — estado UI efémero do shell aplicacional (Story 5.3 AC5).
 *
 * Zustand store com middleware `persist` em `localStorage`, key versionada
 * `expressia-shell-v1`. `partialize` garante que apenas o estado serializável
 * é gravado (booleanos `sidebar.collapsed` e `chatPanel.open`) — funções e
 * derivadas ficam de fora.
 *
 * **Trace:** `architecture.md` §8.3 linha 713 — "UI ephemeral (modals,
 * sidebar collapse, theme) | Zustand | Persist em localStorage".
 *
 * **SSR hydration safety (D-5.3.5):** o `persist` middleware hidrata
 * assincronamente após o mount no client. Componentes que precisam do
 * estado persistido devem usar `useShellHydrated()` para evitar
 * hydration mismatch:
 *
 * ```tsx
 * const hydrated = useShellHydrated();
 * const collapsed = useSidebarCollapsed();
 * // Antes da hidratação, render fallback consistente com o server.
 * if (!hydrated) return <DefaultSkeleton />;
 * ```
 *
 * Quando o consumidor não se importa com o mismatch (apenas usa o estado
 * para acções pós-clique), pode ignorar `useShellHydrated()`.
 */
import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import { useEffect, useState } from 'react';

/**
 * Shape do estado persistido (subset serializável).
 */
interface ShellPersistedState {
  /** Sidebar colapsada (icon-only em tablet; ignorado em mobile que usa drawer). */
  sidebarCollapsed: boolean;
  /** Chat panel aberto (default `false` — fechado). */
  chatPanelOpen: boolean;
}

/**
 * Estado efémero (não persistido). `mobileDrawerOpen` controla o drawer
 * mobile da sidebar — reset a cada navegação/refresh é intencional
 * (D-5.3.6).
 */
interface ShellEphemeralState {
  mobileDrawerOpen: boolean;
}

/**
 * Estado completo do store (persistido + efémero + actions).
 */
interface ShellState extends ShellPersistedState, ShellEphemeralState {
  // Sidebar actions
  setSidebarCollapsed: (collapsed: boolean) => void;
  toggleSidebar: () => void;
  // Chat panel actions
  setChatPanelOpen: (open: boolean) => void;
  toggleChatPanel: () => void;
  openChatPanel: () => void;
  closeChatPanel: () => void;
  // Mobile drawer actions
  setMobileDrawerOpen: (open: boolean) => void;
  toggleMobileDrawer: () => void;
  closeMobileDrawer: () => void;
}

/**
 * Chave de persistência localStorage. Versionada para permitir invalidação
 * controlada se o schema mudar no futuro (ex: mudar de `boolean` para enum).
 */
const PERSIST_KEY = 'expressia-shell-v1';

/**
 * Defaults — sidebar **NÃO colapsada** (desktop é o caso primário; tablet
 * pode reset via toggle do utilizador) e chat panel **fechado**.
 *
 * Decisão D-5.3.4: default `sidebarCollapsed=false`. Em desktop fica expandida
 * (240px). Em tablet o utilizador pode colapsar (64px icon-only) e fica
 * persistido. Em mobile o store é irrelevante — drawer abre por evento
 * dedicado.
 */
const DEFAULT_STATE: ShellPersistedState = {
  sidebarCollapsed: false,
  chatPanelOpen: false,
};

/**
 * Store principal — exportado para casos avançados (subscribe directo,
 * test setup). Consumidores normais devem usar os selectores tipados
 * abaixo.
 */
export const useShellStore = create<ShellState>()(
  persist(
    (set) => ({
      ...DEFAULT_STATE,
      // Estado efémero — não persiste.
      mobileDrawerOpen: false,
      // Persistidos
      setSidebarCollapsed: (collapsed) => set({ sidebarCollapsed: collapsed }),
      toggleSidebar: () =>
        set((state) => ({ sidebarCollapsed: !state.sidebarCollapsed })),
      setChatPanelOpen: (open) => set({ chatPanelOpen: open }),
      toggleChatPanel: () =>
        set((state) => ({ chatPanelOpen: !state.chatPanelOpen })),
      openChatPanel: () => set({ chatPanelOpen: true }),
      closeChatPanel: () => set({ chatPanelOpen: false }),
      // Efémeros
      setMobileDrawerOpen: (open) => set({ mobileDrawerOpen: open }),
      toggleMobileDrawer: () =>
        set((state) => ({ mobileDrawerOpen: !state.mobileDrawerOpen })),
      closeMobileDrawer: () => set({ mobileDrawerOpen: false }),
    }),
    {
      name: PERSIST_KEY,
      storage: createJSONStorage(() => localStorage),
      // Apenas as duas flags serializáveis são persistidas — funções omitidas.
      partialize: (state): ShellPersistedState => ({
        sidebarCollapsed: state.sidebarCollapsed,
        chatPanelOpen: state.chatPanelOpen,
      }),
      version: 1,
    },
  ),
);

// ───────────────────────────────────────────────────────────────────────────
// Selectores tipados — minimizar re-renders dos consumidores
// ───────────────────────────────────────────────────────────────────────────

/**
 * Lê `sidebarCollapsed`. Re-renderiza apenas quando esta flag muda.
 */
export function useSidebarCollapsed(): boolean {
  return useShellStore((state) => state.sidebarCollapsed);
}

/**
 * Lê `chatPanelOpen`. Re-renderiza apenas quando esta flag muda.
 */
export function useChatPanelOpen(): boolean {
  return useShellStore((state) => state.chatPanelOpen);
}

/**
 * Bundle das acções comuns. Como o objecto seria recriado a cada render
 * (mudaria a referência e provocaria re-renders dos consumidores), seleccionamos
 * cada acção individualmente — Zustand garante estabilidade referencial das
 * funções definidas no `create()`.
 */
export interface ShellActions {
  setSidebarCollapsed: (collapsed: boolean) => void;
  toggleSidebar: () => void;
  setChatPanelOpen: (open: boolean) => void;
  toggleChatPanel: () => void;
  openChatPanel: () => void;
  closeChatPanel: () => void;
  setMobileDrawerOpen: (open: boolean) => void;
  toggleMobileDrawer: () => void;
  closeMobileDrawer: () => void;
}

export function useShellActions(): ShellActions {
  const setSidebarCollapsed = useShellStore((state) => state.setSidebarCollapsed);
  const toggleSidebar = useShellStore((state) => state.toggleSidebar);
  const setChatPanelOpen = useShellStore((state) => state.setChatPanelOpen);
  const toggleChatPanel = useShellStore((state) => state.toggleChatPanel);
  const openChatPanel = useShellStore((state) => state.openChatPanel);
  const closeChatPanel = useShellStore((state) => state.closeChatPanel);
  const setMobileDrawerOpen = useShellStore((state) => state.setMobileDrawerOpen);
  const toggleMobileDrawer = useShellStore((state) => state.toggleMobileDrawer);
  const closeMobileDrawer = useShellStore((state) => state.closeMobileDrawer);
  return {
    setSidebarCollapsed,
    toggleSidebar,
    setChatPanelOpen,
    toggleChatPanel,
    openChatPanel,
    closeChatPanel,
    setMobileDrawerOpen,
    toggleMobileDrawer,
    closeMobileDrawer,
  };
}

/**
 * Lê `mobileDrawerOpen`. Re-renderiza apenas quando esta flag muda.
 */
export function useMobileDrawerOpen(): boolean {
  return useShellStore((state) => state.mobileDrawerOpen);
}

/**
 * Indica se o middleware `persist` já hidratou o estado a partir de
 * `localStorage`. Útil para componentes que precisam de evitar hydration
 * mismatch SSR ↔ CSR.
 *
 * Em SSR retorna sempre `false`. No client começa `false` e passa a `true`
 * após `onFinishHydration` ou imediatamente se já estava hidratado quando o
 * componente montou.
 */
export function useShellHydrated(): boolean {
  const [hydrated, setHydrated] = useState(false);
  useEffect(() => {
    // Já estava hidratado antes do mount?
    if (useShellStore.persist.hasHydrated()) {
      setHydrated(true);
      return;
    }
    const unsub = useShellStore.persist.onFinishHydration(() => {
      setHydrated(true);
    });
    return () => unsub();
  }, []);
  return hydrated;
}
