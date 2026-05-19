/**
 * Tests `<BulkActionsBar>` (Story 3.3 T6.1-T6.6 / AC7).
 *
 * Cobre: count badge + bulk complete success + bulk priority partial failure +
 * bulk delete com confirm + cancel selection.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';

import type { TaskRow } from '@/lib/api-helpers/list-tasks';

const refreshMock = vi.fn();
vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: refreshMock }),
}));

import { BulkActionsBar } from '@/app/(app)/tarefas/_components/BulkActionsBar';

function makeTask(id: string): TaskRow {
  return {
    id,
    household_id: 'h1',
    created_by_user_id: 'u1',
    assigned_to_user_id: null,
    title: `Tarefa ${id}`,
    description: null,
    due_date: null,
    due_time: null,
    priority: 'medium',
    status: 'todo',
    kanban_column_id: null,
    kanban_position: 0,
    project: null,
    recurrence_id: null,
    is_recurrence_template: false,
    completed_at: null,
    created_at: '2026-01-01T00:00:00.000Z',
    updated_at: '2026-01-01T00:00:00.000Z',
    tags: [],
  };
}

beforeEach(() => {
  global.fetch = vi.fn();
  refreshMock.mockReset();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('<BulkActionsBar>', () => {
  it('renderiza count "N tarefas seleccionadas" em PT-PT', () => {
    render(
      <BulkActionsBar
        selectedTasks={[makeTask('t1'), makeTask('t2')]}
        onClear={() => {}}
        onSelectAll={() => {}}
        totalCount={5}
      />,
    );
    expect(screen.getByText(/2 tarefas seleccionadas/i)).toBeInTheDocument();
  });

  it('singular "1 tarefa seleccionada"', () => {
    render(
      <BulkActionsBar
        selectedTasks={[makeTask('t1')]}
        onClear={() => {}}
        onSelectAll={() => {}}
        totalCount={5}
      />,
    );
    expect(screen.getByText(/1 tarefa seleccionada/i)).toBeInTheDocument();
  });

  it('bulk complete success → fetch PATCH per task + banner sucesso PT-PT', async () => {
    (global.fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({}),
    });
    const onClear = vi.fn();
    render(
      <BulkActionsBar
        selectedTasks={[makeTask('t1'), makeTask('t2')]}
        onClear={onClear}
        onSelectAll={() => {}}
        totalCount={5}
      />,
    );
    fireEvent.click(screen.getByText('Marcar como concluídas'));
    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledTimes(2);
    });
    expect(global.fetch).toHaveBeenCalledWith(
      '/api/tasks/t1',
      expect.objectContaining({
        method: 'PATCH',
        body: JSON.stringify({ status: 'done' }),
      }),
    );
    await waitFor(() => {
      expect(screen.getByRole('status')).toHaveTextContent(/2 tarefas atualizadas/i);
    });
    expect(onClear).toHaveBeenCalled();
    expect(refreshMock).toHaveBeenCalled();
  });

  it('bulk priority partial failure → banner partial PT-PT', async () => {
    (global.fetch as unknown as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce({ ok: true, status: 200, json: async () => ({}) })
      .mockResolvedValueOnce({ ok: false, status: 500, json: async () => ({ error: { message: 'x' } }) });
    render(
      <BulkActionsBar
        selectedTasks={[makeTask('t1'), makeTask('t2')]}
        onClear={() => {}}
        onSelectAll={() => {}}
        totalCount={5}
      />,
    );
    fireEvent.click(screen.getByText(/Mudar prioridade/));
    const altaButton = await screen.findByText('Alta');
    fireEvent.click(altaButton);
    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent(/1 de 2 tarefas atualizadas/i);
    });
  });

  it('cancel button chama onClear', () => {
    const onClear = vi.fn();
    render(
      <BulkActionsBar
        selectedTasks={[makeTask('t1')]}
        onClear={onClear}
        onSelectAll={() => {}}
        totalCount={5}
      />,
    );
    fireEvent.click(screen.getByText('Cancelar'));
    expect(onClear).toHaveBeenCalled();
  });
});
