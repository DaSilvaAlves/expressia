/**
 * Integration tests — `<ChatPanel>` state sharing entre modes (Story 5.4 AC6.b
 * + AC7.e).
 *
 * R-5.6 do Epic 5 mitigado: 2 instâncias de `<ChatPanel>` (mode="panel" e
 * mode="fullscreen") na mesma test tree consomem o MESMO `chatStore` Zustand.
 * appendMessage propaga; clearMessages limpa em ambos.
 *
 * Cobertura 2 testes (AC7.e):
 *   1. State partilhado entre 2 instâncias em modes diferentes
 *   2. clearMessages propaga para ambas
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, render, screen, within } from '@testing-library/react';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));

vi.mock('@sentry/nextjs', () => ({
  captureException: vi.fn(),
}));

import { ChatPanel } from '@/components/chat/ChatPanel';
import { useChatStore, type ChatMessage } from '@/lib/stores/chatStore';

function resetState() {
  useChatStore.setState({
    messages: [],
    preview: null,
    loading: false,
  });
}

beforeEach(() => {
  resetState();
});

afterEach(() => {
  resetState();
});

describe('ChatPanel integration — state sharing entre modes', () => {
  it('appendMessage no store propaga para AMBAS as instâncias (R-5.6 mitigado)', () => {
    // Render 2 instâncias do ChatPanel na MESMA tree — uma em mode panel,
    // outra em mode fullscreen. Ambas lêem useChatMessages() do mesmo store.
    render(
      <div>
        <div data-testid="panel-wrapper">
          <ChatPanel mode="panel" />
        </div>
        <div data-testid="fullscreen-wrapper">
          <ChatPanel mode="fullscreen" />
        </div>
      </div>,
    );

    const userMessage: ChatMessage = {
      kind: 'user',
      id: 'shared-msg-1',
      text: 'olá do panel',
    };

    act(() => {
      useChatStore.getState().appendMessage(userMessage);
    });

    // Ambas instâncias devem mostrar a mensagem (renderizadas via useChatMessages)
    const panelWrapper = screen.getByTestId('panel-wrapper');
    const fullscreenWrapper = screen.getByTestId('fullscreen-wrapper');

    expect(within(panelWrapper).getByText('olá do panel')).toBeInTheDocument();
    expect(within(fullscreenWrapper).getByText('olá do panel')).toBeInTheDocument();
  });

  it('clearMessages limpa AMBAS as instâncias', () => {
    render(
      <div>
        <div data-testid="panel-wrapper">
          <ChatPanel mode="panel" />
        </div>
        <div data-testid="fullscreen-wrapper">
          <ChatPanel mode="fullscreen" />
        </div>
      </div>,
    );

    act(() => {
      useChatStore.getState().appendMessage({
        kind: 'user',
        id: 'msg-to-clear',
        text: 'vai desaparecer',
      });
    });

    // Confirmar que está em ambas
    expect(screen.getAllByText('vai desaparecer')).toHaveLength(2);

    // Limpar
    act(() => {
      useChatStore.getState().clearMessages();
    });

    // Não deve aparecer em nenhuma
    expect(screen.queryByText('vai desaparecer')).not.toBeInTheDocument();
    expect(useChatStore.getState().messages).toEqual([]);
  });
});
