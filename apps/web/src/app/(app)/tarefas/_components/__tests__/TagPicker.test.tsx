import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';

import { TagPicker } from '@/app/(app)/tarefas/_components/TagPicker';

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
  // Reset default — sem fetch ainda
  global.fetch = vi.fn() as unknown as typeof global.fetch;
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('<TagPicker>', () => {
  it('abre dropdown ao clicar trigger', () => {
    mockFetch(() => ({ body: { tags: [] } }));
    render(<TagPicker taskId="task-1" currentTags={[]} onTagsChange={() => {}} />);
    fireEvent.click(screen.getByRole('button', { name: /\+ Tag/i }));
    expect(screen.getByRole('combobox')).toBeInTheDocument();
  });

  it('filtra tags por prefixo case-insensitive', async () => {
    mockFetch((url) => {
      if (url === '/api/tags') {
        return {
          body: {
            tags: [
              { id: 't1', name: 'trabalho', color: '#3B82F6' },
              { id: 't2', name: 'compras', color: '#22C55E' },
              { id: 't3', name: 'casa', color: '#EF4444' },
            ],
          },
        };
      }
      return { body: {} };
    });
    render(<TagPicker taskId="task-1" currentTags={[]} onTagsChange={() => {}} />);
    fireEvent.click(screen.getByRole('button', { name: /\+ Tag/i }));
    await waitFor(() => expect(screen.getByText('trabalho')).toBeInTheDocument());
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'co' } });
    expect(screen.getByText('compras')).toBeInTheDocument();
    expect(screen.queryByText('trabalho')).not.toBeInTheDocument();
  });

  it('seleccionar tag não-aplicada chama POST /api/tasks/[id]/tags', async () => {
    const calls: string[] = [];
    mockFetch((url, init) => {
      if (url === '/api/tags') {
        return {
          body: { tags: [{ id: 't1', name: 'trabalho', color: '#3B82F6' }] },
        };
      }
      if (url === '/api/tasks/task-1/tags' && init?.method === 'POST') {
        calls.push(url);
        return { body: {} };
      }
      return { body: {} };
    });
    const onTagsChange = vi.fn();
    render(<TagPicker taskId="task-1" currentTags={[]} onTagsChange={onTagsChange} />);
    fireEvent.click(screen.getByRole('button', { name: /\+ Tag/i }));
    await waitFor(() => expect(screen.getByText('trabalho')).toBeInTheDocument());
    fireEvent.click(screen.getByText('trabalho'));
    await waitFor(() => expect(calls).toHaveLength(1));
    expect(onTagsChange).toHaveBeenCalled();
  });

  it('remover tag aplicada chama DELETE /api/tasks/[id]/tags/[tagId]', async () => {
    const calls: string[] = [];
    mockFetch((url, init) => {
      if (url === '/api/tags') {
        return {
          body: { tags: [{ id: 't1', name: 'trabalho', color: '#3B82F6' }] },
        };
      }
      if (init?.method === 'DELETE' && url === '/api/tasks/task-1/tags/t1') {
        calls.push(url);
        return { body: {} };
      }
      return { body: {} };
    });
    const onTagsChange = vi.fn();
    render(
      <TagPicker
        taskId="task-1"
        currentTags={[{ id: 't1', name: 'trabalho', color: '#3B82F6' }]}
        onTagsChange={onTagsChange}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: /\+ Tag/i }));
    await waitFor(() => expect(screen.getByText('trabalho')).toBeInTheDocument());
    fireEvent.click(screen.getByText('trabalho'));
    await waitFor(() => expect(calls).toHaveLength(1));
  });

  it('criação inline mostra "Criar #x" quando não há match', async () => {
    mockFetch(() => ({ body: { tags: [{ id: 't1', name: 'existente', color: '#000000' }] } }));
    render(<TagPicker taskId="task-1" currentTags={[]} onTagsChange={() => {}} />);
    fireEvent.click(screen.getByRole('button', { name: /\+ Tag/i }));
    await waitFor(() => expect(screen.getByText('existente')).toBeInTheDocument());
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'nova' } });
    expect(screen.getByText(/Criar/)).toBeInTheDocument();
  });

  it('soft limit 5 — desactiva opções não seleccionadas quando count = 5', async () => {
    mockFetch(() => ({
      body: {
        tags: [
          { id: 'a', name: 'a', color: '#000000' },
          { id: 'b', name: 'b', color: '#111111' },
          { id: 'c', name: 'c', color: '#222222' },
          { id: 'd', name: 'd', color: '#333333' },
          { id: 'e', name: 'e', color: '#444444' },
          { id: 'f', name: 'f', color: '#555555' },
        ],
      },
    }));
    render(
      <TagPicker
        taskId="task-1"
        currentTags={[
          { id: 'a', name: 'a', color: '#000000' },
          { id: 'b', name: 'b', color: '#111111' },
          { id: 'c', name: 'c', color: '#222222' },
          { id: 'd', name: 'd', color: '#333333' },
          { id: 'e', name: 'e', color: '#444444' },
        ]}
        onTagsChange={() => {}}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: /\+ Tag/i }));
    await waitFor(() => expect(screen.getByText('f')).toBeInTheDocument());
    // Encontrar o botão (não a span interna) — closest('button')
    const fSpan = screen.getByText('f');
    const fButton = fSpan.closest('button');
    expect(fButton?.disabled).toBe(true);
    expect(fButton?.title).toContain('Limite de 5');
  });
});
