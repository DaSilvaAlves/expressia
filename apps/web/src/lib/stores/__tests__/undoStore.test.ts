// @vitest-environment node
/**
 * Testes — `undoStore` (Story 5.9 AC1 / DP-5.9.A).
 *
 * Store isolado (sem DOM): `setUndo` guarda url+expiresAt; segundo `setUndo`
 * substitui o primeiro (R-5.9 — T2 substitui T1 silenciosamente); `clearUndo`
 * limpa; inicialização a `null/null`.
 */
import { afterEach, describe, expect, it } from 'vitest';

import { useUndoStore } from '@/lib/stores/undoStore';

const reset = (): void => useUndoStore.getState().clearUndo();

afterEach(reset);

describe('undoStore — estado inicial', () => {
  it('inicializa com undoUrl=null e expiresAt=null', () => {
    const { undoUrl, expiresAt } = useUndoStore.getState();
    expect(undoUrl).toBeNull();
    expect(expiresAt).toBeNull();
  });
});

describe('undoStore — setUndo', () => {
  it('guarda url + expiresAt', () => {
    useUndoStore.getState().setUndo('/api/agent/prompt/run-1/undo', '2026-05-29T18:00:30.000Z');
    const { undoUrl, expiresAt } = useUndoStore.getState();
    expect(undoUrl).toBe('/api/agent/prompt/run-1/undo');
    expect(expiresAt).toBe('2026-05-29T18:00:30.000Z');
  });

  it('R-5.9: o segundo setUndo substitui o primeiro (sem stack)', () => {
    const { setUndo } = useUndoStore.getState();
    setUndo('/api/agent/prompt/run-1/undo', '2026-05-29T18:00:30.000Z');
    setUndo('/api/agent/prompt/run-2/undo', '2026-05-29T18:01:00.000Z');
    const { undoUrl, expiresAt } = useUndoStore.getState();
    expect(undoUrl).toBe('/api/agent/prompt/run-2/undo');
    expect(expiresAt).toBe('2026-05-29T18:01:00.000Z');
  });
});

describe('undoStore — clearUndo', () => {
  it('limpa o token activo de volta a null/null', () => {
    const { setUndo, clearUndo } = useUndoStore.getState();
    setUndo('/api/agent/prompt/run-1/undo', '2026-05-29T18:00:30.000Z');
    clearUndo();
    const { undoUrl, expiresAt } = useUndoStore.getState();
    expect(undoUrl).toBeNull();
    expect(expiresAt).toBeNull();
  });
});
