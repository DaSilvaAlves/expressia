// @vitest-environment node
/**
 * Tests — helper de projecção de 30 dias (Story 4.6 AC9, AC4, AC8).
 *
 * `getMonthProjection` recebe `db` injectável. Os 2 `execute()` ocorrem em
 * ordem fixa: prestações materializadas, recorrências activas. `calcNextRunDate`
 * (Story 4.5) NÃO é mockado — a iteração de recorrências usa a aritmética real.
 *
 * `childLogger` é mockado (evita init de observability em ambiente de teste).
 */
import { describe, expect, it, vi } from 'vitest';

vi.mock('@meu-jarvis/observability', () => ({
  childLogger: () => ({ warn: vi.fn() }),
}));

import type { DbShim } from '@/lib/agent/db-shim';
import { getMonthProjection } from '@/lib/finance/month-projection';
import { boundParamValues } from '@/lib/finance/__tests__/_sql-bound-params';

const HOUSEHOLD_ID = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';

/** `db` falso — 2 `execute()` em ordem: prestações, recorrências. */
function fakeDb(installments: unknown[], recurrences: unknown[]): DbShim {
  const execute = vi
    .fn()
    .mockResolvedValueOnce(installments)
    .mockResolvedValueOnce(recurrences);
  return { execute } as unknown as DbShim;
}

/** Atalho — injecta `householdId` + `today` autenticados nos call sites. */
function projectionOf(installments: unknown[], recurrences: unknown[]) {
  return getMonthProjection({
    db: fakeDb(installments, recurrences),
    householdId: HOUSEHOLD_ID,
    today: TODAY,
  });
}

/** Recorrência de teste com defaults sensatos. */
function rec(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    description: 'Renda',
    kind: 'expense',
    amount_cents: 80000,
    frequency: 'monthly',
    interval: 1,
    custom_rrule: null,
    starts_on: '2026-01-08',
    ends_on: null,
    next_run_on: '2026-06-08',
    ...overrides,
  };
}

const TODAY = '2026-05-22';

describe('getMonthProjection', () => {
  it('(1) zero prestações + zero recorrências → vazio', async () => {
    const r = await projectionOf([], []);
    expect(r.items).toEqual([]);
    expect(r.projectedIncomeCents).toBe(0);
    expect(r.projectedExpenseCents).toBe(0);
  });

  it('(2) 1 prestação na janela → 1 item source=installment', async () => {
    const db = fakeDb(
      [{ date: '2026-06-10', description: 'Portátil 3/12', kind: 'expense', amount_cents: 10000 }],
      [],
    );
    const r = await getMonthProjection({ db, householdId: HOUSEHOLD_ID, today: TODAY });
    expect(r.items).toHaveLength(1);
    expect(r.items[0]?.source).toBe('installment');
    expect(r.projectedExpenseCents).toBe(10000);
  });

  it('(3) recorrência monthly com next_run_on futuro na janela → item source=recurrence', async () => {
    const db = fakeDb([], [rec({ next_run_on: '2026-06-08' })]);
    const r = await getMonthProjection({ db, householdId: HOUSEHOLD_ID, today: TODAY });
    expect(r.items).toHaveLength(1);
    expect(r.items[0]).toMatchObject({
      date: '2026-06-08',
      source: 'recurrence',
      kind: 'expense',
      amountCents: 80000,
    });
  });

  it('(4) ocorrência de hoje NÃO entra na projecção (critério estrito > today)', async () => {
    // next_run_on = today; próxima ocorrência (06-22) cai fora da janela
    // (windowEnd = 06-21) → zero items.
    const db = fakeDb([], [rec({ next_run_on: TODAY })]);
    const r = await getMonthProjection({ db, householdId: HOUSEHOLD_ID, today: TODAY });
    expect(r.items).toEqual([]);
  });

  it('(5) recorrência com next_run_on NULL → usa starts_on', async () => {
    const db = fakeDb(
      [],
      [rec({ frequency: 'weekly', next_run_on: null, starts_on: '2026-05-25' })],
    );
    const r = await getMonthProjection({ db, householdId: HOUSEHOLD_ID, today: TODAY });
    expect(r.items.length).toBeGreaterThan(0);
    expect(r.items[0]?.date).toBe('2026-05-25');
    expect(r.items[0]?.source).toBe('recurrence');
  });

  it('(6) recorrência esgotada (ends_on) → pára de projectar', async () => {
    // next_run_on 05-25 entra; próxima (06-25) > ends_on (05-25) → calcNextRunDate
    // devolve null → loop pára. Exactamente 1 item.
    const db = fakeDb(
      [],
      [rec({ next_run_on: '2026-05-25', ends_on: '2026-05-25' })],
    );
    const r = await getMonthProjection({ db, householdId: HOUSEHOLD_ID, today: TODAY });
    expect(r.items).toHaveLength(1);
    expect(r.items[0]?.date).toBe('2026-05-25');
  });

  it('(7) AC8 — subtotais excluem transfer; income/expense não se misturam', async () => {
    const db = fakeDb(
      [],
      [
        rec({ description: 'Salário', kind: 'income', amount_cents: 250000, next_run_on: '2026-06-01' }),
        rec({ description: 'Renda', kind: 'expense', amount_cents: 80000, next_run_on: '2026-06-08' }),
        rec({ description: 'Poupança', kind: 'transfer', amount_cents: 30000, next_run_on: '2026-06-10' }),
      ],
    );
    const r = await getMonthProjection({ db, householdId: HOUSEHOLD_ID, today: TODAY });
    expect(r.projectedIncomeCents).toBe(250000);
    expect(r.projectedExpenseCents).toBe(80000);
    // transfer aparece na lista mas não nos subtotais
    expect(r.items.some((it) => it.kind === 'transfer')).toBe(true);
  });

  it('(8) items ordenados por data asc (prestações + recorrências intercaladas)', async () => {
    const db = fakeDb(
      [{ date: '2026-06-10', description: 'Parcela', kind: 'expense', amount_cents: 10000 }],
      [rec({ next_run_on: '2026-06-01' })],
    );
    const r = await getMonthProjection({ db, householdId: HOUSEHOLD_ID, today: TODAY });
    expect(r.items.map((it) => it.date)).toEqual(['2026-06-01', '2026-06-10']);
  });

  it('(9) windowEnd = today + 30 dias', async () => {
    const r = await projectionOf([], []);
    expect(r.windowEnd).toBe('2026-06-21');
  });

  it('(10) SEC-4 AC7 — household_id é parâmetro bound nas 2 queries (prestações, recorrências)', async () => {
    const execute = vi.fn().mockResolvedValue([]);
    const db = { execute } as unknown as DbShim;
    await getMonthProjection({ db, householdId: HOUSEHOLD_ID, today: TODAY });

    expect(execute).toHaveBeenCalledTimes(2);
    expect(boundParamValues(execute.mock.calls[0]?.[0])).toContain(HOUSEHOLD_ID);
    expect(boundParamValues(execute.mock.calls[1]?.[0])).toContain(HOUSEHOLD_ID);
  });
});
