/**
 * Tests `<DayColumn>` + `sortTasksForDay` (Story 3.5 T11.2 + G3.1 Aria).
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

import { DayColumn, sortTasksForDay } from '@/app/(app)/tarefas/calendario/_components/DayColumn';
import type { TaskRow } from '@/lib/api-helpers/list-tasks';

function makeTask(overrides: Partial<TaskRow> = {}): TaskRow {
  return {
    id: overrides.id ?? 't1',
    household_id: 'h1',
    created_by_user_id: 'u1',
    assigned_to_user_id: null,
    title: overrides.title ?? 'Tarefa',
    description: null,
    due_date: overrides.due_date ?? '2026-05-15',
    due_time: null,
    priority: overrides.priority ?? 'medium',
    status: overrides.status ?? 'todo',
    kanban_column_id: null,
    kanban_position: 0,
    project: null,
    recurrence_id: null,
    is_recurrence_template: false,
    completed_at: null,
    created_at: overrides.created_at ?? '2026-05-01T10:00:00Z',
    updated_at: '2026-05-01T10:00:00Z',
    tags: [],
    ...overrides,
  };
}

describe('sortTasksForDay', () => {
  it('ordena por priority desc (high > medium > low)', () => {
    const tasks = [
      makeTask({ id: 'a', priority: 'low' }),
      makeTask({ id: 'b', priority: 'high' }),
      makeTask({ id: 'c', priority: 'medium' }),
    ];
    expect(sortTasksForDay(tasks).map((t) => t.id)).toEqual(['b', 'c', 'a']);
  });

  it('desempate por created_at asc (mais antigas no topo)', () => {
    const tasks = [
      makeTask({ id: 'a', priority: 'medium', created_at: '2026-05-03T10:00:00Z' }),
      makeTask({ id: 'b', priority: 'medium', created_at: '2026-05-01T10:00:00Z' }),
      makeTask({ id: 'c', priority: 'medium', created_at: '2026-05-02T10:00:00Z' }),
    ];
    expect(sortTasksForDay(tasks).map((t) => t.id)).toEqual(['b', 'c', 'a']);
  });
});

describe('<DayColumn>', () => {
  it('renderiza header PT-PT (Seg + 14 Mai)', () => {
    const monday = new Date(2026, 4, 11); // 2026-05-11 Mon
    render(<DayColumn date={monday} dayIso="2026-05-11" tasks={[]} />);
    expect(screen.getByText('Seg')).toBeInTheDocument();
    expect(screen.getByText('11 Mai')).toBeInTheDocument();
  });

  it('agrupa tarefas pelo due_date (passadas como prop)', () => {
    const day = new Date(2026, 4, 15);
    const tasks = [
      makeTask({ id: 't1', title: 'A', due_date: '2026-05-15' }),
      makeTask({ id: 't2', title: 'B', due_date: '2026-05-15' }),
    ];
    render(<DayColumn date={day} dayIso="2026-05-15" tasks={tasks} />);
    expect(screen.getByText('A')).toBeInTheDocument();
    expect(screen.getByText('B')).toBeInTheDocument();
  });

  it('mostra empty placeholder "—" quando 0 tarefas', () => {
    const day = new Date(2026, 4, 15);
    render(<DayColumn date={day} dayIso="2026-05-15" tasks={[]} />);
    expect(screen.getByText('—')).toBeInTheDocument();
  });

  it('section role=region com aria-label que inclui dia + mês', () => {
    const day = new Date(2026, 4, 15);
    render(<DayColumn date={day} dayIso="2026-05-15" tasks={[]} />);
    const region = screen.getByRole('region', { name: /Sex 15 Mai/ });
    expect(region).toBeInTheDocument();
  });
});
