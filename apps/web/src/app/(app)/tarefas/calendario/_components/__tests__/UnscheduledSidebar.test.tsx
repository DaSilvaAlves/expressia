/**
 * Tests `<UnscheduledSidebar>` (Story 3.5 T11.4 — count + empty + "Ver todas" link).
 */
import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: () => {} }),
}));

vi.mock('@sentry/nextjs', () => ({
  captureException: vi.fn(),
}));

vi.mock('@dnd-kit/core', () => ({
  useDroppable: () => ({ setNodeRef: () => {}, isOver: false }),
}));

vi.mock('@dnd-kit/sortable', () => ({
  SortableContext: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  verticalListSortingStrategy: undefined,
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
  CSS: { Translate: { toString: () => '' } },
}));

import { UnscheduledSidebar } from '@/app/(app)/tarefas/calendario/_components/UnscheduledSidebar';
import type { TaskRow } from '@/lib/api-helpers/list-tasks';

function makeTask(id: string, title: string): TaskRow {
  return {
    id,
    household_id: 'h1',
    created_by_user_id: 'u1',
    assigned_to_user_id: null,
    title,
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
    created_at: '2026-05-01T10:00:00Z',
    updated_at: '2026-05-01T10:00:00Z',
  };
}

describe('<UnscheduledSidebar>', () => {
  it('renderiza header "Por agendar" + count chip', () => {
    const tasks = [makeTask('t1', 'A'), makeTask('t2', 'B'), makeTask('t3', 'C')];
    render(<UnscheduledSidebar tasks={tasks} />);
    expect(screen.getByText('Por agendar')).toBeInTheDocument();
    expect(screen.getByLabelText('3 por agendar')).toBeInTheDocument();
  });

  it('lista as tarefas passadas como prop', () => {
    const tasks = [makeTask('t1', 'Comprar pão'), makeTask('t2', 'Ligar à Maria')];
    render(<UnscheduledSidebar tasks={tasks} />);
    expect(screen.getByText('Comprar pão')).toBeInTheDocument();
    expect(screen.getByText('Ligar à Maria')).toBeInTheDocument();
  });

  it('mostra empty state PT-PT quando 0 tarefas', () => {
    render(<UnscheduledSidebar tasks={[]} />);
    expect(screen.getByText(/Não tens tarefas por agendar/)).toBeInTheDocument();
  });

  it('mostra link "Ver todas (N)" se totalCount > tasks.length', () => {
    const tasks = [makeTask('t1', 'A')];
    render(<UnscheduledSidebar tasks={tasks} totalCount={75} />);
    const link = screen.getByRole('link', { name: /Ver todas \(75\)/ });
    expect(link).toHaveAttribute('href', '/tarefas?filter=sem-data');
  });
});
