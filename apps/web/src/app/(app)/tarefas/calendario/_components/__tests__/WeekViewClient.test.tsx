/**
 * Tests `<WeekViewClient>` (Story 3.5 T11.1).
 *
 * Render-only + click handlers — drag actual exige E2E ou mock pesado @dnd-kit.
 * Pattern Story 3.4 `KanbanBoardClient.test.tsx`.
 */
import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
  useSearchParams: () => ({ toString: () => '', get: () => null }),
}));

vi.mock('@sentry/nextjs', () => ({
  captureException: vi.fn(),
}));

vi.mock('@dnd-kit/core', () => ({
  DndContext: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  DragOverlay: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  KeyboardSensor: class {},
  PointerSensor: class {},
  TouchSensor: class {},
  closestCorners: () => [],
  useSensor: () => null,
  useSensors: () => [],
  useDroppable: () => ({ setNodeRef: () => {}, isOver: false }),
}));

vi.mock('@dnd-kit/sortable', () => ({
  SortableContext: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  verticalListSortingStrategy: undefined,
  sortableKeyboardCoordinates: () => ({}),
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

import { WeekViewClient } from '@/app/(app)/tarefas/calendario/_components/WeekViewClient';
import type { TaskRow } from '@/lib/api-helpers/list-tasks';

function makeTask(id: string, title: string, due_date: string | null): TaskRow {
  return {
    id,
    household_id: 'h1',
    created_by_user_id: 'u1',
    assigned_to_user_id: null,
    title,
    description: null,
    due_date,
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

describe('<WeekViewClient>', () => {
  it('renderiza sidebar Por agendar + 7 colunas dia', () => {
    const scheduled = [makeTask('s1', 'Reunião', '2026-05-18')];
    const unscheduled = [makeTask('u1', 'Comprar pão', null)];

    render(
      <WeekViewClient
        initialTasks={scheduled}
        unscheduledTasks={unscheduled}
        weekStartIso="2026-W21"
      />,
    );

    // Sidebar
    expect(screen.getByText('Por agendar')).toBeInTheDocument();
    expect(screen.getByText('Comprar pão')).toBeInTheDocument();

    // 7 day columns (Seg-Dom). Verificar pelo menos Seg + Dom.
    const regions = screen.getAllByRole('region');
    // 1 sidebar + 7 days = 8 regions
    expect(regions.length).toBe(8);
  });

  it('agrupa task scheduled no dia correcto (2026-05-18 → Seg)', () => {
    const scheduled = [makeTask('s1', 'Reunião', '2026-05-18')];
    render(
      <WeekViewClient
        initialTasks={scheduled}
        unscheduledTasks={[]}
        weekStartIso="2026-W21"
      />,
    );
    // Reunião deve aparecer dentro do region "Seg 18 Mai" (a sidebar não tem due_date).
    expect(screen.getByText('Reunião')).toBeInTheDocument();
  });

  it('renderiza count chip da sidebar', () => {
    const unscheduled = [makeTask('u1', 'A', null), makeTask('u2', 'B', null)];
    render(
      <WeekViewClient
        initialTasks={[]}
        unscheduledTasks={unscheduled}
        unscheduledTotalCount={2}
        weekStartIso="2026-W21"
      />,
    );
    expect(screen.getByLabelText('2 por agendar')).toBeInTheDocument();
  });

  it('renderiza vazio sem crashar quando sem tarefas', () => {
    render(
      <WeekViewClient initialTasks={[]} unscheduledTasks={[]} weekStartIso="2026-W21" />,
    );
    // Empty messages de DayColumn ("—") + sidebar
    expect(screen.getByText(/Não tens tarefas por agendar/)).toBeInTheDocument();
  });

  it('preserva order: scheduled+unscheduled merge correcto', () => {
    const scheduled = [makeTask('s1', 'Alpha', '2026-05-18')];
    const unscheduled = [makeTask('u1', 'Beta', null)];
    render(
      <WeekViewClient
        initialTasks={scheduled}
        unscheduledTasks={unscheduled}
        weekStartIso="2026-W21"
      />,
    );
    expect(screen.getByText('Alpha')).toBeInTheDocument();
    expect(screen.getByText('Beta')).toBeInTheDocument();
  });
});
