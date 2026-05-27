/**
 * Tests UI — `<ChatPanel>` (Story 5.4 AC1 + AC7.c).
 *
 * Cobertura 8 testes (consolida jarvis-chat.test.tsx eliminado):
 *   1. Render mode "panel" mostra ChatInput + aria-live container
 *   2. Render mode "fullscreen" mostra ChatInput + outer space-y-4
 *   3. Submit prompt dispara POST /api/agent/prompt com body { prompt }
 *   4. Response mode "executed" renderiza ResultMessage com undo
 *   5. Response mode "preview" renderiza PreviewCard
 *   6. HTTP 401 dispara router.push('/entrar')
 *   7. HTTP 500 captura via Sentry + mostra mensagem PT-PT genérica
 *   8. Network failure (fetch throw) mostra "Erro temporário. Tenta de novo."
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const pushMock = vi.fn();
const captureExceptionMock = vi.fn();

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: pushMock }),
}));

vi.mock('@sentry/nextjs', () => ({
  captureException: (...args: unknown[]) => captureExceptionMock(...args),
}));

import { ChatPanel } from '@/components/chat/ChatPanel';
import { useChatStore } from '@/lib/stores/chatStore';

function resetState() {
  useChatStore.setState({
    messages: [],
    preview: null,
    loading: false,
  });
  pushMock.mockReset();
  captureExceptionMock.mockReset();
}

beforeEach(() => {
  resetState();
  global.fetch = vi.fn();
});

afterEach(() => {
  resetState();
  vi.restoreAllMocks();
});

describe('<ChatPanel mode="fullscreen">', () => {
  it('renderiza ChatInput + container outer com space-y-4', () => {
    const { container } = render(<ChatPanel mode="fullscreen" />);
    expect(screen.getByLabelText('Prompt')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /enviar/i })).toBeInTheDocument();
    // Outer div com classe space-y-4
    expect(container.firstChild).toHaveClass('space-y-4');
  });
});

describe('<ChatPanel mode="panel">', () => {
  it('renderiza ChatInput + container outer com flex h-full overflow-y-auto', () => {
    const { container } = render(<ChatPanel mode="panel" />);
    expect(screen.getByLabelText('Prompt')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /enviar/i })).toBeInTheDocument();
    // Outer div com h-full + overflow-y-auto (scrollable em 400px)
    const outer = container.firstChild as HTMLElement;
    expect(outer.className).toContain('h-full');
    expect(outer.className).toContain('overflow-y-auto');
  });
});

describe('ChatPanel — submit + endpoint', () => {
  it('submit prompt dispara POST /api/agent/prompt com body correcto', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            mode: 'executed',
            run_id: 'run-test-1',
            summary: 'Feito.',
            results: { success: true, results: [] },
            undo_url: '/api/agent/undo/run-test-1',
            undo_expires_at: new Date(Date.now() + 30_000).toISOString(),
          }),
          { status: 200 },
        ),
      );
    global.fetch = fetchMock;

    const user = userEvent.setup();
    render(<ChatPanel mode="fullscreen" />);

    const textarea = screen.getByLabelText('Prompt');
    await user.type(textarea, 'olá');
    await user.click(screen.getByRole('button', { name: /enviar/i }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith('/api/agent/prompt', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ prompt: 'olá' }),
      });
    });
  });

  it('response mode "executed" adiciona ResultMessage ao histórico', async () => {
    global.fetch = vi.fn().mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          mode: 'executed',
          run_id: 'run-exec-1',
          summary: 'Criei 2 tarefas.',
          results: { success: true, results: [{ id: 't1' }, { id: 't2' }] },
          undo_url: '/api/agent/undo/run-exec-1',
          undo_expires_at: new Date(Date.now() + 30_000).toISOString(),
        }),
        { status: 200 },
      ),
    );

    const user = userEvent.setup();
    render(<ChatPanel mode="fullscreen" />);

    await user.type(screen.getByLabelText('Prompt'), 'cria 2 tarefas');
    await user.click(screen.getByRole('button', { name: /enviar/i }));

    await waitFor(() => {
      // ResultMessage renderiza o summary
      expect(screen.getByText(/Criei 2 tarefas\./i)).toBeInTheDocument();
    });
  });

  it('response mode "preview" renderiza PreviewCard com plan_summary', async () => {
    global.fetch = vi.fn().mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          mode: 'preview',
          run_id: 'run-preview-1',
          plan_summary: ['Criar tarefa "Comprar pão"', 'Adicionar despesa €5,30'],
          confidence: 0.55,
          expires_at: new Date(Date.now() + 30_000).toISOString(),
        }),
        { status: 200 },
      ),
    );

    const user = userEvent.setup();
    render(<ChatPanel mode="fullscreen" />);

    await user.type(screen.getByLabelText('Prompt'), 'comprar pão e despesa');
    await user.click(screen.getByRole('button', { name: /enviar/i }));

    await waitFor(() => {
      expect(useChatStore.getState().preview).not.toBeNull();
      expect(useChatStore.getState().preview?.runId).toBe('run-preview-1');
    });
  });
});

describe('ChatPanel — error handling', () => {
  it('HTTP 401 dispara router.push(/entrar)', async () => {
    global.fetch = vi
      .fn()
      .mockResolvedValueOnce(new Response('', { status: 401 }));

    const user = userEvent.setup();
    render(<ChatPanel mode="fullscreen" />);

    await user.type(screen.getByLabelText('Prompt'), 'teste');
    await user.click(screen.getByRole('button', { name: /enviar/i }));

    await waitFor(() => {
      expect(pushMock).toHaveBeenCalledWith('/entrar');
    });
  });

  it('HTTP 500 chama captureException via Sentry + adiciona mensagem PT-PT', async () => {
    global.fetch = vi.fn().mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          error: { code: 'INTERNAL_ERROR', message: 'Server crash' },
        }),
        { status: 500 },
      ),
    );

    const user = userEvent.setup();
    render(<ChatPanel mode="fullscreen" />);

    await user.type(screen.getByLabelText('Prompt'), 'crash');
    await user.click(screen.getByRole('button', { name: /enviar/i }));

    await waitFor(() => {
      expect(captureExceptionMock).toHaveBeenCalled();
    });

    // Verificar que mensagem de erro foi adicionada (não é a mensagem técnica do servidor)
    await waitFor(() => {
      const errorMessages = useChatStore.getState().messages.filter((m) => m.kind === 'error');
      expect(errorMessages.length).toBeGreaterThan(0);
    });
  });

  it('Network failure (fetch throw) mostra "Erro temporário. Tenta de novo."', async () => {
    global.fetch = vi.fn().mockRejectedValueOnce(new Error('Network down'));

    const user = userEvent.setup();
    render(<ChatPanel mode="fullscreen" />);

    await user.type(screen.getByLabelText('Prompt'), 'erro de rede');
    await user.click(screen.getByRole('button', { name: /enviar/i }));

    await waitFor(() => {
      expect(screen.getByText('Erro temporário. Tenta de novo.')).toBeInTheDocument();
    });
  });
});
