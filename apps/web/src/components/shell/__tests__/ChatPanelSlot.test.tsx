/**
 * Tests — `<ChatPanelSlot>` (Story 5.3 AC7.c).
 *
 * Cobertura:
 *   1. Default state (chatPanelOpen=false) renderiza botão vertical "Abrir chat"
 *      (desktop collapsed) + FAB mobile.
 *   2. Após `openChatPanel()` renderiza aside com `data-slot="chat-panel"`.
 *   3. Estado de toggle (close) volta a colapsado.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { act, render, screen } from '@testing-library/react';

import { ChatPanelSlot } from '@/components/shell/ChatPanelSlot';
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

describe('<ChatPanelSlot>', () => {
  it('default state — renderiza botão "Abrir chat" (collapsed) + FAB mobile', () => {
    render(<ChatPanelSlot />);
    // Múltiplos botões "Abrir chat" — desktop vertical + FAB mobile.
    const openButtons = screen.getAllByRole('button', { name: /abrir chat/i });
    expect(openButtons.length).toBeGreaterThanOrEqual(1);
  });

  it('após openChatPanel() renderiza aside com data-slot="chat-panel"', () => {
    const { container } = render(<ChatPanelSlot />);
    act(() => {
      useShellStore.getState().openChatPanel();
    });
    // Slot desktop expanded
    expect(container.querySelector('[data-slot="chat-panel"]')).not.toBeNull();
    // Botão Fechar chat presente (pelo menos um — desktop ou mobile overlay).
    const closeButtons = screen.getAllByRole('button', { name: /fechar chat/i });
    expect(closeButtons.length).toBeGreaterThanOrEqual(1);
  });

  it('closeChatPanel() volta ao estado colapsado (botão "Abrir chat" presente)', () => {
    render(<ChatPanelSlot />);
    act(() => {
      useShellStore.getState().openChatPanel();
    });
    act(() => {
      useShellStore.getState().closeChatPanel();
    });
    expect(useShellStore.getState().chatPanelOpen).toBe(false);
    const openButtons = screen.getAllByRole('button', { name: /abrir chat/i });
    expect(openButtons.length).toBeGreaterThanOrEqual(1);
  });
});
