/**
 * Tests UI — `PreviewCard` (Story 2.7 T8 + AC8).
 *
 * Cobertura ≥5 tests: render confidence colours (red/yellow/green),
 * countdown, confirm click → fetch + onConfirm, cancel click, expired state
 * (botão disabled), error 4xx/5xx no confirm.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

import { PreviewCard } from '@/components/chat/PreviewCard';

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  global.fetch = vi.fn();
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

function makeFutureExpiresAt(secondsFromNow: number): string {
  return new Date(Date.now() + secondsFromNow * 1000).toISOString();
}

describe('<PreviewCard />', () => {
  it('renderiza título "Vais fazer:" + lista plan_summary + badge confidence', () => {
    render(
      <PreviewCard
        runId="r1"
        planSummary={['criar_tarefa (65%)', 'registar_despesa (92%)']}
        confidence={0.85}
        expiresAt={makeFutureExpiresAt(300)}
        onConfirm={() => {}}
        onCancel={() => {}}
      />,
    );
    expect(screen.getByText('Vais fazer:')).toBeInTheDocument();
    expect(screen.getByText(/criar_tarefa \(65%\)/)).toBeInTheDocument();
    expect(screen.getByText(/registar_despesa \(92%\)/)).toBeInTheDocument();
    expect(screen.getByLabelText(/confiança: 85%/i)).toBeInTheDocument();
  });

  it('badge confidence cor vermelho quando < 0.70', () => {
    const { container } = render(
      <PreviewCard
        runId="r1"
        planSummary={['x (50%)']}
        confidence={0.5}
        expiresAt={makeFutureExpiresAt(300)}
        onConfirm={() => {}}
        onCancel={() => {}}
      />,
    );
    expect(container.querySelector('.bg-red-100')).toBeInTheDocument();
  });

  it('badge confidence cor amarelo quando 0.70-0.85', () => {
    const { container } = render(
      <PreviewCard
        runId="r1"
        planSummary={['x (75%)']}
        confidence={0.75}
        expiresAt={makeFutureExpiresAt(300)}
        onConfirm={() => {}}
        onCancel={() => {}}
      />,
    );
    expect(container.querySelector('.bg-yellow-100')).toBeInTheDocument();
  });

  it('badge confidence cor verde quando ≥ 0.85', () => {
    const { container } = render(
      <PreviewCard
        runId="r1"
        planSummary={['x (90%)']}
        confidence={0.9}
        expiresAt={makeFutureExpiresAt(300)}
        onConfirm={() => {}}
        onCancel={() => {}}
      />,
    );
    expect(container.querySelector('.bg-green-100')).toBeInTheDocument();
  });

  it('countdown mostra tempo restante M:SS', () => {
    render(
      <PreviewCard
        runId="r1"
        planSummary={['x (90%)']}
        confidence={0.9}
        expiresAt={makeFutureExpiresAt(125)} // 2:05
        onConfirm={() => {}}
        onCancel={() => {}}
      />,
    );
    // Pelo menos 2:0X (depende da resolução do timer)
    expect(screen.getByText(/Expira em 2:0/)).toBeInTheDocument();
  });

  it('botão Confirmar fica disabled quando expiresAt está no passado', () => {
    render(
      <PreviewCard
        runId="r1"
        planSummary={['x (90%)']}
        confidence={0.9}
        expiresAt={makeFutureExpiresAt(-10)} // já expirado
        onConfirm={() => {}}
        onCancel={() => {}}
      />,
    );
    expect(screen.getByRole('button', { name: /confirmar/i })).toBeDisabled();
    expect(screen.getByText(/janela de confirmação expirou/i)).toBeInTheDocument();
  });

  it('clique em Cancelar chama onCancel callback', () => {
    const onCancel = vi.fn();
    render(
      <PreviewCard
        runId="r1"
        planSummary={['x (90%)']}
        confidence={0.9}
        expiresAt={makeFutureExpiresAt(300)}
        onConfirm={() => {}}
        onCancel={onCancel}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: /cancelar/i }));
    expect(onCancel).toHaveBeenCalled();
  });

  it('clique em Confirmar dispara fetch /confirm + chama onConfirm com results', async () => {
    const onConfirm = vi.fn();
    (global.fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({
        run_id: 'r1',
        results: { success: true, results: [{ tool_name: 'create_task' }] },
      }),
    });
    render(
      <PreviewCard
        runId="r1"
        planSummary={['x (90%)']}
        confidence={0.9}
        expiresAt={makeFutureExpiresAt(300)}
        onConfirm={onConfirm}
        onCancel={() => {}}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: /confirmar/i }));
    await waitFor(() => expect(onConfirm).toHaveBeenCalled());
    expect(global.fetch).toHaveBeenCalledWith(
      '/api/agent/prompt/r1/confirm',
      expect.objectContaining({ method: 'POST' }),
    );
    // Story 2.8 PO_FIX_INLINE 2: onConfirm agora recebe payload object com
    // results + undoUrl + undoExpiresAt (undefined neste mock sem campos undo).
    expect(onConfirm).toHaveBeenCalledWith({
      results: { success: true, results: [{ tool_name: 'create_task' }] },
      undoUrl: undefined,
      undoExpiresAt: undefined,
    });
  });

  it('confirm que falha (response !ok) mostra mensagem de erro PT-PT', async () => {
    (global.fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      ok: false,
      status: 409,
      json: async () => ({ error: { message: 'Janela expirou no servidor.' } }),
    });
    render(
      <PreviewCard
        runId="r1"
        planSummary={['x (90%)']}
        confidence={0.9}
        expiresAt={makeFutureExpiresAt(300)}
        onConfirm={() => {}}
        onCancel={() => {}}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: /confirmar/i }));
    await waitFor(() =>
      expect(screen.getByRole('alert')).toHaveTextContent(/janela expirou/i),
    );
  });
});
