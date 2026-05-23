/**
 * Tests — `<AccountBalanceCard>` (Story 4.9 AC4, AC5, AC7).
 *
 * Render do saldo + entradas/saídas; link "Ver movimentos" com `account_id`
 * correcto; tipo de conta em PT-PT.
 */
import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';

import type { AccountBalance } from '@/lib/finance/account-balances';
import { AccountBalanceCard } from '@/app/(app)/financas/_components/AccountBalanceCard';

function makeAccount(overrides: Partial<AccountBalance> = {}): AccountBalance {
  // Valores < 1000 EUR (< 100000 cents) para evitar ambiguidade do separador de
  // milhar entre versões de ICU (mesma cautela dos testes do `MoneyDisplay`).
  return {
    id: 'acc-1',
    name: 'Conta Principal',
    accountType: 'corrente',
    bankName: 'Millennium BCP',
    ibanLast4: '1234',
    initialBalanceCents: 10000,
    incomeCents: 5000,
    expenseCents: 2000,
    balanceCents: 13000,
    ...overrides,
  };
}

describe('<AccountBalanceCard>', () => {
  it('renderiza nome, saldo, entradas, saídas, tipo de conta PT-PT e iban_last4 mascarado', () => {
    render(<AccountBalanceCard account={makeAccount()} />);
    expect(screen.getByText('Conta Principal')).toBeInTheDocument();
    expect(screen.getByText('Conta corrente')).toBeInTheDocument();
    expect(screen.getByText('••••1234')).toBeInTheDocument();
    // saldo: 130,00 € — modo signed positivo (sem prefixo)
    expect(screen.getByText('€130,00')).toBeInTheDocument();
    // entradas: +€50,00 (tone income); saídas: −€20,00 (tone expense)
    expect(screen.getByText('+€50,00')).toBeInTheDocument();
    expect(screen.getByText('−€20,00')).toBeInTheDocument();
  });

  it('link "Ver movimentos" navega para /financas/variaveis?account_id=<id>', () => {
    render(<AccountBalanceCard account={makeAccount({ id: 'acc-xyz' })} />);
    const link = screen.getByRole('link', { name: /ver movimentos/i });
    expect(link).toHaveAttribute('href', '/financas/variaveis?account_id=acc-xyz');
  });

  it('saldo negativo renderiza com sinal − e cor vermelha (D-4.9.8); conta sem iban_last4 não mostra ••••', () => {
    const { container } = render(
      <AccountBalanceCard
        account={makeAccount({
          balanceCents: -5000,
          ibanLast4: null,
          accountType: 'dinheiro',
        })}
      />,
    );
    expect(screen.getByText('−€50,00')).toBeInTheDocument();
    expect(screen.getByText('Dinheiro')).toBeInTheDocument();
    expect(container.querySelector('.font-mono')).toBeNull();
  });
});
