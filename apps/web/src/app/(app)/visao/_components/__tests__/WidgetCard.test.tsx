/**
 * Tests — `<WidgetCard>` (Story 5.6 AC5, AC9).
 *
 * Render do título (`<h2>`), conteúdo e rodapé condicional (link `"… →"`).
 */
import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';

import { WidgetCard } from '@/app/(app)/visao/_components/WidgetCard';

describe('<WidgetCard>', () => {
  it('renderiza título como heading semântico e o conteúdo', () => {
    render(
      <WidgetCard title="Tarefas hoje">
        <p>conteúdo do widget</p>
      </WidgetCard>,
    );
    expect(screen.getByRole('heading', { name: 'Tarefas hoje' })).toBeInTheDocument();
    expect(screen.getByText('conteúdo do widget')).toBeInTheDocument();
  });

  it('renderiza o rodapé com link "label →" para o href correcto', () => {
    render(
      <WidgetCard title="Gastos do mês" footer={{ label: 'Ver mês', href: '/financas/este-mes' }}>
        <p>x</p>
      </WidgetCard>,
    );
    const link = screen.getByRole('link', { name: /ver mês/i });
    expect(link).toHaveAttribute('href', '/financas/este-mes');
  });

  it('sem footer → não renderiza nenhum link', () => {
    render(
      <WidgetCard title="Briefing diário">
        <p>x</p>
      </WidgetCard>,
    );
    expect(screen.queryByRole('link')).toBeNull();
  });
});
