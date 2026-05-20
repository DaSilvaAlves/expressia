// @vitest-environment node
/**
 * Tests — `expandRecurrence` + `frequencyToRRuleString` (Story 3.7 AC8).
 *
 * `expandRecurrence` é uma função pura — zero mocks, zero rede, zero Drizzle.
 * `options.now` é injectável, logo nem `vi.setSystemTime` é estritamente
 * necessário; usamos `now` explícito para cada cenário.
 *
 * Cobertura ≥15 testes per AC8:
 *   8 frequencies + custom RRULE + endsOn + truncação + 2 DST PT + nextRun +
 *   last-weekday edge case.
 */
import { describe, expect, it } from 'vitest';

import {
  EXPAND_HORIZON_DAYS,
  expandRecurrence,
  frequencyToRRuleString,
  isValidISODate,
  type RecurrenceInput,
} from '@/lib/recurrences/rrule-helpers';

/** Constrói um `RecurrenceInput` com defaults práticos. */
function makeRecurrence(overrides: Partial<RecurrenceInput>): RecurrenceInput {
  return {
    frequency: 'daily',
    interval: 1,
    customRrule: null,
    startsOn: '2026-01-01',
    endsOn: null,
    nextRunOn: null,
    ...overrides,
  };
}

/** `Date` UTC para um dado dia (meia-noite UTC). */
function utc(isoDate: string): Date {
  return new Date(`${isoDate}T00:00:00Z`);
}

describe('frequencyToRRuleString', () => {
  it('mapeia daily/weekly/monthly/yearly com interval', () => {
    expect(frequencyToRRuleString('daily', 2, null)).toBe('RRULE:FREQ=DAILY;INTERVAL=2');
    expect(frequencyToRRuleString('weekly', 1, null)).toBe('RRULE:FREQ=WEEKLY;INTERVAL=1');
    expect(frequencyToRRuleString('monthly', 3, null)).toBe('RRULE:FREQ=MONTHLY;INTERVAL=3');
    expect(frequencyToRRuleString('yearly', 1, null)).toBe('RRULE:FREQ=YEARLY;INTERVAL=1');
  });

  it('biweekly ignora interval e força INTERVAL=2', () => {
    expect(frequencyToRRuleString('biweekly', 5, null)).toBe('RRULE:FREQ=WEEKLY;INTERVAL=2');
  });

  it('weekdays e weekends usam BYDAY', () => {
    expect(frequencyToRRuleString('weekdays', 1, null)).toBe(
      'RRULE:FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR',
    );
    expect(frequencyToRRuleString('weekends', 1, null)).toBe('RRULE:FREQ=WEEKLY;BYDAY=SA,SU');
  });

  it('custom normaliza o prefixo RRULE: e rejeita string vazia', () => {
    expect(frequencyToRRuleString('custom', 1, 'FREQ=MONTHLY;BYMONTHDAY=-1')).toBe(
      'RRULE:FREQ=MONTHLY;BYMONTHDAY=-1',
    );
    expect(frequencyToRRuleString('custom', 1, 'RRULE:FREQ=DAILY')).toBe('RRULE:FREQ=DAILY');
    expect(() => frequencyToRRuleString('custom', 1, null)).toThrow(/customRrule/);
    expect(() => frequencyToRRuleString('custom', 1, '   ')).toThrow(/customRrule/);
  });

  it('interval inválido (<1, NaN) cai para 1', () => {
    expect(frequencyToRRuleString('daily', 0, null)).toBe('RRULE:FREQ=DAILY;INTERVAL=1');
    expect(frequencyToRRuleString('daily', Number.NaN, null)).toBe('RRULE:FREQ=DAILY;INTERVAL=1');
  });
});

