/**
 * Testes para `computeMonthBounds` — primeiro/último dia do mês.
 *
 * Trace: Story 4.10 PO_FIX_INLINE F5 + AC5 + Task T2.5.
 */
import { describe, expect, it } from 'vitest';

import { computeMonthBounds } from '../month-bounds';

describe('computeMonthBounds — meses regulares', () => {
  it('"2026-05-23" → {2026-05-01, 2026-05-31}', () => {
    expect(computeMonthBounds('2026-05-23')).toEqual({
      monthStart: '2026-05-01',
      monthEnd: '2026-05-31',
    });
  });

  it('"2026-04-15" → {2026-04-01, 2026-04-30} (30 dias)', () => {
    expect(computeMonthBounds('2026-04-15')).toEqual({
      monthStart: '2026-04-01',
      monthEnd: '2026-04-30',
    });
  });

  it('"2026-12-01" → {2026-12-01, 2026-12-31}', () => {
    expect(computeMonthBounds('2026-12-01')).toEqual({
      monthStart: '2026-12-01',
      monthEnd: '2026-12-31',
    });
  });

  it('"2026-12-31" → {2026-12-01, 2026-12-31}', () => {
    expect(computeMonthBounds('2026-12-31')).toEqual({
      monthStart: '2026-12-01',
      monthEnd: '2026-12-31',
    });
  });
});

describe('computeMonthBounds — Fevereiro / leap years', () => {
  it('"2026-02-15" → {2026-02-01, 2026-02-28} (não-bissexto)', () => {
    expect(computeMonthBounds('2026-02-15')).toEqual({
      monthStart: '2026-02-01',
      monthEnd: '2026-02-28',
    });
  });

  it('"2024-02-15" → {2024-02-01, 2024-02-29} (bissexto)', () => {
    expect(computeMonthBounds('2024-02-15')).toEqual({
      monthStart: '2024-02-01',
      monthEnd: '2024-02-29',
    });
  });

  it('"2000-02-15" → {2000-02-01, 2000-02-29} (div 400 → bissexto)', () => {
    expect(computeMonthBounds('2000-02-15')).toEqual({
      monthStart: '2000-02-01',
      monthEnd: '2000-02-29',
    });
  });

  it('"1900-02-15" → {1900-02-01, 1900-02-28} (div 100 mas não 400 → NÃO bissexto)', () => {
    expect(computeMonthBounds('1900-02-15')).toEqual({
      monthStart: '1900-02-01',
      monthEnd: '1900-02-28',
    });
  });
});

describe('computeMonthBounds — input validation', () => {
  it('rejeita formato errado', () => {
    expect(() => computeMonthBounds('23/05/2026')).toThrow(/formato YYYY-MM-DD/);
  });

  it('rejeita mês 13', () => {
    expect(() => computeMonthBounds('2026-13-01')).toThrow(/mês inválido/);
  });

  it('rejeita mês 00', () => {
    expect(() => computeMonthBounds('2026-00-01')).toThrow(/mês inválido/);
  });
});
