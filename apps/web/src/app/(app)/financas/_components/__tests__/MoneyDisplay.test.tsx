/**
 * Tests — `<MoneyDisplay>` + `formatEuroCents` (Story 4.6 AC9, AC2).
 *
 * Formatação PT-PT: símbolo `€` à esquerda, vírgula decimal (D-4.6.9).
 * Os casos sem milhares (`€123,45`, `€0,00`) evitam ambiguidade do separador
 * de grupo entre versões de ICU.
 */
import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';

import { MoneyDisplay, formatEuroCents } from '@/app/(app)/financas/_components/MoneyDisplay';

describe('formatEuroCents', () => {
  it('formata cêntimos como €X,XX PT-PT', () => {
    expect(formatEuroCents(12345)).toBe('€123,45');
  });

  it('zero → €0,00', () => {
    expect(formatEuroCents(0)).toBe('€0,00');
  });

  it('usa o valor absoluto — o sinal é responsabilidade do tone', () => {
    expect(formatEuroCents(-5000)).toBe('€50,00');
  });
});

describe('<MoneyDisplay>', () => {
  it('renderiza cêntimos formatados (tone neutral — sem prefixo)', () => {
    render(<MoneyDisplay cents={12345} />);
    expect(screen.getByText('€123,45')).toBeInTheDocument();
  });

  it('tone=expense → prefixo − e cor vermelha', () => {
    const { container } = render(<MoneyDisplay cents={12345} tone="expense" />);
    const span = container.querySelector('span');
    expect(span?.textContent).toBe('−€123,45');
    expect(span?.className).toContain('text-red-600');
  });

  it('tone=income → prefixo + e cor verde', () => {
    const { container } = render(<MoneyDisplay cents={12345} tone="income" />);
    const span = container.querySelector('span');
    expect(span?.textContent).toBe('+€123,45');
    expect(span?.className).toContain('text-green-600');
  });

  it('cents 0 → €0,00', () => {
    render(<MoneyDisplay cents={0} />);
    expect(screen.getByText('€0,00')).toBeInTheDocument();
  });
});

describe('<MoneyDisplay tone="signed"> (Story 4.9 D-4.9.8 — saldos com sinal)', () => {
  it('negativo → prefixo − + cor vermelha (descoberto)', () => {
    const { container } = render(<MoneyDisplay cents={-5000} tone="signed" />);
    const span = container.querySelector('span');
    expect(span?.textContent).toBe('−€50,00');
    expect(span?.className).toContain('text-red-600');
  });

  it('positivo → SEM prefixo, cor neutra (nunca renderiza "+")', () => {
    // Valor < 1000 EUR para evitar ambiguidade do separador de milhar entre versões de ICU
    // (mesma cautela dos testes predecessores neste ficheiro).
    const { container } = render(<MoneyDisplay cents={12345} tone="signed" />);
    const span = container.querySelector('span');
    expect(span?.textContent).toBe('€123,45');
    expect(span?.className).not.toContain('text-red');
    expect(span?.className).not.toContain('text-green');
  });

  it('zero → €0,00 sem prefixo nem cor', () => {
    const { container } = render(<MoneyDisplay cents={0} tone="signed" />);
    const span = container.querySelector('span');
    expect(span?.textContent).toBe('€0,00');
    expect(span?.className).not.toContain('text-red');
    expect(span?.className).not.toContain('text-green');
  });
});
