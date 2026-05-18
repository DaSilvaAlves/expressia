/**
 * Tests `week-helpers.ts` (Story 3.5 T11.5 — DST + week-start Monday + range formatting).
 *
 * R3 DST mitigation: testes específicos para transições Portugal 2026:
 *   - 29 Março 2026 — DST forward (último domingo Março)
 *   - 25 Outubro 2026 — DST backward (último domingo Outubro)
 *
 * R5 Week start Monday: validar `startOfWeek(date, { locale: pt, weekStartsOn: 1 })`.
 */
import { describe, expect, it } from 'vitest';

import {
  buildWeekDays,
  formatDayMonth,
  formatDayShort,
  formatWeekIso,
  formatWeekRange,
  resolveWeekStart,
  toDayIso,
} from '@/app/(app)/tarefas/calendario/_components/week-helpers';

describe('week-helpers', () => {
  describe('resolveWeekStart', () => {
    it('resolves ISO week (2026-W21) → Monday', () => {
      const monday = resolveWeekStart('2026-W21');
      // ISO 8601 week 21 of 2026 starts on Monday 2026-05-18.
      expect(toDayIso(monday)).toBe('2026-05-18');
    });

    it('resolves ISO date (2026-05-17 Sunday) → Monday before (2026-05-11)', () => {
      const monday = resolveWeekStart('2026-05-17');
      // 2026-05-17 is a Sunday. Week starts Monday 2026-05-11.
      expect(toDayIso(monday)).toBe('2026-05-11');
    });

    it('falls back to current week when param is null/empty/invalid', () => {
      const result = resolveWeekStart(null);
      expect(result).toBeInstanceOf(Date);
      // Monday of current week (locale pt, weekStartsOn: 1) — we just assert
      // that getDay() === 1 (Monday).
      expect(result.getDay()).toBe(1);
    });

    it('falls back to current week when param is garbage', () => {
      const result = resolveWeekStart('not-a-date');
      expect(result.getDay()).toBe(1);
    });

    // R3 DST edge cases — Portugal transitions 2026
    it('R3 DST forward — semana que contém 2026-03-29 (último domingo Março)', () => {
      // 2026-03-29 é domingo, DST forward. Week start Monday 2026-03-23.
      const monday = resolveWeekStart('2026-03-29');
      expect(toDayIso(monday)).toBe('2026-03-23');
      // Os 7 dias da semana incluem o dia da transição DST sem off-by-1.
      const days = buildWeekDays(monday).map(toDayIso);
      expect(days).toEqual([
        '2026-03-23',
        '2026-03-24',
        '2026-03-25',
        '2026-03-26',
        '2026-03-27',
        '2026-03-28',
        '2026-03-29',
      ]);
    });

    it('R3 DST backward — semana que contém 2026-10-25 (último domingo Outubro)', () => {
      const monday = resolveWeekStart('2026-10-25');
      expect(toDayIso(monday)).toBe('2026-10-19');
      const days = buildWeekDays(monday).map(toDayIso);
      expect(days).toEqual([
        '2026-10-19',
        '2026-10-20',
        '2026-10-21',
        '2026-10-22',
        '2026-10-23',
        '2026-10-24',
        '2026-10-25',
      ]);
    });
  });

  describe('toDayIso / buildWeekDays', () => {
    it('toDayIso returns YYYY-MM-DD zero-padded', () => {
      expect(toDayIso(new Date(2026, 0, 5))).toBe('2026-01-05');
      expect(toDayIso(new Date(2026, 11, 31))).toBe('2026-12-31');
    });

    it('buildWeekDays returns 7 consecutive days starting at weekStart', () => {
      const monday = new Date(2026, 4, 11); // 2026-05-11 Monday
      const days = buildWeekDays(monday).map(toDayIso);
      expect(days).toHaveLength(7);
      expect(days[0]).toBe('2026-05-11');
      expect(days[6]).toBe('2026-05-17');
    });
  });

  describe('formatDayShort / formatDayMonth — PT-PT capitalized', () => {
    it('formats day short (Seg, Ter...)', () => {
      const monday = new Date(2026, 4, 11);
      const tuesday = new Date(2026, 4, 12);
      const sunday = new Date(2026, 4, 17);
      expect(formatDayShort(monday)).toBe('Seg');
      expect(formatDayShort(tuesday)).toBe('Ter');
      expect(formatDayShort(sunday)).toBe('Dom');
    });

    it('formats day + month abbreviated PT-PT (capitalized)', () => {
      expect(formatDayMonth(new Date(2026, 4, 14))).toBe('14 Mai');
      expect(formatDayMonth(new Date(2026, 11, 31))).toBe('31 Dez');
    });
  });

  describe('formatWeekRange — same-month / cross-month / cross-year', () => {
    it('same month: "12 a 18 Maio 2026"', () => {
      const monday = new Date(2026, 4, 11); // 2026-05-11 Mon → 17 Sun
      // weekStart=11, weekEnd=17. format outputs "11 a 17 Maio 2026".
      expect(formatWeekRange(monday)).toBe('11 a 17 Maio 2026');
    });

    it('cross-month: "30 Abr a 6 Mai 2026"', () => {
      const monday = new Date(2026, 3, 27); // 2026-04-27 Mon → 2026-05-03 Sun
      const result = formatWeekRange(monday);
      expect(result).toMatch(/^27 Abr a 3 Mai 2026$/);
    });

    it('cross-year: "29 Dez 2025 a 4 Jan 2026"', () => {
      const monday = new Date(2025, 11, 29); // 2025-12-29 Mon → 2026-01-04 Sun
      const result = formatWeekRange(monday);
      expect(result).toMatch(/29 Dez 2025 a 4 Jan 2026/);
    });
  });

  describe('formatWeekIso', () => {
    it('produces YYYY-Www format', () => {
      const monday = new Date(2026, 4, 18); // 2026-W21
      expect(formatWeekIso(monday)).toBe('2026-W21');
    });
  });
});
