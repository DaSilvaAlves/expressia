/**
 * Tests — `<VisaoEmptyState>` (Story 5.6 AC7, AC9).
 *
 * Copy PT-PT exacta + CTA "Abrir o chat" → `/jarvis`.
 */
import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';

import { VisaoEmptyState } from '@/app/(app)/visao/_components/VisaoEmptyState';

describe('<VisaoEmptyState>', () => {
  it('renderiza a copy PT-PT do front-end-spec', () => {
    render(<VisaoEmptyState />);
    expect(screen.getByText('Ainda não há nada para mostrar.')).toBeInTheDocument();
    expect(screen.getByText(/criar tarefa de comprar pão amanhã/i)).toBeInTheDocument();
  });

  it('CTA "Abrir o chat" aponta para /jarvis', () => {
    render(<VisaoEmptyState />);
    const cta = screen.getByRole('link', { name: /abrir o chat/i });
    expect(cta).toHaveAttribute('href', '/jarvis');
  });
});
