/**
 * Testes `<KanbanColumn>` — render name + count, empty state, "Ver mais N" footer
 * (Story 3.4 T11.2).
 */
import { describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

vi.mock('@dnd-kit/core', () => ({
  useDroppable: () => ({
    setNodeRef: () => {},
    isOver: false,
  }),
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
  CSS: {
    Transform: { toString: () => '' },
  },
}));

vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: () => {} }),
}));

import { KanbanColumn } from '@/app/(app)/tarefas/kanban/_components/KanbanColumn';
import type { TaskRow } from '@/lib/api-helpers/list-tasks';
import type { KanbanColumnRow } from '@/lib/api-schemas/kanban-columns';

const COLUMN: KanbanColumnRow = {
  id: 'col1',
  name: 'A fazer',
  sort_order: 0,
  color: '#6B7280',
  is_done_column: false,
};

function makeTask(id: string, position: number, overrides: Partial<TaskRow> = {}): TaskRow {
  return {
    id,
    household_id: 'h1',
    created_by_user_id: 'u1',
    assigned_to_user_id: null,
    title: `Task ${id}`,
    description: null,
    due_date: null,
    due_time: null,
    priority: 'medium',
    status: 'todo',
    kanban_column_id: 'col1',
    kanban_position: position,
    project: null,
    recurrence_id: null,
    is_recurrence_template: false,
    completed_at: null,
    created_at: '2026-05-17',
    updated_at: '2026-05-17',
    ...overrides,
  };
}

describe('<KanbanColumn>', () => {
  it('renders column name + count em header', () => {
    const tasks = [makeTask('t1', 0), makeTask('t2', 1), makeTask('t3', 2)];
    render(<KanbanColumn column={COLUMN} tasks={tasks} onOpenTask={() => {}} />);
    expect(screen.getByText('A fazer')).toBeInTheDocument();
    expect(screen.getByText('3')).toBeInTheDocument();
  });

  it('coluna vazia mostra "Sem tarefas. Adiciona uma."', () => {
    render(<KanbanColumn column={COLUMN} tasks={[]} onOpenTask={() => {}} />);
    expect(screen.getByText(/Sem tarefas/)).toBeInTheDocument();
  });

  it('label de coluna inclui contagem para screen readers', () => {
    const tasks = [makeTask('t1', 0), makeTask('t2', 1)];
    render(<KanbanColumn column={COLUMN} tasks={tasks} onOpenTask={() => {}} />);
    expect(screen.getByLabelText('A fazer, 2 tarefas')).toBeInTheDocument();
  });

  it('> 50 cards mostra footer "Ver mais N →"', () => {
    const tasks = Array.from({ length: 75 }, (_, i) => makeTask(`t${i}`, i));
    render(<KanbanColumn column={COLUMN} tasks={tasks} onOpenTask={() => {}} />);
    expect(screen.getByText(/Ver mais 25 →/)).toBeInTheDocument();
  });

  it('clicar em "Ver mais N →" incrementa visibleCount chunk size 25', () => {
    const tasks = Array.from({ length: 100 }, (_, i) => makeTask(`t${i}`, i));
    render(<KanbanColumn column={COLUMN} tasks={tasks} onOpenTask={() => {}} />);
    expect(screen.getByText(/Ver mais 50 →/)).toBeInTheDocument();
    fireEvent.click(screen.getByText(/Ver mais 50/));
    expect(screen.getByText(/Ver mais 25 →/)).toBeInTheDocument();
  });
});
