/**
 * Testes `<KanbanCard>` — render + click → onOpen + overdue style (Story 3.4 T11.3).
 *
 * NOTA: dnd-kit useSortable hook é mockado para evitar precisar de DndContext
 * provider em todos os testes. O comportamento de drag em si é testado em
 * KanbanBoardClient.test.tsx via testing-library/user-event + mock dnd-kit
 * minimal.
 */
import { describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

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
    Transform: { toString: () => '' },
  },
}));

import { KanbanCard } from '@/app/(app)/tarefas/kanban/_components/KanbanCard';

describe('<KanbanCard>', () => {
  it('renders title + due_date formatado PT-PT', () => {
    render(
      <ul>
        <KanbanCard
          taskId="t1"
          title="Pagar IRS"
          dueDate="2026-05-16"
          priority="high"
          status="todo"
          isOverdue={false}
          tags={[]}
          onOpen={() => {}}
        />
      </ul>,
    );
    expect(screen.getByText('Pagar IRS')).toBeInTheDocument();
    expect(screen.getByText(/16\/05/)).toBeInTheDocument();
  });

  it('click body chama onOpen', () => {
    const onOpen = vi.fn();
    render(
      <ul>
        <KanbanCard
          taskId="t1"
          title="Test"
          dueDate={null}
          priority="medium"
          status="todo"
          isOverdue={false}
          tags={[]}
          onOpen={onOpen}
        />
      </ul>,
    );
    fireEvent.click(screen.getByText('Test'));
    expect(onOpen).toHaveBeenCalledTimes(1);
  });

  it('Enter key abre EditTaskModal (chama onOpen)', () => {
    const onOpen = vi.fn();
    render(
      <ul>
        <KanbanCard
          taskId="t1"
          title="Test"
          dueDate={null}
          priority="low"
          status="todo"
          isOverdue={false}
          tags={[]}
          onOpen={onOpen}
        />
      </ul>,
    );
    const card = screen.getByRole('listitem');
    fireEvent.keyDown(card, { key: 'Enter' });
    expect(onOpen).toHaveBeenCalledTimes(1);
  });

  it('overdue task tem aria-label com ", atrasada"', () => {
    render(
      <ul>
        <KanbanCard
          taskId="t1"
          title="Atrasada"
          dueDate="2026-05-01"
          priority="high"
          status="todo"
          isOverdue={true}
          tags={[]}
          onOpen={() => {}}
        />
      </ul>,
    );
    const card = screen.getByRole('listitem');
    expect(card.getAttribute('aria-label')).toContain('atrasada');
  });

  it('renderiza tag badges quando tags presentes', () => {
    render(
      <ul>
        <KanbanCard
          taskId="t1"
          title="Com tags"
          dueDate={null}
          priority="low"
          status="todo"
          isOverdue={false}
          tags={[
            { id: 'tag1', name: 'trabalho', color: '#3B82F6' },
            { id: 'tag2', name: 'urgente', color: '#EF4444' },
            { id: 'tag3', name: 'extra', color: '#22C55E' },
          ]}
          onOpen={() => {}}
        />
      </ul>,
    );
    expect(screen.getByText('trabalho')).toBeInTheDocument();
    expect(screen.getByText('urgente')).toBeInTheDocument();
    // 3 tags > limit 2 → chip +1
    expect(screen.getByText('+1')).toBeInTheDocument();
  });

  it('completed task tem aria-label com ", concluída"', () => {
    render(
      <ul>
        <KanbanCard
          taskId="t1"
          title="Done"
          dueDate={null}
          priority="low"
          status="done"
          isOverdue={false}
          tags={[]}
          onOpen={() => {}}
        />
      </ul>,
    );
    const card = screen.getByRole('listitem');
    expect(card.getAttribute('aria-label')).toContain('concluída');
  });
});
