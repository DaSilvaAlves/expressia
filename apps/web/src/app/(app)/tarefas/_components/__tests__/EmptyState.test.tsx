/**
 * Tests `<EmptyState>` (Story 3.3 T8.1 / AC9).
 */
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';

import { EmptyState } from '@/app/(app)/tarefas/_components/EmptyState';

const pushMock = vi.fn();
const refreshMock = vi.fn();

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: pushMock, refresh: refreshMock }),
}));

describe('<EmptyState>', () => {
  it('variant no-tasks mostra mensagem PT-PT + 2 CTAs', () => {
    render(<EmptyState variant="no-tasks" />);
    expect(screen.getByText(/Ainda não tens tarefas/i)).toBeInTheDocument();
    expect(screen.getByText('Falar com o Jarvis')).toBeInTheDocument();
    expect(screen.getByText('+ Criar primeira tarefa')).toBeDisabled();
  });

  it('variant filtered-empty oferece botão Limpar filtros', () => {
    pushMock.mockReset();
    render(<EmptyState variant="filtered-empty" />);
    expect(screen.getByText(/Sem tarefas com este filtro/i)).toBeInTheDocument();
    fireEvent.click(screen.getByText('Limpar filtros'));
    expect(pushMock).toHaveBeenCalledWith('/tarefas');
  });

  it('variant error mostra alert + botão Tentar novamente que chama router.refresh', () => {
    refreshMock.mockReset();
    render(<EmptyState variant="error" />);
    expect(screen.getByRole('alert')).toHaveTextContent(/Não foi possível carregar as tarefas/i);
    fireEvent.click(screen.getByText('Tentar novamente'));
    expect(refreshMock).toHaveBeenCalled();
  });
});
