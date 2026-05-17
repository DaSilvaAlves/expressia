/**
 * Tests `<ViewTabs>` (Story 3.3 T4.1 / AC1 + Story 3.4 T4.4 — Kanban tab activo).
 */
import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';

import { ViewTabs } from '@/app/(app)/tarefas/_components/ViewTabs';

describe('<ViewTabs>', () => {
  it('renderiza 3 tabs: Lista active link + Kanban link + Calendário disabled', () => {
    render(<ViewTabs current="lista" />);
    expect(screen.getByRole('link', { name: 'Lista' })).toHaveAttribute('aria-current', 'page');
    // Story 3.4 T4.4: Kanban deixa de ser disabled — agora é Link activo.
    const kanban = screen.getByRole('link', { name: 'Kanban' });
    expect(kanban).toHaveAttribute('href', '/tarefas/kanban');
    expect(kanban).not.toHaveAttribute('aria-current');
    const calendario = screen.getByRole('button', { name: 'Calendário' });
    expect(calendario).toBeDisabled();
    expect(calendario).toHaveAttribute('title', expect.stringMatching(/Em breve/));
  });

  it('marca tab Kanban como active quando current="kanban"', () => {
    render(<ViewTabs current="kanban" />);
    expect(screen.getByRole('link', { name: 'Kanban' })).toHaveAttribute('aria-current', 'page');
    expect(screen.getByRole('link', { name: 'Lista' })).not.toHaveAttribute('aria-current');
  });

  it('labels em PT-PT (Calendário com acento)', () => {
    render(<ViewTabs current="lista" />);
    expect(screen.getByText('Lista')).toBeInTheDocument();
    expect(screen.getByText('Kanban')).toBeInTheDocument();
    expect(screen.getByText('Calendário')).toBeInTheDocument();
  });
});
