/**
 * Tests `<TaskList>` (Story 3.3 T4.3-T4.4 / AC5+AC6).
 *
 * Cobre: agrupamento via helper + Atrasadas always first FR11 + render PT-PT.
 */
import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';

import type { TaskRow } from '@/lib/api-helpers/list-tasks';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
  useSearchParams: () => new URLSearchParams(''),
}));

import { TaskList } from '@/app/(app)/tarefas/_components/TaskList';

function makeTask(o: Partial<TaskRow>): TaskRow {
  return {
    id: 'x',
    household_id: 'h1',
    created_by_user_id: 'u1',
    assigned_to_user_id: null,
    title: 'Tarefa',
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
    ...o,
  };
}

describe('<TaskList>', () => {
  it('renderiza secções com labels PT-PT', () => {
    const tasks = [makeTask({ id: 't1', title: 'Sem prazo task' })];
    render(<TaskList tasks={tasks} />);
    expect(screen.getByText('Sem prazo')).toBeInTheDocument();
    expect(screen.getByText('Sem prazo task')).toBeInTheDocument();
  });

  it('Atrasadas section aparece SEMPRE em primeiro (FR11) quando há overdue', () => {
    // Atrasada definite (1990-01-01 << now())
    const tasks = [
      makeTask({ id: 't1', title: 'Sem prazo task' }),
      makeTask({ id: 't2', title: 'Atrasada task', due_date: '1990-01-01' }),
    ];
    render(<TaskList tasks={tasks} />);
    const headers = screen.getAllByRole('heading', { level: 2 });
    expect(headers[0]!.textContent).toMatch(/Atrasadas/);
  });

  it('archived tasks não aparecem', () => {
    const tasks = [
      makeTask({ id: 't1', title: 'Tarefa activa' }),
      makeTask({ id: 't2', title: 'Tarefa arquivada', status: 'archived' }),
    ];
    render(<TaskList tasks={tasks} />);
    expect(screen.getByText('Tarefa activa')).toBeInTheDocument();
    expect(screen.queryByText('Tarefa arquivada')).not.toBeInTheDocument();
  });
});
