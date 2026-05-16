/**
 * Tests `<ViewTabs>` (Story 3.3 T4.1 / AC1).
 */
import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';

import { ViewTabs } from '@/app/(app)/tarefas/_components/ViewTabs';

describe('<ViewTabs>', () => {
  it('renderiza 3 tabs: Lista active link + Kanban/Calendário disabled', () => {
    render(<ViewTabs current="lista" />);
    expect(screen.getByRole('link', { name: 'Lista' })).toHaveAttribute('aria-current', 'page');
    const kanban = screen.getByRole('button', { name: 'Kanban' });
    expect(kanban).toBeDisabled();
    expect(kanban).toHaveAttribute('title', expect.stringMatching(/Em breve/));
    const calendario = screen.getByRole('button', { name: 'Calendário' });
    expect(calendario).toBeDisabled();
    expect(calendario).toHaveAttribute('title', expect.stringMatching(/Em breve/));
  });

  it('labels em PT-PT (Calendário com acento)', () => {
    render(<ViewTabs current="lista" />);
    expect(screen.getByText('Lista')).toBeInTheDocument();
    expect(screen.getByText('Kanban')).toBeInTheDocument();
    expect(screen.getByText('Calendário')).toBeInTheDocument();
  });
});
