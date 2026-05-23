/**
 * Testes para `computeInstallmentSplit` — núcleo de risco R-4.1 / R-4.10.1.
 *
 * Cenários patológicos cobertos (Story 4.10 AC8):
 *   - €1.000 / 3 →  333 + 333 + 334
 *   - €100   / 7 →  14 ×6  + 16
 *   - €1.200 / 12 → 100 × 12 (sem resto)
 *   - €333   / 3 →  111 ×3 (sem resto)
 *   - €1     / 1 →  1 (caso trivial)
 *   - N=60 com totalAmountCents grande
 *
 * Invariante crítica em TODOS os cenários:
 *   (N-1) * per + last === total
 *
 * Trace: Story 4.10 D-4.10.7 + AC4 + AC8.
 */
import { describe, expect, it } from 'vitest';

import { computeInstallmentSplit } from '../installment-split';

describe('computeInstallmentSplit — cenários canónicos', () => {
  it('€1.000 / 3 → 333 + 333 + 334 (resto na última)', () => {
    const r = computeInstallmentSplit(100_000, 3);
    expect(r.perInstallmentCents).toBe(33_333);
    expect(r.lastInstallmentCents).toBe(33_334);
    expect(r.transactionAmounts).toEqual([33_333, 33_333, 33_334]);
  });

  it('€100 / 7 → 6×1428 + 1432 (cobre divisão não-trivial)', () => {
    const r = computeInstallmentSplit(10_000, 7);
    expect(r.perInstallmentCents).toBe(1428);
    expect(r.lastInstallmentCents).toBe(10_000 - 6 * 1428);
    expect(r.transactionAmounts.length).toBe(7);
    expect(r.transactionAmounts[6]).toBe(r.lastInstallmentCents);
  });

  it('€1.200 / 12 → 100,00 × 12 (sem resto)', () => {
    const r = computeInstallmentSplit(120_000, 12);
    expect(r.perInstallmentCents).toBe(10_000);
    expect(r.lastInstallmentCents).toBe(10_000);
    expect(r.transactionAmounts).toEqual(new Array(12).fill(10_000));
  });

  it('€333 / 3 → 111 × 3 (sem resto)', () => {
    const r = computeInstallmentSplit(33_300, 3);
    expect(r.perInstallmentCents).toBe(11_100);
    expect(r.lastInstallmentCents).toBe(11_100);
    expect(r.transactionAmounts).toEqual([11_100, 11_100, 11_100]);
  });

  it('€0,01 / 1 → 1 (caso trivial)', () => {
    const r = computeInstallmentSplit(1, 1);
    expect(r.perInstallmentCents).toBe(1);
    expect(r.lastInstallmentCents).toBe(1);
    expect(r.transactionAmounts).toEqual([1]);
  });

  it('N=60 (limite do schema) com totalAmountCents grande', () => {
    const r = computeInstallmentSplit(123_457, 60);
    expect(r.transactionAmounts.length).toBe(60);
    const sum = r.transactionAmounts.reduce((a, b) => a + b, 0);
    expect(sum).toBe(123_457);
  });
});

describe('computeInstallmentSplit — invariante (N-1)*per + last === total', () => {
  const cases: ReadonlyArray<readonly [number, number]> = [
    [100_000, 3],
    [10_000, 7],
    [120_000, 12],
    [33_300, 3],
    [1, 1],
    [123_457, 60],
    [99_999, 11],
    [5, 4],
    [1_000_000_000, 60],
  ];

  for (const [total, n] of cases) {
    it(`total=${String(total)} n=${String(n)} mantém invariante`, () => {
      const r = computeInstallmentSplit(total, n);
      expect((n - 1) * r.perInstallmentCents + r.lastInstallmentCents).toBe(total);
      expect(r.transactionAmounts.reduce((a, b) => a + b, 0)).toBe(total);
    });
  }
});

describe('computeInstallmentSplit — input validation', () => {
  it('rejeita totalAmountCents = 0', () => {
    expect(() => computeInstallmentSplit(0, 3)).toThrow(/inteiro positivo/);
  });
  it('rejeita totalAmountCents negativo', () => {
    expect(() => computeInstallmentSplit(-100, 3)).toThrow(/inteiro positivo/);
  });
  it('rejeita totalAmountCents não-inteiro', () => {
    expect(() => computeInstallmentSplit(1.5, 3)).toThrow(/inteiro positivo/);
  });
  it('rejeita numInstallments = 0', () => {
    expect(() => computeInstallmentSplit(100, 0)).toThrow(/entre 1 e 60/);
  });
  it('rejeita numInstallments = 61', () => {
    expect(() => computeInstallmentSplit(100, 61)).toThrow(/entre 1 e 60/);
  });
});
