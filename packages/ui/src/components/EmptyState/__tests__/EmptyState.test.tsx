/**
 * Testes — `<EmptyState>` (Story 5.9 AC4).
 *
 * 4 variantes com defaults PT-PT + override por props explícitas + sem CTA +
 * ilustração. Cobertura ≥ 70% do componente (NFR16).
 */
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { EmptyState } from '../EmptyState';

describe('<EmptyState> — variantes com defaults PT-PT', () => {
  it('variant=visao → título/body/CTA "Abrir o chat" → /jarvis', () => {
    render(<EmptyState variant="visao" />);
    expect(screen.getByText('Ainda não há nada para mostrar.')).toBeInTheDocument();
    expect(
      screen.getByText('Carrega no chat e diz "criar tarefa de comprar pão amanhã" para começar.'),
    ).toBeInTheDocument();
    const cta = screen.getByText('Abrir o chat');
    expect(cta).toHaveAttribute('href', '/jarvis');
  });

  it('variant=tarefas → título "Sem tarefas para mostrar." + CTA', () => {
    render(<EmptyState variant="tarefas" />);
    expect(screen.getByText('Sem tarefas para mostrar.')).toBeInTheDocument();
    expect(screen.getByText('Abrir o chat')).toHaveAttribute('href', '/jarvis');
  });

  it('variant=financas → título "Sem movimentos registados." + CTA', () => {
    render(<EmptyState variant="financas" />);
    expect(screen.getByText('Sem movimentos registados.')).toBeInTheDocument();
    expect(screen.getByText('Abrir o chat')).toHaveAttribute('href', '/jarvis');
  });

  it('variant=chat → título "Olá. Em que posso ajudar?" SEM CTA', () => {
    const { container } = render(<EmptyState variant="chat" />);
    expect(screen.getByText('Olá. Em que posso ajudar?')).toBeInTheDocument();
    expect(screen.getByText('Escreve uma mensagem para começar.')).toBeInTheDocument();
    expect(container.querySelector('a')).toBeNull();
  });
});

describe('<EmptyState> — props explícitas', () => {
  it('título/body/cta explícitos sobrepõem os defaults', () => {
    render(
      <EmptyState
        title="Título à medida"
        body="Corpo à medida"
        cta={{ label: 'Ir para X', href: '/x' }}
      />,
    );
    expect(screen.getByText('Título à medida')).toBeInTheDocument();
    expect(screen.getByText('Corpo à medida')).toBeInTheDocument();
    expect(screen.getByText('Ir para X')).toHaveAttribute('href', '/x');
  });

  it('override de título sobre a variante mantém o resto da variante', () => {
    render(<EmptyState variant="visao" title="Override" />);
    expect(screen.getByText('Override')).toBeInTheDocument();
    // body continua o default da variante visao
    expect(
      screen.getByText('Carrega no chat e diz "criar tarefa de comprar pão amanhã" para começar.'),
    ).toBeInTheDocument();
  });

  it('sem variant e sem cta → não renderiza botão', () => {
    const { container } = render(<EmptyState title="Só título" body="Só corpo" />);
    expect(container.querySelector('a')).toBeNull();
  });
});

describe('<EmptyState> — ilustração', () => {
  it('renderiza a ilustração quando fornecida', () => {
    render(
      <EmptyState
        variant="chat"
        illustration={<svg data-testid="ilustracao" aria-hidden="true" />}
      />,
    );
    expect(screen.getByTestId('ilustracao')).toBeInTheDocument();
  });

  it('sem ilustração → não renderiza nenhum svg', () => {
    const { container } = render(<EmptyState variant="chat" />);
    expect(container.querySelector('svg')).toBeNull();
  });
});
