// @vitest-environment node
/**
 * Tests — helpers de recorrências de Finanças (Story 4.5 AC6).
 *
 * `calcNextRunDate` e `isRecurrenceDue` são funções puras determinísticas —
 * zero mocks, zero rede, zero `vi.setSystemTime` (o `currentRunDate`/`today`
 * são injectados por argumento).
 *
 * Cobertura 15 testes per AC6:
 *   6 frequências (daily/weekly/biweekly/monthly/quarterly/yearly) +
 *   custom fallback + fim de mês clamp + endsOn boundary (3) + isRecurrenceDue (3).
 */
import { describe, expect, it } from 'vitest';

import {
  calcNextRunDate,
  isRecurrenceDue,
  type FinanceRecurrenceForCalc,
} from '@/lib/finance/finance-recurrence-helpers';

/** Constrói uma definição de recorrência de teste com defaults sensatos. */
function rec(overrides: Partial<FinanceRecurrenceForCalc> = {}): FinanceRecurrenceForCalc {
  return {
    frequency: 'monthly',
    interval: 1,
    customRrule: null,
    endsOn: null,
    ...overrides,
  };
}

describe('calcNextRunDate', () => {
  it('(1) daily interval=1 → +1 dia', () => {
    expect(calcNextRunDate(rec({ frequency: 'daily', interval: 1 }), '2026-01-01')).toBe(
      '2026-01-02',
    );
  });

  it('(2) daily interval=3 → +3 dias', () => {
    expect(calcNextRunDate(rec({ frequency: 'daily', interval: 3 }), '2026-01-01')).toBe(
      '2026-01-04',
    );
  });

  it('(3) weekly interval=1 → +1 semana', () => {
    expect(calcNextRunDate(rec({ frequency: 'weekly', interval: 1 }), '2026-01-05')).toBe(
      '2026-01-12',
    );
  });

  it('(4) biweekly → +2 semanas (ignora interval)', () => {
    expect(calcNextRunDate(rec({ frequency: 'biweekly', interval: 5 }), '2026-01-05')).toBe(
      '2026-01-19',
    );
  });

  it('(5) monthly interval=1 → +1 mês', () => {
    expect(calcNextRunDate(rec({ frequency: 'monthly', interval: 1 }), '2026-01-15')).toBe(
      '2026-02-15',
    );
  });

  it('(6) monthly em fim de mês → clamp ao último dia (31 Jan → 28 Fev)', () => {
    expect(calcNextRunDate(rec({ frequency: 'monthly', interval: 1 }), '2026-01-31')).toBe(
      '2026-02-28',
    );
  });

  it('(7) quarterly interval=1 → +3 meses', () => {
    expect(calcNextRunDate(rec({ frequency: 'quarterly', interval: 1 }), '2026-01-15')).toBe(
      '2026-04-15',
    );
  });

  it('(8) yearly interval=1 → +1 ano', () => {
    expect(calcNextRunDate(rec({ frequency: 'yearly', interval: 1 }), '2026-03-08')).toBe(
      '2027-03-08',
    );
  });

  it('(9) custom → fallback monthly interval=1 (MVP D-4.5.4)', () => {
    expect(
      calcNextRunDate(
        rec({ frequency: 'custom', interval: 1, customRrule: 'FREQ=WEEKLY;BYDAY=MO' }),
        '2026-01-15',
      ),
    ).toBe('2026-02-15');
  });

  it('(10) endsOn no passado → próxima data ultrapassa endsOn → null (esgotada)', () => {
    expect(
      calcNextRunDate(rec({ frequency: 'monthly', endsOn: '2026-01-31' }), '2026-01-15'),
    ).toBeNull();
  });

  it('(11) endsOn exactamente igual à próxima data → NÃO esgotada (boundary inclusivo)', () => {
    expect(
      calcNextRunDate(rec({ frequency: 'monthly', endsOn: '2026-02-15' }), '2026-01-15'),
    ).toBe('2026-02-15');
  });

  it('(12) endsOn null → nunca esgota', () => {
    expect(calcNextRunDate(rec({ frequency: 'yearly', endsOn: null }), '2026-01-15')).toBe(
      '2027-01-15',
    );
  });
});

describe('isRecurrenceDue', () => {
  it('(13) nextRunOn null → false', () => {
    expect(isRecurrenceDue(null, '2026-05-22')).toBe(false);
  });

  it('(14) nextRunOn === today → true (devida hoje)', () => {
    expect(isRecurrenceDue('2026-05-22', '2026-05-22')).toBe(true);
  });

  it('(15) nextRunOn no passado → true (deve correr)', () => {
    expect(isRecurrenceDue('2026-05-21', '2026-05-22')).toBe(true);
  });

  it('(extra) nextRunOn no futuro → false', () => {
    expect(isRecurrenceDue('2026-05-23', '2026-05-22')).toBe(false);
  });
});
