/**
 * Testes `<KanbanAddInline>` — botão fantasma → input, Enter cria, Esc cancela,
 * error mantém valor (Story 3.4 T11.5).
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: () => {} }),
}));

const fetchMock = vi.fn();
vi.stubGlobal('fetch', fetchMock);

import { KanbanAddInline } from '@/app/(app)/tarefas/kanban/_components/KanbanAddInline';

afterEach(() => {
  cleanup();
  fetchMock.mockReset();
});

describe('<KanbanAddInline>', () => {
  it('estado inicial: botão fantasma "+ Adicionar tarefa"', () => {
    render(<KanbanAddInline columnId="col1" nextPosition={0} />);
    expect(screen.getByRole('button', { name: /\+ Adicionar tarefa/i })).toBeInTheDocument();
  });

  it('click no botão revela input', () => {
    render(<KanbanAddInline columnId="col1" nextPosition={0} />);
    fireEvent.click(screen.getByRole('button', { name: /\+ Adicionar tarefa/i }));
    expect(screen.getByRole('textbox')).toBeInTheDocument();
  });

  it('Enter com valor chama POST /api/tasks com kanban_column_id', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({ task: { id: 'new' } }),
    });
    render(<KanbanAddInline columnId="col1" nextPosition={5} />);
    fireEvent.click(screen.getByRole('button', { name: /\+ Adicionar tarefa/i }));
    const input = screen.getByRole('textbox');
    fireEvent.change(input, { target: { value: 'Nova tarefa' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    await new Promise((r) => setTimeout(r, 20));
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/tasks',
      expect.objectContaining({
        method: 'POST',
        body: expect.stringContaining('"kanban_column_id":"col1"'),
      }),
    );
  });

  it('Esc cancela sem POST', () => {
    render(<KanbanAddInline columnId="col1" nextPosition={0} />);
    fireEvent.click(screen.getByRole('button', { name: /\+ Adicionar tarefa/i }));
    const input = screen.getByRole('textbox');
    fireEvent.change(input, { target: { value: 'Algo' } });
    fireEvent.keyDown(input, { key: 'Escape' });
    expect(fetchMock).not.toHaveBeenCalled();
    // Voltou ao estado botão fantasma
    expect(screen.getByRole('button', { name: /\+ Adicionar tarefa/i })).toBeInTheDocument();
  });
});
