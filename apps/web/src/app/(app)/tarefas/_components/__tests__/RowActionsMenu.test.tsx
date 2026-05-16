/**
 * Tests `<RowActionsMenu>` (Story 3.3 T7.2 / AC8).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';

import type { TaskRow } from '@/lib/api-helpers/list-tasks';

const refreshMock = vi.fn();
vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: refreshMock }),
}));

import { RowActionsMenu } from '@/app/(app)/tarefas/_components/RowActionsMenu';

function makeTask(): TaskRow {
  return {
    id: 't1',
    household_id: 'h1',
    created_by_user_id: 'u1',
    assigned_to_user_id: null,
    title: 'Comprar pão',
    description: null,
    due_date: '2026-05-20',
    due_time: null,
    priority: 'medium',
    status: 'todo',
    kanban_column_id: null,
    kanban_position: 0,
    project: null,
    recurrence_id: null,
    is_recurrence_template: false,
    completed_at: null,
    created_at: '2026-05-01T00:00:00.000Z',
    updated_at: '2026-05-01T00:00:00.000Z',
  };
}

beforeEach(() => {
  global.fetch = vi.fn();
  refreshMock.mockReset();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('<RowActionsMenu>', () => {
  it('abre menu com 4 opções PT-PT (Editar / Adiar / Mudar prioridade / Eliminar)', async () => {
    render(<RowActionsMenu task={makeTask()} onEdit={() => {}} />);
    fireEvent.click(screen.getByLabelText('Acções da tarefa'));
    expect(await screen.findByText('Editar')).toBeInTheDocument();
    expect(screen.getByText('Adiar 1 dia')).toBeInTheDocument();
    expect(screen.getByText(/Mudar prioridade/)).toBeInTheDocument();
    expect(screen.getByText('Eliminar')).toBeInTheDocument();
  });

  it('Editar chama onEdit callback + fecha menu', async () => {
    const onEdit = vi.fn();
    render(<RowActionsMenu task={makeTask()} onEdit={onEdit} />);
    fireEvent.click(screen.getByLabelText('Acções da tarefa'));
    fireEvent.click(await screen.findByText('Editar'));
    expect(onEdit).toHaveBeenCalled();
  });

  it('Mudar prioridade → submenu com Alta/Média/Baixa → PATCH', async () => {
    (global.fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ task: { id: 't1', priority: 'high' } }),
    });
    render(<RowActionsMenu task={makeTask()} onEdit={() => {}} />);
    fireEvent.click(screen.getByLabelText('Acções da tarefa'));
    fireEvent.click(await screen.findByText(/Mudar prioridade/));
    fireEvent.click(await screen.findByText('Alta'));
    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith(
        '/api/tasks/t1',
        expect.objectContaining({
          method: 'PATCH',
          body: JSON.stringify({ priority: 'high' }),
        }),
      );
    });
  });
});
