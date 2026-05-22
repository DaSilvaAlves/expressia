// @vitest-environment node
/**
 * Tests — helper de agregação mensal (Story 4.6 AC9, AC8).
 *
 * `getMonthSummary` recebe `db` injectável — testável sem Postgres real.
 * Os 3 `execute()` ocorrem em ordem fixa (Promise.all): totais, categorias,
 * dias. O `db` falso devolve uma resposta por chamada via `mockResolvedValueOnce`.
 *
 * Nota AC8: a exclusão de `transfer` dos totais e a ausência de mistura de
 * sinais são garantidas pelas cláusulas `FILTER (WHERE kind = ...)` do SQL —
 * verificadas com fixture real mista em AC7 (EXPLAIN ANALYZE), já que o
 * harness `@meu-jarvis/db-test` (Docker) não corre local. Estes testes cobrem
 * o nível JS: mapeamento de rows e a fórmula `netCents = income − expense`.
 */
import { describe, expect, it, vi } from 'vitest';

import type { DbShim } from '@/lib/agent/db-shim';
import { getMonthSummary } from '@/lib/finance/month-summary';

/** `db` falso — 3 `execute()` em ordem: totais, categorias, dias. */
function fakeDb(totals: unknown[], categories: unknown[], days: unknown[]): DbShim {
  const execute = vi
    .fn()
    .mockResolvedValueOnce(totals)
    .mockResolvedValueOnce(categories)
    .mockResolvedValueOnce(days);
  return { execute } as unknown as DbShim;
}

const RANGE = { monthStart: '2026-05-01', monthEnd: '2026-05-31' } as const;

describe('getMonthSummary', () => {
  it('(1) mês vazio → todos os agregados a zero', async () => {
    const db = fakeDb([{ total_income_cents: 0, total_expense_cents: 0 }], [], []);
    const r = await getMonthSummary({ db, ...RANGE });
    expect(r.totalIncomeCents).toBe(0);
    expect(r.totalExpenseCents).toBe(0);
    expect(r.netCents).toBe(0);
    expect(r.byCategory).toEqual([]);
    expect(r.byDay).toEqual([]);
  });

  it('(2) totais income/expense + netCents = income − expense', async () => {
    const db = fakeDb(
      [{ total_income_cents: 250000, total_expense_cents: 88000 }],
      [],
      [],
    );
    const r = await getMonthSummary({ db, ...RANGE });
    expect(r.totalIncomeCents).toBe(250000);
    expect(r.totalExpenseCents).toBe(88000);
    expect(r.netCents).toBe(162000);
  });

  it('(3) netCents negativo quando expense > income', async () => {
    const db = fakeDb(
      [{ total_income_cents: 50000, total_expense_cents: 73000 }],
      [],
      [],
    );
    const r = await getMonthSummary({ db, ...RANGE });
    expect(r.netCents).toBe(-23000);
  });

  it('(4) byCategory mapeado preservando a ordem do SQL (desc)', async () => {
    const db = fakeDb(
      [{ total_income_cents: 0, total_expense_cents: 0 }],
      [
        {
          category_id: 'c1',
          category_name: 'Supermercado',
          kind: 'expense',
          total_cents: 40000,
          tx_count: 7,
        },
        {
          category_id: 'c2',
          category_name: 'Combustível',
          kind: 'expense',
          total_cents: 12000,
          tx_count: 2,
        },
      ],
      [],
    );
    const r = await getMonthSummary({ db, ...RANGE });
    expect(r.byCategory).toEqual([
      { categoryId: 'c1', categoryName: 'Supermercado', kind: 'expense', totalCents: 40000, txCount: 7 },
      { categoryId: 'c2', categoryName: 'Combustível', kind: 'expense', totalCents: 12000, txCount: 2 },
    ]);
  });

  it("(5) byCategory com category_id NULL → 'Sem categoria'", async () => {
    const db = fakeDb(
      [{ total_income_cents: 0, total_expense_cents: 0 }],
      [
        {
          category_id: null,
          category_name: 'Sem categoria',
          kind: 'expense',
          total_cents: 5000,
          tx_count: 1,
        },
      ],
      [],
    );
    const r = await getMonthSummary({ db, ...RANGE });
    expect(r.byCategory[0]?.categoryId).toBeNull();
    expect(r.byCategory[0]?.categoryName).toBe('Sem categoria');
  });

  it('(6) byCategory preserva rows kind=transfer (a UI filtra, o helper não dropa)', async () => {
    const db = fakeDb(
      [{ total_income_cents: 0, total_expense_cents: 0 }],
      [
        { category_id: 'c1', category_name: 'Poupança', kind: 'transfer', total_cents: 30000, tx_count: 1 },
      ],
      [],
    );
    const r = await getMonthSummary({ db, ...RANGE });
    expect(r.byCategory[0]?.kind).toBe('transfer');
  });

  it('(7) byDay mapeado (day/expenseCents/incomeCents)', async () => {
    const db = fakeDb(
      [{ total_income_cents: 0, total_expense_cents: 0 }],
      [],
      [
        { day: '2026-05-03', expense_cents: 7800, income_cents: 0 },
        { day: '2026-05-10', expense_cents: 0, income_cents: 250000 },
      ],
    );
    const r = await getMonthSummary({ db, ...RANGE });
    expect(r.byDay).toEqual([
      { day: '2026-05-03', expenseCents: 7800, incomeCents: 0 },
      { day: '2026-05-10', expenseCents: 0, incomeCents: 250000 },
    ]);
  });

  it('(8) totalsRows vazio (defensivo) → zeros sem lançar', async () => {
    const db = fakeDb([], [], []);
    const r = await getMonthSummary({ db, ...RANGE });
    expect(r.totalIncomeCents).toBe(0);
    expect(r.totalExpenseCents).toBe(0);
    expect(r.netCents).toBe(0);
  });

  it('(9) executa exactamente 3 queries (totais, categorias, dias)', async () => {
    const execute = vi
      .fn()
      .mockResolvedValueOnce([{ total_income_cents: 0, total_expense_cents: 0 }])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([]);
    const db = { execute } as unknown as DbShim;
    await getMonthSummary({ db, ...RANGE });
    expect(execute).toHaveBeenCalledTimes(3);
  });

  it('(10) só transacções reais — netCents nunca soma valor de transfer', async () => {
    // O SQL exclui transfer via FILTER; o totals row reflecte isso. netCents
    // deriva apenas de income/expense — nunca de um terceiro valor.
    const db = fakeDb(
      [{ total_income_cents: 100000, total_expense_cents: 40000 }],
      [
        { category_id: 'c1', category_name: 'Salário', kind: 'income', total_cents: 100000, tx_count: 1 },
        { category_id: 'c2', category_name: 'Renda', kind: 'expense', total_cents: 40000, tx_count: 1 },
        { category_id: 'c3', category_name: 'Transferência', kind: 'transfer', total_cents: 999999, tx_count: 1 },
      ],
      [],
    );
    const r = await getMonthSummary({ db, ...RANGE });
    expect(r.netCents).toBe(60000); // 100000 − 40000; o transfer (999999) é ignorado
  });
});
