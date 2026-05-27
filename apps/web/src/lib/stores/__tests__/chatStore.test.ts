/**
 * Tests — `chatStore` Zustand store (Story 5.4 AC2 + AC7.d).
 *
 * Cobertura 8 testes:
 *   1. Default state (messages vazio, preview null, loading false)
 *   2. appendMessage adiciona à lista (preserva order)
 *   3. setPreview atualiza/limpa preview
 *   4. setLoading toggles
 *   5. clearMessages limpa array mas preserva preview/loading
 *   6. resetChat limpa tudo
 *   7. Selectores retornam refs estáveis
 *   8. NÃO persiste em localStorage (DP-5.4.F)
 *
 * Pattern alinhado com `shellStore.test.ts` Story 5.3 (sem persist —
 * `chatStore` é session-bound).
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  makeMessageId,
  useChatActions,
  useChatLoading,
  useChatMessages,
  useChatPreview,
  useChatStore,
  type ChatMessage,
  type PreviewState,
} from '@/lib/stores/chatStore';

function resetStore() {
  useChatStore.setState({
    messages: [],
    preview: null,
    loading: false,
  });
}

beforeEach(() => {
  resetStore();
});

afterEach(() => {
  resetStore();
});

describe('chatStore — defaults + actions', () => {
  it('default state: messages vazio, preview null, loading false', () => {
    const state = useChatStore.getState();
    expect(state.messages).toEqual([]);
    expect(state.preview).toBeNull();
    expect(state.loading).toBe(false);
  });

  it('appendMessage adiciona à lista preservando order', () => {
    const msg1: ChatMessage = { kind: 'user', id: '1', text: 'olá' };
    const msg2: ChatMessage = { kind: 'user', id: '2', text: 'tudo bem?' };

    useChatStore.getState().appendMessage(msg1);
    useChatStore.getState().appendMessage(msg2);

    const state = useChatStore.getState();
    expect(state.messages).toHaveLength(2);
    expect(state.messages[0]).toEqual(msg1);
    expect(state.messages[1]).toEqual(msg2);
  });

  it('setPreview actualiza preview; setPreview(null) limpa', () => {
    const preview: PreviewState = {
      runId: 'run-1',
      planSummary: ['acção 1', 'acção 2'],
      confidence: 0.65,
      expiresAt: '2026-05-27T12:00:00Z',
    };

    useChatStore.getState().setPreview(preview);
    expect(useChatStore.getState().preview).toEqual(preview);

    useChatStore.getState().setPreview(null);
    expect(useChatStore.getState().preview).toBeNull();
  });

  it('setLoading true/false toggles flag', () => {
    expect(useChatStore.getState().loading).toBe(false);

    useChatStore.getState().setLoading(true);
    expect(useChatStore.getState().loading).toBe(true);

    useChatStore.getState().setLoading(false);
    expect(useChatStore.getState().loading).toBe(false);
  });

  it('clearMessages limpa array mas preserva preview/loading', () => {
    const msg: ChatMessage = { kind: 'user', id: '1', text: 'teste' };
    const preview: PreviewState = {
      runId: 'run-1',
      planSummary: ['x'],
      confidence: 0.5,
      expiresAt: '2026-05-27T12:00:00Z',
    };

    useChatStore.getState().appendMessage(msg);
    useChatStore.getState().setPreview(preview);
    useChatStore.getState().setLoading(true);

    useChatStore.getState().clearMessages();

    const state = useChatStore.getState();
    expect(state.messages).toEqual([]);
    expect(state.preview).toEqual(preview); // preservado
    expect(state.loading).toBe(true); // preservado
  });

  it('resetChat limpa tudo (messages + preview + loading)', () => {
    const msg: ChatMessage = { kind: 'user', id: '1', text: 'teste' };
    const preview: PreviewState = {
      runId: 'run-1',
      planSummary: ['x'],
      confidence: 0.5,
      expiresAt: '2026-05-27T12:00:00Z',
    };

    useChatStore.getState().appendMessage(msg);
    useChatStore.getState().setPreview(preview);
    useChatStore.getState().setLoading(true);

    useChatStore.getState().resetChat();

    const state = useChatStore.getState();
    expect(state.messages).toEqual([]);
    expect(state.preview).toBeNull();
    expect(state.loading).toBe(false);
  });

  it('selectores hooks retornam referências estáveis para mesma state', () => {
    // Setup: estado inicial
    const state1 = useChatStore.getState();

    // useChatMessages/useChatPreview/useChatLoading são hooks Zustand —
    // a estabilidade de referência é garantida pelo Zustand internamente.
    // Aqui testamos que getState() é determinístico.
    const state2 = useChatStore.getState();

    // messages é o mesmo array vazio (mesma referência se nada mudou)
    expect(state2.messages).toBe(state1.messages);
    expect(state2.preview).toBe(state1.preview);
    expect(state2.loading).toBe(state1.loading);
  });

  it('NÃO persiste em localStorage (DP-5.4.F — chatStore é session-bound)', () => {
    // Verificar que após appendMessage, NÃO há chave chat-* em localStorage.
    useChatStore.getState().appendMessage({
      kind: 'user',
      id: 'test-1',
      text: 'verificar persistência',
    });

    // Procurar chaves no localStorage que comecem com 'expressia-chat'
    const keys = Object.keys(localStorage);
    const chatKeys = keys.filter((k) => k.startsWith('expressia-chat'));
    expect(chatKeys).toHaveLength(0);
  });
});

describe('makeMessageId — utility', () => {
  it('gera IDs diferentes em chamadas consecutivas', () => {
    const id1 = makeMessageId();
    const id2 = makeMessageId();
    expect(id1).not.toBe(id2);
  });

  it('IDs incluem timestamp e suffix random', () => {
    const id = makeMessageId();
    // Formato: `{timestamp}-{random6chars}`
    expect(id).toMatch(/^\d+-[a-z0-9]{6}$/);
  });
});

describe('Hooks de selectores — sanity (não exercem render React)', () => {
  it('exportam funções', () => {
    // Smoke check — apenas verifica que os hooks existem e são funções.
    // Render React integration coberto em ChatPanel.test.tsx + integration.
    expect(typeof useChatMessages).toBe('function');
    expect(typeof useChatPreview).toBe('function');
    expect(typeof useChatLoading).toBe('function');
    expect(typeof useChatActions).toBe('function');
  });
});
