/**
 * Tests `<OnboardingTour>` (Story 6.2 AC3/AC4/AC5/AC6).
 *
 * jsdom + Testing Library. Cobre: tour de 2 passos; demo simulado (reveal sem
 * writes); navegação entre passos; "Saltar tudo" e "Começar a usar" invocam o
 * server action; identidade NÃO re-perguntada (AC5).
 */
import { render, screen, fireEvent } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { OnboardingTour } from '@/app/bem-vindo/_components/OnboardingTour';

describe('OnboardingTour', () => {
  it('arranca no Passo 1 de 2 com a demo multi-intent (AC3)', () => {
    render(<OnboardingTour completeAction={vi.fn()} />);
    expect(screen.getByText('Passo 1 de 2')).toBeInTheDocument();
    expect(screen.getByText('Escreve uma frase. Vais ver.')).toBeInTheDocument();
    // O preview só aparece após carregar — começa escondido.
    expect(screen.queryByText(/Tarefa criada:/)).not.toBeInTheDocument();
  });

  it('"Mostrar o que acontece" revela o preview canned (AC3 — sem writes/LLM)', () => {
    render(<OnboardingTour completeAction={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: 'Mostrar o que acontece' }));
    expect(screen.getByText(/Tarefa criada:/)).toBeInTheDocument();
    expect(screen.getByText(/Despesa registada:/)).toBeInTheDocument();
    expect(screen.getByText(/Recorrente criada:/)).toBeInTheDocument();
  });

  it('"Continuar" avança para o Passo 2 (trial, Família €8,88) (AC4)', () => {
    render(<OnboardingTour completeAction={vi.fn()} />);
    fireEvent.click(screen.getByRole('button', { name: 'Continuar →' }));
    expect(screen.getByText('Passo 2 de 2')).toBeInTheDocument();
    expect(screen.getByText('Tens 14 dias grátis.')).toBeInTheDocument();
    expect(screen.getByText(/Família €8,88\/mês/)).toBeInTheDocument();
    expect(
      screen.getByText(/Só te avisamos no dia 12 por email. Sem surpresas./),
    ).toBeInTheDocument();
  });

  it('NÃO pergunta nome nem nome do agregado (AC5 — DP-6.2.2=A)', () => {
    render(<OnboardingTour completeAction={vi.fn()} />);
    // Nenhum input de texto no tour (Passo 1 do spec superado).
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
    expect(screen.queryByText(/Como te chamamos/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/nome do teu agregado/i)).not.toBeInTheDocument();
  });

  it('"Saltar tudo" invoca completeAction (FR31 — AC6)', () => {
    const completeAction = vi.fn().mockResolvedValue(undefined);
    render(<OnboardingTour completeAction={completeAction} />);
    fireEvent.click(screen.getByRole('button', { name: 'Saltar tudo' }));
    expect(completeAction).toHaveBeenCalledTimes(1);
  });

  it('"Começar a usar" (Passo 2) invoca completeAction (AC7)', () => {
    const completeAction = vi.fn().mockResolvedValue(undefined);
    render(<OnboardingTour completeAction={completeAction} />);
    fireEvent.click(screen.getByRole('button', { name: 'Continuar →' }));
    fireEvent.click(screen.getByRole('button', { name: 'Começar a usar' }));
    expect(completeAction).toHaveBeenCalledTimes(1);
  });

  it('progressbar reflecte o passo actual', () => {
    render(<OnboardingTour completeAction={vi.fn()} />);
    const bar = screen.getByRole('progressbar');
    expect(bar).toHaveAttribute('aria-valuenow', '50');
    fireEvent.click(screen.getByRole('button', { name: 'Continuar →' }));
    expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '100');
  });
});
