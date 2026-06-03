// @vitest-environment node
/**
 * Tests — helper de listagem de recorrências (Story 4.7 AC6, AC4).
 *
 * `db` injectável → testável sem Postgres. `listRecurrences` faz 1 `execute`.
 */
import { describe, expect, it, vi } from 'vitest';

import type { DbShim } from '@/lib/agent/db-shim';
import { listRecurrences } from '@/lib/finance/list-recurrences';
import { boundParamValues } from '@/lib/finance/__tests__/_sql-bound-params';

const HOUSEHOLD_ID = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';

function dbReturning(rows: unknown[]): DbShim {
  return { execute: vi.fn().mockResolvedValue(rows) } as unknown as DbShim;
}

/** Atalho — injecta o `householdId` autenticado nos call sites. */
function recurrencesOf(rows: unknown[], filters: Parameters<typeof listRecurrences>[0]['filters']) {
  return listRecurrences({ db: dbReturning(rows), householdId: HOUSEHOLD_ID, filters });
}

function recRow(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: '11111111-1111-1111-1111-111111111111',
    description: 'Renda',
    kind: 'expense',
    amount_cents: 70000,
    frequency: 'monthly',
    interval_count: 1,
    next_run_on: '2026-06-08',
    active: true,
    category_name: 'Habitação',
    account_or_card_label: 'Millennium',
    ...overrides,
  };
}

describe('listRecurrences', () => {
  it('(1) lista vazia → rows []', async () => {
    const r = await recurrencesOf([], {});
    expect(r.rows).toEqual([]);
  });

  it('(2) mapeia os campos da row correctamente', async () => {
    const r = await recurrencesOf([recRow()], {});
    expect(r.rows[0]).toEqual({
      id: '11111111-1111-1111-1111-111111111111',
      description: 'Renda',
      kind: 'expense',
      amountCents: 70000,
      frequency: 'monthly',
      intervalCount: 1,
      nextRunOn: '2026-06-08',
      active: true,
      categoryName: 'Habitação',
      accountOrCardLabel: 'Millennium',
    });
  });

  it('(3) next_run_on null é preservado (recorrência ainda sem geração)', async () => {
    const r = await recurrencesOf([recRow({ next_run_on: null })], {});
    expect(r.rows[0]?.nextRunOn).toBeNull();
  });

  it('(4) filtros active/frequency/kind não lançam', async () => {
    const r = await recurrencesOf([recRow()], {
      active: false,
      frequency: 'weekly',
      kind: 'income',
    });
    expect(r.rows).toHaveLength(1);
  });

  it('(5) preserva a ordem das rows devolvidas pela query', async () => {
    const r = await recurrencesOf(
      [
        recRow({ id: 'a', description: 'Renda' }),
        recRow({ id: 'b', description: 'Salário', kind: 'income' }),
      ],
      {},
    );
    expect(r.rows.map((x) => x.description)).toEqual(['Renda', 'Salário']);
  });

  it('(6) SEC-4 AC7 — household_id é parâmetro bound na query (condição r.household_id)', async () => {
    const execute = vi.fn().mockResolvedValue([]);
    const db = { execute } as unknown as DbShim;
    await listRecurrences({ db, householdId: HOUSEHOLD_ID, filters: {} });

    expect(execute).toHaveBeenCalledTimes(1);
    expect(boundParamValues(execute.mock.calls[0]?.[0])).toContain(HOUSEHOLD_ID);
  });

  it('(7) SEC-4 — household_id é bound mesmo com filtros activos', async () => {
    const execute = vi.fn().mockResolvedValue([]);
    const db = { execute } as unknown as DbShim;
    await listRecurrences({
      db,
      householdId: HOUSEHOLD_ID,
      filters: { active: true, frequency: 'monthly', kind: 'expense' },
    });
    expect(boundParamValues(execute.mock.calls[0]?.[0])).toContain(HOUSEHOLD_ID);
  });
});
