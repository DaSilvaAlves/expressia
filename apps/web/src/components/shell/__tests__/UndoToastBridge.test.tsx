/**
 * Testes — `<UndoToastBridge>` (Story 5.9 AC2 / DP-5.9.B).
 *
 * Verifica a ponte reactiva `chatStore` → `undoStore`: mensagem `kind='result'`
 * com `undoUrl` alimenta o store; sem `undoUrl` ou `kind='user'` → sem efeito.
 */
import { render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { useChatStore } from '@/lib/stores/chatStore';
import { useUndoStore } from '@/lib/stores/undoStore';
import { UndoToastBridge } from '@/components/shell/UndoToastBridge';

beforeEach(() => {
  useChatStore.getState().resetChat();
  useUndoStore.getState().clearUndo();
});

afterEach(() => {
  useChatStore.getState().resetChat();
  useUndoStore.getState().clearUndo();
});

describe('<UndoToastBridge>', () => {
  it('mensagem result com undoUrl → undoStore.setUndo chamado', () => {
    useChatStore.getState().appendMessage({
      kind: 'result',
      id: 'm1',
      runId: 'run-1',
      summary: 'Feito.',
      undoUrl: '/api/agent/prompt/run-1/undo',
      undoExpiresAt: '2026-05-29T18:00:30.000Z',
    });

    render(<UndoToastBridge />);

    expect(useUndoStore.getState().undoUrl).toBe('/api/agent/prompt/run-1/undo');
    expect(useUndoStore.getState().expiresAt).toBe('2026-05-29T18:00:30.000Z');
  });

  it('mensagem result SEM undoUrl → undoStore não actualizado (AC2.d)', () => {
    useChatStore.getState().appendMessage({
      kind: 'result',
      id: 'm1',
      runId: 'run-1',
      summary: 'Feito (preview confirmado sem undo).',
    });

    render(<UndoToastBridge />);

    expect(useUndoStore.getState().undoUrl).toBeNull();
  });

  it('última mensagem kind=user → sem efeito no undoStore', () => {
    useChatStore.getState().appendMessage({ kind: 'user', id: 'u1', text: 'olá' });

    render(<UndoToastBridge />);

    expect(useUndoStore.getState().undoUrl).toBeNull();
  });

  it('renderiza null (sem UI)', () => {
    const { container } = render(<UndoToastBridge />);
    expect(container).toBeEmptyDOMElement();
  });
});
