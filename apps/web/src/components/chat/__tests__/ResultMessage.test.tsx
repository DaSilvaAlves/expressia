/**
 * Tests UI — `ResultMessage` (Story 2.7 + Story 2.8 AC12).
 *
 * Cobertura total 13 tests:
 *   - 4 preservados Story 2.7 (render summary, lista ops, results vazio, results undefined)
 *   - 1 substituído via PO_FIX_INLINE 3 (placeholder agora oculto — `queryByRole`)
 *   - 9 novos Story 2.8 AC12 (i)-(ix): countdown, expired, oculto sem props,
 *     click 200 success, 409 EXPIRED/ALREADY_REVERTED, 401 redirect, 5xx error,
 *     countdown cleanup on unmount.
 *
 * [DEV-DECISION] PO_FIX 3: optei por SUBSTITUIR o placeholder test 3 antigo
 * (mais limpo, sem asserções contraditórias). Resultado: 13 testes totais
 * (não 14). Aceito por AC12.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, render, screen, waitFor } from '@testing-library/react';

const pushMock = vi.fn();

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: pushMock }),
}));

import { ResultMessage } from '@/components/chat/ResultMessage';

beforeEach(() => {
  pushMock.mockReset();
  global.fetch = vi.fn();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('<ResultMessage />', () => {
  // ── Story 2.7 (preservados — 4 testes) ────────────────────────────────────

  it('renderiza título "Feito ✓" + summary + run id', () => {
    render(
      <ResultMessage
        runId="run-123"
        summary="Executei 1 operação com sucesso. Tens 30 segundos para reverter."
      />,
    );
    expect(screen.getByText(/Feito/)).toBeInTheDocument();
    expect(screen.getByText(/Executei 1 operação/)).toBeInTheDocument();
    expect(screen.getByText(/run-123/)).toBeInTheDocument();
  });

  it('renderiza lista de operations quando results.results presente', () => {
    render(
      <ResultMessage
        runId="run-1"
        summary="Executei 2 operações."
        results={{
          success: true,
          results: [
            { tool_name: 'create_task', intent: 'criar_tarefa', result_id: 't-1' },
            { tool_name: 'create_transaction', intent: 'registar_despesa', result_id: 'tx-1' },
          ],
        }}
      />,
    );
    expect(screen.getByText(/create_task/)).toBeInTheDocument();
    expect(screen.getByText(/create_transaction/)).toBeInTheDocument();
    expect(screen.getByText(/t-1/)).toBeInTheDocument();
    expect(screen.getByText(/tx-1/)).toBeInTheDocument();
  });

  it('lida com results vazio sem crash', () => {
    render(
      <ResultMessage runId="r1" summary="ok" results={{ success: true, results: [] }} />,
    );
    expect(screen.getByText(/Feito/)).toBeInTheDocument();
  });

  it('lida com results undefined sem crash', () => {
    render(<ResultMessage runId="r1" summary="apenas summary" />);
    expect(screen.getByText(/apenas summary/)).toBeInTheDocument();
  });

  // ── Story 2.8 AC12 (9 testes novos) ─────────────────────────────────────

  it('(i) render com undoUrl+undoExpiresAt futuro: botão activo + countdown segundos', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-05-11T12:00:00Z'));
    const future = new Date('2026-05-11T12:00:25Z').toISOString(); // +25s
    render(
      <ResultMessage
        runId="r1"
        summary="Feito"
        undoUrl="/api/agent/prompt/r1/undo"
        undoExpiresAt={future}
      />,
    );
    const button = screen.getByRole('button', { name: /anular/i });
    expect(button).not.toBeDisabled();
    expect(button).toHaveTextContent(/Anular \(25s\)/);
    // Avança 10s
    act(() => {
      vi.advanceTimersByTime(10_000);
    });
    expect(button).toHaveTextContent(/Anular \(15s\)/);
    vi.useRealTimers();
  });

  it('(ii) render com undoExpiresAt passado: botão disabled + texto "Expirou"', () => {
    const past = new Date(Date.now() - 5_000).toISOString();
    render(
      <ResultMessage
        runId="r1"
        summary="Feito"
        undoUrl="/api/agent/prompt/r1/undo"
        undoExpiresAt={past}
      />,
    );
    const button = screen.getByRole('button', { name: /anular/i });
    expect(button).toBeDisabled();
    expect(button).toHaveTextContent(/Expirou/);
  });

  it('(iii) [PO_FIX 3 substitui placeholder Story 2.7] sem undoUrl/undoExpiresAt: botão Anular oculto', () => {
    render(<ResultMessage runId="r1" summary="ok" />);
    expect(screen.queryByRole('button', { name: /anular/i })).toBeNull();
  });

  it('(iv) click → fetch chamado + status idle→loading→success + banner verde rendered', async () => {
    const future = new Date(Date.now() + 30_000).toISOString();
    (global.fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      status: 200,
      ok: true,
      json: async () => ({ reverted: true, run_id: 'r1', ops_count: 2 }),
    });
    render(
      <ResultMessage
        runId="r1"
        summary="Feito"
        undoUrl="/api/agent/prompt/r1/undo"
        undoExpiresAt={future}
      />,
    );
    const button = screen.getByRole('button', { name: /anular/i });
    await act(async () => {
      button.click();
    });
    await waitFor(() =>
      expect(screen.getByRole('alert')).toHaveTextContent(/anulada com sucesso/i),
    );
    expect(screen.getByRole('alert')).toHaveTextContent(/2 registo\(s\) removido\(s\)/);
    expect(button).toHaveTextContent(/Anulado/);
    expect(button).toBeDisabled();
    expect(global.fetch).toHaveBeenCalledWith('/api/agent/prompt/r1/undo', {
      method: 'POST',
    });
  });

  it('(v) click → 409 UNDO_EXPIRED: status→error + banner amarelo "Já não é possível anular"', async () => {
    const future = new Date(Date.now() + 30_000).toISOString();
    (global.fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      status: 409,
      ok: false,
      json: async () => ({ error: { code: 'UNDO_EXPIRED', message: 'expired' } }),
    });
    render(
      <ResultMessage
        runId="r1"
        summary="Feito"
        undoUrl="/api/agent/prompt/r1/undo"
        undoExpiresAt={future}
      />,
    );
    await act(async () => {
      screen.getByRole('button', { name: /anular/i }).click();
    });
    await waitFor(() =>
      expect(screen.getByRole('alert')).toHaveTextContent(
        /já não é possível anular.*30 segundos passou/i,
      ),
    );
  });

  it('(vi) click → 409 UNDO_ALREADY_REVERTED: banner amarelo "Esta operação já foi anulada"', async () => {
    const future = new Date(Date.now() + 30_000).toISOString();
    (global.fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      status: 409,
      ok: false,
      json: async () => ({ error: { code: 'UNDO_ALREADY_REVERTED', message: 'already' } }),
    });
    render(
      <ResultMessage
        runId="r1"
        summary="Feito"
        undoUrl="/api/agent/prompt/r1/undo"
        undoExpiresAt={future}
      />,
    );
    await act(async () => {
      screen.getByRole('button', { name: /anular/i }).click();
    });
    await waitFor(() =>
      expect(screen.getByRole('alert')).toHaveTextContent(/já foi anulada/i),
    );
  });

  it('(vii) click → 401: router.push("/entrar") chamado (sem render de banner)', async () => {
    const future = new Date(Date.now() + 30_000).toISOString();
    (global.fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      status: 401,
      ok: false,
      json: async () => ({ error: { code: 'AUTH_REQUIRED' } }),
    });
    render(
      <ResultMessage
        runId="r1"
        summary="Feito"
        undoUrl="/api/agent/prompt/r1/undo"
        undoExpiresAt={future}
      />,
    );
    await act(async () => {
      screen.getByRole('button', { name: /anular/i }).click();
    });
    await waitFor(() => expect(pushMock).toHaveBeenCalledWith('/entrar'));
  });

  it('(viii) click → 5xx: status→error + banner vermelho', async () => {
    const future = new Date(Date.now() + 30_000).toISOString();
    (global.fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      status: 500,
      ok: false,
      json: async () => ({ error: { code: 'INTERNAL_ERROR' } }),
    });
    render(
      <ResultMessage
        runId="r1"
        summary="Feito"
        undoUrl="/api/agent/prompt/r1/undo"
        undoExpiresAt={future}
      />,
    );
    await act(async () => {
      screen.getByRole('button', { name: /anular/i }).click();
    });
    await waitFor(() =>
      expect(screen.getByRole('alert')).toHaveTextContent(/erro temporário ao anular/i),
    );
  });

  it('(ix) countdown 30s sem click → transita para "Expirou" sem leak', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-05-11T12:00:00Z'));
    const future = new Date('2026-05-11T12:00:05Z').toISOString(); // +5s
    const { unmount } = render(
      <ResultMessage
        runId="r1"
        summary="Feito"
        undoUrl="/api/agent/prompt/r1/undo"
        undoExpiresAt={future}
      />,
    );
    const button = screen.getByRole('button', { name: /anular/i });
    expect(button).not.toBeDisabled();
    // Avança 6s — deve passar para Expirou
    act(() => {
      vi.advanceTimersByTime(6_000);
    });
    expect(button).toBeDisabled();
    expect(button).toHaveTextContent(/Expirou/);
    // Cleanup on unmount — não deve haver erro/leak
    expect(() => unmount()).not.toThrow();
    vi.useRealTimers();
  });
});
