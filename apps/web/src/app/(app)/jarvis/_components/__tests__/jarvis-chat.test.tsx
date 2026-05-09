/**
 * Tests UI — `JarvisChat` (Story 2.7 T6 + AC6/AC7/AC9).
 *
 * Cobertura ≥6 tests: render initial state, submit success → executed,
 * submit → preview → confirm → result, error 401 → redirect /entrar,
 * error 429 → mensagem PT-PT com retry seconds, error 5xx → mensagem genérica.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

const pushMock = vi.fn();

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: pushMock }),
}));

import { JarvisChat } from '@/app/(app)/jarvis/_components/jarvis-chat';

beforeEach(() => {
  pushMock.mockReset();
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
    // 2ª call: /api/agent/prompt/r1/confirm → results
    setFetchResponse(true, 200, {
      run_id: 'r1',
      results: { success: true, results: [{ tool_name: 'create_task' }] },
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

  it('error 429 → mensagem PT-PT "Excedeste o limite"', async () => {
    setFetchResponse(false, 429, {
      error: {
        code: 'RATE_LIMIT_EXCEEDED',
        message: 'Rate limit',
        details: { retry_after_seconds: 30 },
      },
    });
    render(<JarvisChat />);
    await submitPrompt('oi');
    await waitFor(() =>
      expect(screen.getByRole('alert')).toHaveTextContent(/excedeste o limite/i),
    );
    expect(screen.getByRole('alert')).toHaveTextContent(/30 segundos/);
  });

  it('error 5xx → mensagem genérica PT-PT', async () => {
    setFetchResponse(false, 500, { error: { message: 'Erro interno.' } });
    render(<JarvisChat />);
    await submitPrompt('oi');
    await waitFor(() =>
      expect(screen.getByRole('alert')).toHaveTextContent(/erro interno|temporário/i),
    );
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
});
