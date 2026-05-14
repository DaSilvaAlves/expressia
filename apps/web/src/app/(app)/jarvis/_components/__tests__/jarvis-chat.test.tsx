/**
 * Tests UI — `JarvisChat` (Story 2.7 T6 + AC6/AC7/AC9).
 *
 * Cobertura: render initial state, submit success → executed, submit →
 * preview → confirm → result, error 401 → redirect /entrar, erros 4xx/5xx →
 * mensagem PT-PT amigável via `errorMessageFor` (o `error.message` técnico
 * nunca é renderizado — docs/ux/jarvis-error-ux-spec.md), 5xx → captureException.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

const pushMock = vi.fn();
const captureExceptionMock = vi.fn();

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: pushMock }),
}));

vi.mock('@sentry/nextjs', () => ({
  captureException: (...args: unknown[]) => captureExceptionMock(...args),
}));

import { JarvisChat } from '@/app/(app)/jarvis/_components/jarvis-chat';

beforeEach(() => {
  pushMock.mockReset();
  captureExceptionMock.mockReset();
  global.fetch = vi.fn();
});

afterEach(() => {
  vi.restoreAllMocks();
});

function setFetchResponse(
  ok: boolean,
  status: number,
  body: unknown,
): void {
  (global.fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
    ok,
    status,
    json: async () => body,
  });
}

async function submitPrompt(text: string): Promise<void> {
  const ta = screen.getByLabelText('Prompt') as HTMLTextAreaElement;
  fireEvent.change(ta, { target: { value: text } });
  fireEvent.click(screen.getByRole('button', { name: /enviar/i }));
}

describe('<JarvisChat />', () => {
  it('renderiza estado inicial — input + sem mensagens', () => {
    render(<JarvisChat />);
    expect(screen.getByLabelText('Prompt')).toBeInTheDocument();
    expect(screen.queryByText(/Feito/)).not.toBeInTheDocument();
    expect(screen.queryByText(/Vais fazer/)).not.toBeInTheDocument();
  });

  it('submit prompt → mode=executed → renderiza ResultMessage', async () => {
    setFetchResponse(true, 200, {
      mode: 'executed',
      run_id: 'r1',
      summary: 'Executei 1 operação com sucesso.',
      results: { success: true, results: [{ tool_name: 'create_task' }] },
      undo_url: '/api/agent/prompt/r1/undo',
      undo_expires_at: new Date(Date.now() + 30_000).toISOString(),
    });
    render(<JarvisChat />);
    await submitPrompt('criar tarefa amanhã');
    await waitFor(() => expect(screen.getByText(/Feito/)).toBeInTheDocument());
    expect(screen.getByText(/Executei 1 operação/)).toBeInTheDocument();
    expect(screen.getByText('criar tarefa amanhã')).toBeInTheDocument();
  });

  it('submit prompt → mode=preview → renderiza PreviewCard', async () => {
    setFetchResponse(true, 200, {
      mode: 'preview',
      run_id: 'r1',
      plan_summary: ['criar_tarefa (60%)'],
      confidence: 0.6,
      expires_at: new Date(Date.now() + 300_000).toISOString(),
    });
    render(<JarvisChat />);
    await submitPrompt('fazer alguma coisa');
    await waitFor(() => expect(screen.getByText('Vais fazer:')).toBeInTheDocument());
    expect(screen.getByText(/criar_tarefa \(60%\)/)).toBeInTheDocument();
  });

  it('preview → confirmar → fetch /confirm → ResultMessage', async () => {
    // 1ª call: /api/agent/prompt → preview
    setFetchResponse(true, 200, {
      mode: 'preview',
      run_id: 'r1',
      plan_summary: ['criar_tarefa (60%)'],
      confidence: 0.6,
      expires_at: new Date(Date.now() + 300_000).toISOString(),
    });
    // 2ª call: /api/agent/prompt/r1/confirm → results + undo fields (PO_FIX 2)
    setFetchResponse(true, 200, {
      run_id: 'r1',
      results: { success: true, results: [{ tool_name: 'create_task' }] },
      undo_url: '/api/agent/prompt/r1/undo',
      undo_expires_at: new Date(Date.now() + 30_000).toISOString(),
    });
    render(<JarvisChat />);
    await submitPrompt('fazer algo');
    await waitFor(() => expect(screen.getByText('Vais fazer:')).toBeInTheDocument());
    fireEvent.click(screen.getByRole('button', { name: /confirmar/i }));
    await waitFor(() => expect(screen.getByText(/Feito/)).toBeInTheDocument());
    expect(global.fetch).toHaveBeenCalledTimes(2);
  });

  it('preview → cancelar → limpa preview sem chamar backend', async () => {
    setFetchResponse(true, 200, {
      mode: 'preview',
      run_id: 'r1',
      plan_summary: ['x (60%)'],
      confidence: 0.6,
      expires_at: new Date(Date.now() + 300_000).toISOString(),
    });
    render(<JarvisChat />);
    await submitPrompt('algo');
    await waitFor(() => expect(screen.getByText('Vais fazer:')).toBeInTheDocument());
    fireEvent.click(screen.getByRole('button', { name: /cancelar/i }));
    await waitFor(() => expect(screen.queryByText('Vais fazer:')).not.toBeInTheDocument());
    expect(global.fetch).toHaveBeenCalledTimes(1); // só o submit inicial
  });

  it('error 401 → redirect /entrar via router.push', async () => {
    setFetchResponse(false, 401, { error: { code: 'AUTH_REQUIRED', message: 'Sessão expirada' } });
    render(<JarvisChat />);
    await submitPrompt('oi');
    await waitFor(() => expect(pushMock).toHaveBeenCalledWith('/entrar'));
  });

  it('error 429 RATE_LIMIT_EXCEEDED → mensagem PT-PT com retry seconds', async () => {
    setFetchResponse(false, 429, {
      error: {
        code: 'RATE_LIMIT_EXCEEDED',
        message: 'Rate limit exceeded — internal detail',
        details: { retry_after_seconds: 30 },
      },
    });
    render(<JarvisChat />);
    await submitPrompt('oi');
    await waitFor(() =>
      expect(screen.getByRole('alert')).toHaveTextContent(/depressa demais/i),
    );
    expect(screen.getByRole('alert')).toHaveTextContent(/30 segundos/);
    // O `message` técnico do servidor nunca é renderizado.
    expect(screen.getByRole('alert')).not.toHaveTextContent(/internal detail/i);
  });

  it('error 429 QUOTA_EXCEEDED → janela mensal, NÃO "60 segundos"', async () => {
    setFetchResponse(false, 429, {
      error: {
        code: 'QUOTA_EXCEEDED',
        message: 'Quota exceeded',
        details: { plan: 'familia', period_end: '2026-06-15T12:00:00.000Z' },
      },
    });
    render(<JarvisChat />);
    await submitPrompt('oi');
    await waitFor(() =>
      expect(screen.getByRole('alert')).toHaveTextContent(/limite de pedidos/i),
    );
    const alert = screen.getByRole('alert');
    expect(alert).toHaveTextContent(/familia/);
    expect(alert).not.toHaveTextContent(/60 segundos/);
  });

  it('error 400 CLASSIFIER_ERROR → mensagem amigável, jargão técnico NUNCA no ecrã', async () => {
    // Cenário real do bug 14/05/2026: o backend devolvia
    // "Classifier LLM call failed (j): Provider openai returned 400 ..." como
    // error.message — e o frontend mostrava-o cru ao utilizador final.
    setFetchResponse(false, 400, {
      error: {
        code: 'CLASSIFIER_ERROR',
        message: 'Classifier LLM call failed (j): Provider openai returned 400 (bad request)',
      },
    });
    render(<JarvisChat />);
    await submitPrompt('olá');
    await waitFor(() =>
      expect(screen.getByRole('alert')).toHaveTextContent(/reformular/i),
    );
    const alert = screen.getByRole('alert');
    expect(alert).not.toHaveTextContent(/classifier/i);
    expect(alert).not.toHaveTextContent(/provider/i);
    expect(alert).not.toHaveTextContent(/openai/i);
    // 400 não é 5xx → não vai para Sentry.
    expect(captureExceptionMock).not.toHaveBeenCalled();
  });

  it('error 5xx → mensagem genérica PT-PT + captureException, sem message técnico', async () => {
    setFetchResponse(false, 500, {
      error: { code: 'INTERNAL_ERROR', message: 'Classifier crashed — stack trace internal' },
    });
    render(<JarvisChat />);
    await submitPrompt('oi');
    await waitFor(() =>
      expect(screen.getByRole('alert')).toHaveTextContent(/nosso lado|temporário/i),
    );
    // O `message` técnico cru NUNCA chega ao ecrã (spec §2).
    expect(screen.getByRole('alert')).not.toHaveTextContent(/stack trace/i);
    // 5xx → capturado em Sentry para diagnóstico.
    expect(captureExceptionMock).toHaveBeenCalledTimes(1);
  });

  it('fetch network error → mensagem genérica PT-PT', async () => {
    (global.fetch as unknown as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
      new Error('network down'),
    );
    render(<JarvisChat />);
    await submitPrompt('oi');
    await waitFor(() =>
      expect(screen.getByRole('alert')).toHaveTextContent(/erro temporário/i),
    );
  });

  // ── Story 2.8 AC13 — UI Undo passthrough (2 testes novos) ──────────────

  it('AC13 (i) executed → ResultMessage renderizado com botão Anular activo', async () => {
    setFetchResponse(true, 200, {
      mode: 'executed',
      run_id: 'r1',
      summary: 'Executei 1 operação.',
      results: { success: true, results: [{ tool_name: 'create_task' }] },
      undo_url: '/api/agent/prompt/r1/undo',
      undo_expires_at: new Date(Date.now() + 30_000).toISOString(),
    });
    render(<JarvisChat />);
    await submitPrompt('criar tarefa');
    await waitFor(() => expect(screen.getByText(/Feito/)).toBeInTheDocument());
    const undoButton = screen.getByRole('button', { name: /anular/i });
    expect(undoButton).not.toBeDisabled();
    expect(undoButton).toHaveTextContent(/Anular \(\d+s\)/);
  });

  it('AC13 (ii) preview → confirm → ResultMessage com botão Anular activo (undo fields propagados)', async () => {
    setFetchResponse(true, 200, {
      mode: 'preview',
      run_id: 'r1',
      plan_summary: ['criar_tarefa (60%)'],
      confidence: 0.6,
      expires_at: new Date(Date.now() + 300_000).toISOString(),
    });
    setFetchResponse(true, 200, {
      run_id: 'r1',
      results: { success: true, results: [{ tool_name: 'create_task' }] },
      undo_url: '/api/agent/prompt/r1/undo',
      undo_expires_at: new Date(Date.now() + 30_000).toISOString(),
    });
    render(<JarvisChat />);
    await submitPrompt('fazer algo');
    await waitFor(() => expect(screen.getByText('Vais fazer:')).toBeInTheDocument());
    fireEvent.click(screen.getByRole('button', { name: /confirmar/i }));
    await waitFor(() => expect(screen.getByText(/Feito/)).toBeInTheDocument());
    const undoButton = screen.getByRole('button', { name: /anular/i });
    expect(undoButton).not.toBeDisabled();
    expect(undoButton).toHaveTextContent(/Anular \(\d+s\)/);
  });
});