describe('expandRecurrence', () => {
  it('(1) daily interval=1 horizon=7 → 8 ocorrências consecutivas', () => {
    const result = expandRecurrence(makeRecurrence({ frequency: 'daily', startsOn: '2026-01-01' }), {
      horizonDays: 7,
      now: utc('2026-01-01'),
    });
    expect(result.occurrences.map((o) => o.targetDate)).toEqual([
      '2026-01-01',
      '2026-01-02',
      '2026-01-03',
      '2026-01-04',
      '2026-01-05',
      '2026-01-06',
      '2026-01-07',
      '2026-01-08',
    ]);
    expect(result.isExhausted).toBe(false);
  });

  it('(2) daily interval=2 → ocorrências espaçadas 2 dias', () => {
    const result = expandRecurrence(
      makeRecurrence({ frequency: 'daily', interval: 2, startsOn: '2026-01-01' }),
      { horizonDays: 8, now: utc('2026-01-01') },
    );
    expect(result.occurrences.map((o) => o.targetDate)).toEqual([
      '2026-01-01',
      '2026-01-03',
      '2026-01-05',
      '2026-01-07',
      '2026-01-09',
    ]);
  });

  it('(3) weekly interval=1 a partir de uma segunda → segundas-feiras', () => {
    const result = expandRecurrence(
      makeRecurrence({ frequency: 'weekly', startsOn: '2026-01-05' }),
      { horizonDays: 21, now: utc('2026-01-05') },
    );
    expect(result.occurrences.map((o) => o.targetDate)).toEqual([
      '2026-01-05',
      '2026-01-12',
      '2026-01-19',
      '2026-01-26',
    ]);
  });

  it('(4) biweekly → ocorrências de 2 em 2 semanas', () => {
    const result = expandRecurrence(
      makeRecurrence({ frequency: 'biweekly', startsOn: '2026-01-05' }),
      { horizonDays: 28, now: utc('2026-01-05') },
    );
    expect(result.occurrences.map((o) => o.targetDate)).toEqual([
      '2026-01-05',
      '2026-01-19',
      '2026-02-02',
    ]);
  });

  it('(5) monthly interval=1 horizon=90 → ~3-4 ocorrências mensais', () => {
    const result = expandRecurrence(
      makeRecurrence({ frequency: 'monthly', startsOn: '2026-01-15' }),
      { horizonDays: 90, now: utc('2026-01-15') },
    );
    expect(result.occurrences.map((o) => o.targetDate)).toEqual([
      '2026-01-15',
      '2026-02-15',
      '2026-03-15',
      '2026-04-15',
    ]);
  });

  it('(6) weekdays → exclui sábados e domingos', () => {
    const result = expandRecurrence(
      makeRecurrence({ frequency: 'weekdays', startsOn: '2026-01-05' }),
      { horizonDays: 14, now: utc('2026-01-05') },
    );
    const dates = result.occurrences.map((o) => o.targetDate);
    // Janela [2026-01-05, 2026-01-19] inclusive — apenas dias úteis.
    expect(dates).toEqual([
      '2026-01-05',
      '2026-01-06',
      '2026-01-07',
      '2026-01-08',
      '2026-01-09',
      '2026-01-12',
      '2026-01-13',
      '2026-01-14',
      '2026-01-15',
      '2026-01-16',
      '2026-01-19',
    ]);
    // Nenhum fim-de-semana (10/11 e 17/18 de Janeiro são sábados/domingos).
    expect(dates).not.toContain('2026-01-10');
    expect(dates).not.toContain('2026-01-11');
    expect(dates).not.toContain('2026-01-17');
    expect(dates).not.toContain('2026-01-18');
  });

  it('(7) weekends → apenas sábados e domingos', () => {
    const result = expandRecurrence(
      makeRecurrence({ frequency: 'weekends', startsOn: '2026-01-03' }),
      { horizonDays: 14, now: utc('2026-01-03') },
    );
    expect(result.occurrences.map((o) => o.targetDate)).toEqual([
      '2026-01-03',
      '2026-01-04',
      '2026-01-10',
      '2026-01-11',
      '2026-01-17',
    ]);
  });

  it('(8) yearly interval=1 horizon=400 → 2 ocorrências anuais', () => {
    const result = expandRecurrence(
      makeRecurrence({ frequency: 'yearly', startsOn: '2026-03-15' }),
      { horizonDays: 400, now: utc('2026-03-15') },
    );
    expect(result.occurrences.map((o) => o.targetDate)).toEqual(['2026-03-15', '2027-03-15']);
  });

  it('(9) custom BYMONTHDAY=-1 → último dia de cada mês', () => {
    const result = expandRecurrence(
      makeRecurrence({
        frequency: 'custom',
        customRrule: 'RRULE:FREQ=MONTHLY;BYMONTHDAY=-1',
        startsOn: '2026-01-01',
      }),
      { horizonDays: 120, now: utc('2026-01-01') },
    );
    expect(result.occurrences.map((o) => o.targetDate)).toEqual([
      '2026-01-31',
      '2026-02-28',
      '2026-03-31',
      '2026-04-30',
    ]);
  });

  it('(10) endsOn no passado → isExhausted true, zero ocorrências', () => {
    const result = expandRecurrence(
      makeRecurrence({ frequency: 'daily', startsOn: '2025-01-01', endsOn: '2025-12-31' }),
      { horizonDays: 90, now: utc('2026-05-20') },
    );
    expect(result.occurrences).toEqual([]);
    expect(result.isExhausted).toBe(true);
    expect(result.nextRunAfterHorizon).toBeNull();
  });

  it('(11) endsOn dentro do horizonte → trunca ocorrências', () => {
    const result = expandRecurrence(
      makeRecurrence({ frequency: 'daily', startsOn: '2026-01-01', endsOn: '2026-01-05' }),
      { horizonDays: 30, now: utc('2026-01-01') },
    );
    expect(result.occurrences.map((o) => o.targetDate)).toEqual([
      '2026-01-01',
      '2026-01-02',
      '2026-01-03',
      '2026-01-04',
      '2026-01-05',
    ]);
    // RRULE esgotou (endsOn 2026-01-05) → nada após o horizonte.
    expect(result.nextRunAfterHorizon).toBeNull();
    expect(result.isExhausted).toBe(true);
  });

  it('(12) DST spring forward 2026-03-29 → 3 dias consecutivos sem skip', () => {
    // Último domingo de Março 2026: relógio avança 01:00→02:00 (WET→WEST).
    const result = expandRecurrence(
      makeRecurrence({ frequency: 'daily', startsOn: '2026-03-25' }),
      { horizonDays: 10, now: utc('2026-03-28') },
    );
    const dates = result.occurrences.map((o) => o.targetDate);
    expect(dates).toContain('2026-03-28');
    expect(dates).toContain('2026-03-29'); // dia da transição — não deve ser saltado
    expect(dates).toContain('2026-03-30');
    // Consecutivos sem buraco.
    const idx = dates.indexOf('2026-03-28');
    expect(dates.slice(idx, idx + 3)).toEqual(['2026-03-28', '2026-03-29', '2026-03-30']);
  });

  it('(13) DST fall back 2026-10-25 → 3 dias consecutivos sem duplicado', () => {
    // Último domingo de Outubro 2026: relógio recua 02:00→01:00 (WEST→WET).
    const result = expandRecurrence(
      makeRecurrence({ frequency: 'daily', startsOn: '2026-10-20' }),
      { horizonDays: 10, now: utc('2026-10-24') },
    );
    const dates = result.occurrences.map((o) => o.targetDate);
    // 2026-10-25 aparece exactamente uma vez (sem duplicado pela hora extra).
    expect(dates.filter((d) => d === '2026-10-25')).toHaveLength(1);
    const idx = dates.indexOf('2026-10-24');
    expect(dates.slice(idx, idx + 3)).toEqual(['2026-10-24', '2026-10-25', '2026-10-26']);
  });

  it('(14) nextRunAfterHorizon correcto para monthly horizon=90', () => {
    // now=2026-05-20, horizon 90d → fim do horizonte ~2026-08-18.
    const result = expandRecurrence(
      makeRecurrence({ frequency: 'monthly', startsOn: '2026-01-15' }),
      { horizonDays: 90, now: utc('2026-05-20') },
    );
    // Ocorrências dentro: Jun 15, Jul 15, Ago 15. Próxima após horizonte: Set 15.
    expect(result.occurrences.map((o) => o.targetDate)).toEqual([
      '2026-06-15',
      '2026-07-15',
      '2026-08-15',
    ]);
    expect(result.nextRunAfterHorizon).toBe('2026-09-15');
    expect(result.isExhausted).toBe(false);
  });

  it('(15) custom BYDAY=-1FR → última sexta-feira de cada mês', () => {
    const result = expandRecurrence(
      makeRecurrence({
        frequency: 'custom',
        customRrule: 'RRULE:FREQ=MONTHLY;BYDAY=-1FR',
        startsOn: '2026-01-01',
      }),
      { horizonDays: 90, now: utc('2026-01-01') },
    );
    expect(result.occurrences.map((o) => o.targetDate)).toEqual([
      '2026-01-30',
      '2026-02-27',
      '2026-03-27',
    ]);
  });

  it('EXPAND_HORIZON_DAYS é 90 (D-3.7.1)', () => {
    expect(EXPAND_HORIZON_DAYS).toBe(90);
  });

  it('isValidISODate aceita datas válidas e rejeita inválidas', () => {
    expect(isValidISODate('2026-05-20')).toBe(true);
    expect(isValidISODate('2026-13-99')).toBe(false);
    expect(isValidISODate('20-05-2026')).toBe(false);
    expect(isValidISODate('not-a-date')).toBe(false);
  });
});
