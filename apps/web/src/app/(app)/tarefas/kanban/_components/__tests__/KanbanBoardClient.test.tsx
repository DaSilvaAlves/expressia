/**
 * Testes `<KanbanBoardClient>` — render board com colunas + cards, abrir modal,
 * abrir config sheet (Story 3.4 T11.1).
 *
 * NOTA: drag-and-drop scenarios reais (cross-column, intra-column, error revert)
 * requerem teste E2E ou mock-pesado do dnd-kit DndContext. Estes testes cobrem
 * render + UI interactions sem drag.
 */
import { describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: () => {}, replace: () => {} }),
  useSearchParams: () => ({
    get: () => null,
    entries: () => [].values(),
  }),
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
  CSS: {
    Transform: { toString: () => '' },
  },
}));

import { KanbanBoardClient } from '@/app/(app)/tarefas/kanban/_components/KanbanBoardClient';
import type { TaskRow } from '@/lib/api-helpers/list-tasks';
import type { KanbanColumnRow } from '@/lib/api-schemas/kanban-columns';

const COLUMNS: KanbanColumnRow[] = [
  { id: 'c1', name: 'A fazer', sort_order: 0, color: '#6B7280', is_done_column: false },
  { id: 'c2', name: 'Em curso', sort_order: 1, color: '#6B7280', is_done_column: false },
  { id: 'c3', name: 'Concluído', sort_order: 2, color: '#6B7280', is_done_column: true },
];

function makeTask(id: string, columnId: string, position: number): TaskRow {
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
    kanban_column_id: columnId,
    kanban_position: position,
    project: null,
    recurrence_id: null,
    is_recurrence_template: false,
    completed_at: null,
    created_at: '2026-05-17',
    updated_at: '2026-05-17',
  };
}

describe('<KanbanBoardClient>', () => {
  it('renders 3 colunas + cards distribuídos', () => {
    const tasks = [
      makeTask('t1', 'c1', 0),
      makeTask('t2', 'c1', 1),
      makeTask('t3', 'c2', 0),
    ];
    render(<KanbanBoardClient initialTasks={tasks} initialColumns={COLUMNS} />);
    expect(screen.getByText('A fazer')).toBeInTheDocument();
    expect(screen.getByText('Em curso')).toBeInTheDocument();
    expect(screen.getByText('Concluído')).toBeInTheDocument();
    expect(screen.getByText('Tarefa t1')).toBeInTheDocument();
    expect(screen.getByText('Tarefa t3')).toBeInTheDocument();
  });

  it('botão "Configurar colunas" abre ColumnConfigSheet', () => {
    render(<KanbanBoardClient initialTasks={[]} initialColumns={COLUMNS} />);
    fireEvent.click(screen.getByRole('button', { name: /Configurar colunas/i }));
    expect(screen.getByRole('dialog', { name: /Configurar colunas/i })).toBeInTheDocument();
  });

  it('sr-only instructions PT-PT presentes', () => {
    render(<KanbanBoardClient initialTasks={[]} initialColumns={COLUMNS} />);
    const instructions = document.getElementById('kanban-instructions');
    expect(instructions).not.toBeNull();
    expect(instructions?.textContent).toContain('Premir espaço');
    expect(instructions?.textContent).toContain('Esc para cancelar');
  });

  it('region role com aria-label "Quadro Kanban de tarefas"', () => {
    render(<KanbanBoardClient initialTasks={[]} initialColumns={COLUMNS} />);
    expect(screen.getByRole('region', { name: /Quadro Kanban/i })).toBeInTheDocument();
  });
});
