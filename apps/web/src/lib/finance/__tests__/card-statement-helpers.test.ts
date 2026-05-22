// @vitest-environment node
/**
 * Tests — helper do ciclo de facturação (Story 4.8 AC7, AC2).
 *
 * `calcStatementCycle` é pura e determinística — zero mocks, zero rede.
 * Foco R-4.6: fronteira do ciclo (transacção no `closing_day`, viragem de
 * mês e de ano, regra de vencimento).
 */
import { describe, expect, it } from 'vitest';

import { calcStatementCycle } from '@/lib/finance/card-statement-helpers';

describe('calcStatementCycle', () => {
  it('(1) hoje antes do closing_day → fatura corrente fecha este mês', () => {
    const c = calcStatementCycle(15, 5, '2026-05-10');
    expect(c.currentCycleEnd).toBe('2026-05-15');
  });

  it('(2) hoje depois do closing_day → fatura corrente fecha no mês seguinte', () => {
    const c = calcStatementCycle(15, 5, '2026-05-22');
    expect(c.currentCycleEnd).toBe('2026-06-15');
  });

  it('(3) FRONTEIRA R-4.6 — hoje exactamente no closing_day → fecha hoje', () => {
    const c = calcStatementCycle(15, 5, '2026-05-15');
    expect(c.currentCycleEnd).toBe('2026-05-15');
  });

  it('(4) currentCycleStart = dia seguinte ao fecho anterior', () => {
    const c = calcStatementCycle(15, 5, '2026-05-22');
    // fecho corrente 2026-06-15 → fecho anterior 2026-05-15 → início 2026-05-16
    expect(c.currentCycleStart).toBe('2026-05-16');
  });

  it('(5) próxima fatura é contígua à corrente', () => {
    const c = calcStatementCycle(15, 5, '2026-05-22');
    expect(c.nextCycleStart).toBe('2026-06-16');
    expect(c.nextCycleEnd).toBe('2026-07-15');
  });

  it('(6) dueDay > closingDay → vencimento no mesmo mês do fecho', () => {
    const c = calcStatementCycle(10, 25, '2026-05-05');
    expect(c.currentCycleEnd).toBe('2026-05-10');
    expect(c.currentDueDate).toBe('2026-05-25');
  });

  it('(7) dueDay < closingDay → vencimento no mês seguinte ao fecho', () => {
    const c = calcStatementCycle(15, 5, '2026-05-10');
    expect(c.currentCycleEnd).toBe('2026-05-15');
    expect(c.currentDueDate).toBe('2026-06-05');
  });

  it('(8) dueDay = closingDay → vencimento no mês seguinte (boundary)', () => {
    const c = calcStatementCycle(10, 10, '2026-05-05');
    expect(c.currentCycleEnd).toBe('2026-05-10');
    expect(c.currentDueDate).toBe('2026-06-10');
  });

  it('(9) viragem de ano — Dezembro → Janeiro', () => {
    const c = calcStatementCycle(15, 5, '2026-12-20');
    expect(c.currentCycleEnd).toBe('2027-01-15');
  });

  it('(10) próxima fatura atravessa a viragem de ano', () => {
    const c = calcStatementCycle(15, 5, '2026-12-10');
    expect(c.currentCycleEnd).toBe('2026-12-15');
    expect(c.nextCycleEnd).toBe('2027-01-15');
  });
});
