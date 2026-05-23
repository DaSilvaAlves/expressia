/**
 * Testes para `formatEuroCents` — formato EUR PT-PT (CON9).
 *
 * Trace: Story 4.10 AC1-AC4 + CON9.
 */
import { describe, expect, it } from 'vitest';

import { formatEuroCents } from '../format-euro-cents';

describe('formatEuroCents — formato PT-PT vírgula decimal (CON9)', () => {
  it('0 → "€0,00"', () => {
    expect(formatEuroCents(0)).toBe('€0,00');
  });

  it('870 → "€8,70"', () => {
    expect(formatEuroCents(870)).toBe('€8,70');
  });

  it('7870 → "€78,70"', () => {
    expect(formatEuroCents(7870)).toBe('€78,70');
  });

  it('100 → "€1,00"', () => {
    expect(formatEuroCents(100)).toBe('€1,00');
  });

  it('5 → "€0,05" (single-digit cents padded)', () => {
    expect(formatEuroCents(5)).toBe('€0,05');
  });

  it('120000 → "€1200,00"', () => {
    expect(formatEuroCents(120_000)).toBe('€1200,00');
  });

  it('-500 → "-€5,00" (negativo prefixa sinal)', () => {
    expect(formatEuroCents(-500)).toBe('-€5,00');
  });

  it('rejeita não-inteiro', () => {
    expect(() => formatEuroCents(1.5)).toThrow(/inteiro/);
  });
});
