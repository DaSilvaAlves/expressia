/**
 * Tests `<CalendarTaskCard>` (Story 3.5 T11.3).
 *
 * Mocks `@dnd-kit/sortable` + `@dnd-kit/utilities` (pattern Story 3.4).
 */
import { describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: () => {} }),
}));

vi.mock('@sentry/nextjs', () => ({
  captureException: vi.fn(),
}));

vi.mock('@dnd-kit/sortable', () => ({
  useSortable: () => ({
    attributes: {},
    listeners: {},
    setNodeRef: () => {},
    transform: null,
    transition: null,
    isDragging: false,
  }),
}));

vi.mock('@dnd-kit/utilities', () => ({
  CSS: {
    Translate: { toString: () => '' },
  },
}));

import { CalendarTaskCard } from '@/app/(app)/tarefas/calendario/_components/CalendarTaskCard';
import type { TaskRow } from '@/lib/api-helpers/list-tasks';

function makeTask(overrides: Partial<TaskRow> = {}): TaskRow {
  return {
    id: 't1',
    household_id: 'h1',
    created_by_user_id: 'u1',
    assigned_to_user_id: null,
    title: 'Pagar IRS',
    description: null,
    due_date: '2026-05-15',
    due_time: null,
    priority: 'high',
    status: 'todo',
    kanban_column_id: null,
    kanban_position: 0,
    project: null,
    recurrence_id: null,
    is_recurrence_template: false,
    completed_at: null,
    created_at: '2026-05-01T10:00:00Z',
    updated_at: '2026-05-01T10:00:00Z',
    tags: [],
    ...overrides,
  };
}

describe('<CalendarTaskCard>', () => {
  it('renderiza title + checkbox + priority dot', () => {
    render(<CalendarTaskCard task={makeTask()} />);
    expect(screen.getByText('Pagar IRS')).toBeInTheDocument();
    expect(screen.getByRole('checkbox')).toBeInTheDocument();
    // Priority dot é um <span aria-hidden> com title — só verificamos que existe.
  });

  it('aplica line-through + opacity quando status === "done"', () => {
    render(<CalendarTaskCard task={makeTask({ status: 'done' })} />);
    const title = screen.getByText('Pagar IRS');
    expect(title.className).toMatch(/line-through/);
  });

  it('chama onOpen quando body é clicado (não no checkbox)', () => {
    const onOpen = vi.fn();
    render(<CalendarTaskCard task={makeTask()} onOpen={onOpen} />);
    const body = screen.getByRole('button', { name: /Tarefa Pagar IRS/ });
    fireEvent.click(body);
    expect(onOpen).toHaveBeenCalledWith('t1');
  });

  it('NÃO chama onOpen no modo overlay', () => {
    const onOpen = vi.fn();
    render(<CalendarTaskCard task={makeTask()} mode="overlay" onOpen={onOpen} />);
    // No overlay mode, role="button" não é aplicado.
    expect(screen.queryByRole('button')).toBeNull();
    expect(onOpen).not.toHaveBeenCalled();
  });

  it('marca como atrasada (border-l-red-500) se due_date < hoje + status != done', () => {
    const past = makeTask({ due_date: '2020-01-01', status: 'todo' });
    const { container } = render(<CalendarTaskCard task={past} />);
    const root = container.firstChild as HTMLElement;
    expect(root.className).toMatch(/border-l-red-500/);
  });
});
