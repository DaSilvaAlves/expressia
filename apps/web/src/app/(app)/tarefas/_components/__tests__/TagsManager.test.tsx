import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';

import { TagsManager } from '@/app/(app)/tarefas/_components/TagsManager';

interface FetchResponseInit {
  status?: number;
  body?: unknown;
}

function mockFetch(impl: (url: string, init?: RequestInit) => FetchResponseInit) {
  global.fetch = vi.fn(async (url: string, init?: RequestInit) => {
    const result = impl(url, init);
    return {
      ok: (result.status ?? 200) >= 200 && (result.status ?? 200) < 300,
      status: result.status ?? 200,
      json: async () => result.body ?? {},
    } as Response;
  }) as unknown as typeof global.fetch;
}

beforeEach(() => {
  global.fetch = vi.fn() as unknown as typeof global.fetch;
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('<TagsManager>', () => {
  it('lista tags com counts ao abrir', async () => {
    mockFetch((url) => {
      if (url === '/api/tags?with_counts=true') {
        return {
          body: {
            tags: [
              { id: 't1', name: 'trabalho', color: '#3B82F6', task_count: 5 },
              { id: 't2', name: 'compras', color: '#22C55E', task_count: 0 },
            ],
          },
        };
      }
      return { body: {} };
    });
    render(<TagsManager open={true} onClose={() => {}} />);
    await waitFor(() => expect(screen.getByText('trabalho')).toBeInTheDocument());
    expect(screen.getByText('compras')).toBeInTheDocument();
    expect(screen.getByText(/5 tarefas/)).toBeInTheDocument();
    expect(screen.getByText(/0 tarefas/)).toBeInTheDocument();
  });

  it('empty state quando household sem tags', async () => {
    mockFetch(() => ({ body: { tags: [] } }));
    render(<TagsManager open={true} onClose={() => {}} />);
    await waitFor(() =>
      expect(
        screen.getByText(/Ainda não tens tags. Cria a primeira/),
      ).toBeInTheDocument(),
    );
  });

  it('criar tag → POST /api/tags + append à lista', async () => {
    const calls: { url: string; method?: string }[] = [];
    mockFetch((url, init) => {
      calls.push({ url, method: init?.method });
      if (url === '/api/tags?with_counts=true') return { body: { tags: [] } };
      if (url === '/api/tags' && init?.method === 'POST') {
        return {
          status: 201,
          body: { tag: { id: 'tnew', name: 'nova', color: '#3B82F6' } },
        };
      }
      return { body: {} };
    });
    render(<TagsManager open={true} onClose={() => {}} />);
    await waitFor(() =>
      expect(screen.getByText(/Ainda não tens tags/)).toBeInTheDocument(),
    );
    const input = screen.getByPlaceholderText(/ex: trabalho/);
    fireEvent.change(input, { target: { value: 'nova' } });
    fireEvent.click(screen.getByRole('button', { name: 'Criar tag' }));
    await waitFor(() =>
      expect(calls.some((c) => c.url === '/api/tags' && c.method === 'POST')).toBe(true),
    );
    await waitFor(() => expect(screen.getByText('nova')).toBeInTheDocument());
  });

  it('409 conflict mostra mensagem PT-PT "Já existe uma tag"', async () => {
    mockFetch((url, init) => {
      if (url === '/api/tags?with_counts=true') return { body: { tags: [] } };
      if (url === '/api/tags' && init?.method === 'POST') {
        return { status: 409, body: { error: { code: 'CONFLICT' } } };
      }
      return { body: {} };
    });
    render(<TagsManager open={true} onClose={() => {}} />);
    await waitFor(() =>
      expect(screen.getByText(/Ainda não tens tags/)).toBeInTheDocument(),
    );
    fireEvent.change(screen.getByPlaceholderText(/ex: trabalho/), {
      target: { value: 'duplicada' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Criar tag' }));
    await waitFor(() =>
      expect(screen.getByText(/Já existe uma tag com este nome/)).toBeInTheDocument(),
    );
  });
});
