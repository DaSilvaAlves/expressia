/**
 * Tests `<ViewTabs>` (Story 3.3 T4.1 / AC1 + Story 3.4 T4.4 + Story 3.5 T2.4).
 *
 * Story 3.5 v1.3: Calendário deixa de ser button disabled — agora é Link activo.
 */
import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';

import { ViewTabs } from '@/app/(app)/tarefas/_components/ViewTabs';

describe('<ViewTabs>', () => {
  it('renderiza 3 tabs activos: Lista, Kanban, Calendário', () => {
    render(<ViewTabs current="lista" />);
    const lista = screen.getByRole('link', { name: 'Lista' });
    expect(lista).toHaveAttribute('aria-current', 'page');
    expect(lista).toHaveAttribute('href', '/tarefas');

    const kanban = screen.getByRole('link', { name: 'Kanban' });
    expect(kanban).toHaveAttribute('href', '/tarefas/kanban');
    expect(kanban).not.toHaveAttribute('aria-current');

    const calendario = screen.getByRole('link', { name: 'Calendário' });
    expect(calendario).toHaveAttribute('href', '/tarefas/calendario');
    expect(calendario).not.toHaveAttribute('aria-current');
  });

  it('marca tab Kanban como active quando current="kanban"', () => {
    render(<ViewTabs current="kanban" />);
    expect(screen.getByRole('link', { name: 'Kanban' })).toHaveAttribute('aria-current', 'page');
    expect(screen.getByRole('link', { name: 'Lista' })).not.toHaveAttribute('aria-current');
    expect(screen.getByRole('link', { name: 'Calendário' })).not.toHaveAttribute('aria-current');
  });

  it('marca tab Calendário como active quando current="calendario"', () => {
    render(<ViewTabs current="calendario" />);
    expect(screen.getByRole('link', { name: 'Calendário' })).toHaveAttribute('aria-current', 'page');
    expect(screen.getByRole('link', { name: 'Lista' })).not.toHaveAttribute('aria-current');
    expect(screen.getByRole('link', { name: 'Kanban' })).not.toHaveAttribute('aria-current');
  });

  it('labels em PT-PT (Calendário com acento)', () => {
    render(<ViewTabs current="lista" />);
    expect(screen.getByText('Lista')).toBeInTheDocument();
    expect(screen.getByText('Kanban')).toBeInTheDocument();
    expect(screen.getByText('Calendário')).toBeInTheDocument();
  });
});
