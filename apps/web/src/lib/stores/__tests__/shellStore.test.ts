/**
 * Tests — `shellStore` Zustand (Story 5.3 AC7.d).
 *
 * Cobertura: default state, toggle, setCollapsed, persist round-trip.
 *
 * Notes:
 *   - `localStorage` é mocked por `jsdom` (Vitest env) — não precisamos de mock manual.
 *   - Para garantir isolamento entre testes, fazemos reset manual do store +
 *     limpamos a key `expressia-shell-v1` antes de cada teste.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { useShellStore } from '@/lib/stores/shellStore';

const PERSIST_KEY = 'expressia-shell-v1';

function resetStore() {
  useShellStore.setState({
    sidebarCollapsed: false,
    chatPanelOpen: false,
    mobileDrawerOpen: false,
  });
  localStorage.removeItem(PERSIST_KEY);
}

beforeEach(() => {
  resetStore();
});

afterEach(() => {
  resetStore();
});

describe('shellStore — defaults', () => {
  it('default state — sidebarCollapsed=false, chatPanelOpen=false, mobileDrawerOpen=false', () => {
    const state = useShellStore.getState();
    expect(state.sidebarCollapsed).toBe(false);
    expect(state.chatPanelOpen).toBe(false);
    expect(state.mobileDrawerOpen).toBe(false);
  });
});

describe('shellStore — toggleChatPanel', () => {
  it('toggleChatPanel() inverte chatPanelOpen', () => {
    useShellStore.getState().toggleChatPanel();
    expect(useShellStore.getState().chatPanelOpen).toBe(true);
    useShellStore.getState().toggleChatPanel();
    expect(useShellStore.getState().chatPanelOpen).toBe(false);
  });

  it('openChatPanel() e closeChatPanel() definem o estado explicitamente', () => {
    useShellStore.getState().openChatPanel();
    expect(useShellStore.getState().chatPanelOpen).toBe(true);
    useShellStore.getState().openChatPanel(); // idempotente
    expect(useShellStore.getState().chatPanelOpen).toBe(true);
    useShellStore.getState().closeChatPanel();
    expect(useShellStore.getState().chatPanelOpen).toBe(false);
  });
});

describe('shellStore — setSidebarCollapsed / toggleSidebar', () => {
  it('setSidebarCollapsed(true) muda o estado para true', () => {
    useShellStore.getState().setSidebarCollapsed(true);
    expect(useShellStore.getState().sidebarCollapsed).toBe(true);
    useShellStore.getState().setSidebarCollapsed(false);
    expect(useShellStore.getState().sidebarCollapsed).toBe(false);
  });

  it('toggleSidebar() inverte sidebarCollapsed', () => {
    useShellStore.getState().toggleSidebar();
    expect(useShellStore.getState().sidebarCollapsed).toBe(true);
    useShellStore.getState().toggleSidebar();
    expect(useShellStore.getState().sidebarCollapsed).toBe(false);
  });
});

describe('shellStore — persist (localStorage round-trip)', () => {
  it('escreve em localStorage apenas as flags persistidas (partialize)', () => {
    useShellStore.getState().setSidebarCollapsed(true);
    useShellStore.getState().openChatPanel();
    useShellStore.getState().setMobileDrawerOpen(true); // efémero — NÃO deve persistir

    const raw = localStorage.getItem(PERSIST_KEY);
    expect(raw).not.toBeNull();
    const parsed = JSON.parse(raw as string) as {
      state: { sidebarCollapsed: boolean; chatPanelOpen: boolean; mobileDrawerOpen?: boolean };
      version: number;
    };
    expect(parsed.state.sidebarCollapsed).toBe(true);
    expect(parsed.state.chatPanelOpen).toBe(true);
    // `mobileDrawerOpen` é efémero — partialize não o deve incluir.
    expect(parsed.state.mobileDrawerOpen).toBeUndefined();
    expect(parsed.version).toBe(1);
  });
});

describe('shellStore — mobile drawer', () => {
  it('toggleMobileDrawer() + closeMobileDrawer() funcionam', () => {
    expect(useShellStore.getState().mobileDrawerOpen).toBe(false);
    useShellStore.getState().toggleMobileDrawer();
    expect(useShellStore.getState().mobileDrawerOpen).toBe(true);
    useShellStore.getState().closeMobileDrawer();
    expect(useShellStore.getState().mobileDrawerOpen).toBe(false);
  });
});
