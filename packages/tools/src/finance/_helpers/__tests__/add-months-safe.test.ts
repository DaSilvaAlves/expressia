/**
 * Testes para `addMonthsSafe` — addition de meses com gestão de fronteiras
 * de mês (espelha `date + interval '1 month'` Postgres).
 *
 * Trace: Story 4.10 PO_FIX_INLINE F4 + Task T2.3.
 */
import { describe, expect, it } from 'vitest';

import { addMonthsSafe } from '../add-months-safe';

describe('addMonthsSafe — delta básico', () => {
  it('2026-05-15 + 0 → 2026-05-15', () => {
    expect(addMonthsSafe('2026-05-15', 0)).toBe('2026-05-15');
  });

  it('2026-05-15 + 1 → 2026-06-15', () => {
    expect(addMonthsSafe('2026-05-15', 1)).toBe('2026-06-15');
  });

  it('2026-05-15 + 12 → 2027-05-15 (atravessa ano)', () => {
    expect(addMonthsSafe('2026-05-15', 12)).toBe('2027-05-15');
  });

  it('2026-05-15 − 1 → 2026-04-15 (delta negativo)', () => {
    expect(addMonthsSafe('2026-05-15', -1)).toBe('2026-04-15');
  });

  it('2026-01-15 − 1 → 2025-12-15 (atravessa ano via negativo)', () => {
    expect(addMonthsSafe('2026-01-15', -1)).toBe('2025-12-15');
  });
});

describe('addMonthsSafe — fronteiras de mês', () => {
  it('2026-01-31 + 1 → 2026-02-28 (não-bissexto)', () => {
    expect(addMonthsSafe('2026-01-31', 1)).toBe('2026-02-28');
  });

  it('2024-01-31 + 1 → 2024-02-29 (bissexto)', () => {
    expect(addMonthsSafe('2024-01-31', 1)).toBe('2024-02-29');
  });

  it('2000-01-31 + 1 → 2000-02-29 (ano bissexto divisível por 400)', () => {
    expect(addMonthsSafe('2000-01-31', 1)).toBe('2000-02-29');
  });

  it('1900-01-31 + 1 → 1900-02-28 (divisível por 100 mas não 400 → NÃO bissexto)', () => {
    expect(addMonthsSafe('1900-01-31', 1)).toBe('1900-02-28');
  });

  it('2026-03-31 + 1 → 2026-04-30', () => {
    expect(addMonthsSafe('2026-03-31', 1)).toBe('2026-04-30');
  });

  it('2026-08-31 + 6 → 2027-02-28', () => {
    expect(addMonthsSafe('2026-08-31', 6)).toBe('2027-02-28');
  });

  it('2026-05-31 + 1 → 2026-06-30', () => {
    expect(addMonthsSafe('2026-05-31', 1)).toBe('2026-06-30');
  });
});

describe('addMonthsSafe — input validation', () => {
  it('rejeita data sem formato YYYY-MM-DD', () => {
    expect(() => addMonthsSafe('15/06/2026', 1)).toThrow(/formato YYYY-MM-DD/);
  });
  it('rejeita data com timestamp', () => {
    expect(() => addMonthsSafe('2026-05-15T10:00:00Z', 1)).toThrow(/formato YYYY-MM-DD/);
  });
  it('rejeita delta não-inteiro', () => {
    expect(() => addMonthsSafe('2026-05-15', 1.5)).toThrow(/inteiro/);
  });
});
