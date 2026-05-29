/**
 * Testes — `<UndoToast>` (Story 5.9 AC3).
 *
 * Sem token → nada renderiza; com token → toast `role="status"` + countdown;
 * expiração → desaparece; clique + 200 → "Anulado ✓"; clique + 409 → desaparece.
 */
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { useUndoStore } from '@/lib/stores/undoStore';
import { UndoToast } from '@/components/shell/UndoToast';

const pushMock = vi.fn();
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: pushMock }),
}));

beforeEach(() => {
  useUndoStore.getState().clearUndo();
  pushMock.mockReset();
});

afterEach(() => {
  vi.restoreAllMocks();
  useUndoStore.getState().clearUndo();
});

describe('<UndoToast> — visibilidade', () => {
  it('sem undoUrl → não renderiza nada', () => {
    const { container } = render(<UndoToast />);
    expect(container).toBeEmptyDOMElement();
    expect(screen.queryByRole('status')).toBeNull();
  });

  it('com undoUrl + expiração futura → renderiza toast com role=status e botão', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-05-29T18:00:00.000Z'));
    useUndoStore.getState().setUndo('/api/agent/prompt/run-1/undo', '2026-05-29T18:00:20.000Z');

    render(<UndoToast />);

    expect(screen.getByRole('status')).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'Anular última acção do agente' }),
    ).toBeInTheDocument();
    expect(screen.getByText(/Anular \(\d+s\)/)).toBeInTheDocument();

    vi.useRealTimers();
  });
});

describe('<UndoToast> — expiração automática', () => {
  it('countdown chega a 0 → clearUndo → toast desaparece', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-05-29T18:00:00.000Z'));
    useUndoStore.getState().setUndo('/api/agent/prompt/run-1/undo', '2026-05-29T18:00:03.000Z');

    render(<UndoToast />);
    expect(screen.getByRole('status')).toBeInTheDocument();

    act(() => {
      vi.advanceTimersByTime(4000);
    });

    expect(screen.queryByRole('status')).toBeNull();
    expect(useUndoStore.getState().undoUrl).toBeNull();

    vi.useRealTimers();
  });
});

describe('<UndoToast> — acção de anular', () => {
  it('clique + fetch 200 → "Anulado ✓"', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(null, { status: 200 }),
    );
    const future = new Date(Date.now() + 20000).toISOString();
    useUndoStore.getState().setUndo('/api/agent/prompt/run-1/undo', future);

    render(<UndoToast />);
    fireEvent.click(screen.getByRole('button', { name: 'Anular última acção do agente' }));

    expect(await screen.findByText('Anulado ✓')).toBeInTheDocument();
  });

  it('clique + fetch 409 (expirado) → toast desaparece', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(null, { status: 409 }),
    );
    const future = new Date(Date.now() + 20000).toISOString();
    useUndoStore.getState().setUndo('/api/agent/prompt/run-1/undo', future);

    render(<UndoToast />);
    fireEvent.click(screen.getByRole('button', { name: 'Anular última acção do agente' }));

    await waitFor(() => expect(screen.queryByRole('status')).toBeNull());
    expect(useUndoStore.getState().undoUrl).toBeNull();
  });

  it('clique + fetch erro 500 → "Erro ao anular"', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(null, { status: 500 }),
    );
    const future = new Date(Date.now() + 20000).toISOString();
    useUndoStore.getState().setUndo('/api/agent/prompt/run-1/undo', future);

    render(<UndoToast />);
    fireEvent.click(screen.getByRole('button', { name: 'Anular última acção do agente' }));

    expect(await screen.findByText('Erro ao anular')).toBeInTheDocument();
  });
});
