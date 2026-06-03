// @vitest-environment node
/**
 * Tests — helper de listagem de transacções variáveis (Story 4.7 AC6, AC2).
 *
 * `db` injectável → testável sem Postgres. `listVariableTransactions` faz 1
 * `execute`; `getVariableTxFilterOptions` faz 3 (`Promise.all`).
 */
import { describe, expect, it, vi } from 'vitest';

import type { DbShim } from '@/lib/agent/db-shim';
import {
  getVariableTxFilterOptions,
  listVariableTransactions,
} from '@/lib/finance/list-variable-transactions';
import { boundParamValues } from '@/lib/finance/__tests__/_sql-bound-params';

const HOUSEHOLD_ID = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';

function dbReturning(rows: unknown[]): DbShim {
  return { execute: vi.fn().mockResolvedValue(rows) } as unknown as DbShim;
}

/** Atalho — injecta o `householdId` autenticado nos call sites. */
function variableTxOf(rows: unknown[], filters: Parameters<typeof listVariableTransactions>[0]['filters']) {
  return listVariableTransactions({ db: dbReturning(rows), householdId: HOUSEHOLD_ID, filters });
}

function txRow(id: string, date: string): Record<string, unknown> {
  return {
    id,
    transaction_date: date,
    description: 'Supermercado',
    kind: 'expense',
    amount_cents: 7800,
    category_name: 'Alimentação',
    account_or_card_label: 'Millennium',
  };
}

const UUID_A = '11111111-1111-1111-1111-111111111111';
const UUID_B = '22222222-2222-2222-2222-222222222222';
const UUID_C = '33333333-3333-3333-3333-333333333333';

describe('listVariableTransactions', () => {
  it('(1) lista vazia → rows [] + nextCursor null', async () => {
    const r = await variableTxOf([], {});
    expect(r.rows).toEqual([]);
    expect(r.nextCursor).toBeNull();
  });

  it('(2) mapeia os campos da row correctamente', async () => {
    const r = await variableTxOf([txRow(UUID_A, '2026-05-10')], {});
    expect(r.rows[0]).toEqual({
      id: UUID_A,
      transactionDate: '2026-05-10',
      description: 'Supermercado',
      kind: 'expense',
      amountCents: 7800,
      categoryName: 'Alimentação',
      accountOrCardLabel: 'Millennium',
    });
  });

  it('(3) nextCursor presente quando há mais que `limit` rows', async () => {
    // limit=2, a query devolve 3 (limit+1) → hasMore.
    const r = await variableTxOf(
      [
        txRow(UUID_A, '2026-05-10'),
        txRow(UUID_B, '2026-05-09'),
        txRow(UUID_C, '2026-05-08'),
      ],
      { limit: 2 },
    );
    expect(r.rows).toHaveLength(2);
    expect(r.nextCursor).not.toBeNull();
  });

  it('(4) nextCursor null quando rows <= limit', async () => {
    const r = await variableTxOf(
      [txRow(UUID_A, '2026-05-10'), txRow(UUID_B, '2026-05-09')],
      { limit: 2 },
    );
    expect(r.rows).toHaveLength(2);
    expect(r.nextCursor).toBeNull();
  });

  it('(5) cursor malformado → não lança, trata como sem cursor', async () => {
    const r = await variableTxOf([txRow(UUID_A, '2026-05-10')], { cursor: 'lixo-invalido' });
    expect(r.rows).toHaveLength(1);
  });

  it('(6) SEC-4 AC7 — household_id é parâmetro bound na query (condição t.household_id)', async () => {
    const execute = vi.fn().mockResolvedValue([]);
    const db = { execute } as unknown as DbShim;
    await listVariableTransactions({ db, householdId: HOUSEHOLD_ID, filters: {} });

    expect(execute).toHaveBeenCalledTimes(1);
    expect(boundParamValues(execute.mock.calls[0]?.[0])).toContain(HOUSEHOLD_ID);
  });
});

describe('getVariableTxFilterOptions', () => {
  it('(1) devolve categorias/contas/cartões', async () => {
    const execute = vi
      .fn()
      .mockResolvedValueOnce([{ id: 'c1', name: 'Alimentação' }])
      .mockResolvedValueOnce([{ id: 'a1', name: 'Millennium' }])
      .mockResolvedValueOnce([{ id: 'k1', name: 'Visa' }]);
    const db = { execute } as unknown as DbShim;
    const r = await getVariableTxFilterOptions({ db, householdId: HOUSEHOLD_ID });
    expect(r.categories).toEqual([{ id: 'c1', name: 'Alimentação' }]);
    expect(r.accounts).toEqual([{ id: 'a1', name: 'Millennium' }]);
    expect(r.cards).toEqual([{ id: 'k1', name: 'Visa' }]);
    expect(execute).toHaveBeenCalledTimes(3);
  });

  it('(2) sem opções → arrays vazios', async () => {
    const execute = vi
      .fn()
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([]);
    const r = await getVariableTxFilterOptions({
      db: { execute } as unknown as DbShim,
      householdId: HOUSEHOLD_ID,
    });
    expect(r.categories).toEqual([]);
    expect(r.accounts).toEqual([]);
    expect(r.cards).toEqual([]);
  });

  it('(3) SEC-4 AC2/AC7 — household_id bound nas 3 queries; categorias incluem globais (IS NULL), accounts/cards NÃO', async () => {
    const execute = vi
      .fn()
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([]);
    const db = { execute } as unknown as DbShim;
    await getVariableTxFilterOptions({ db, householdId: HOUSEHOLD_ID });

    expect(execute).toHaveBeenCalledTimes(3);
    const categoriesSql = execute.mock.calls[0]?.[0];
    const accountsSql = execute.mock.calls[1]?.[0];
    const cardsSql = execute.mock.calls[2]?.[0];

    // householdId é bound nas 3 queries (1.ª rede).
    expect(boundParamValues(categoriesSql)).toContain(HOUSEHOLD_ID);
    expect(boundParamValues(accountsSql)).toContain(HOUSEHOLD_ID);
    expect(boundParamValues(cardsSql)).toContain(HOUSEHOLD_ID);

    // AC2 — só a query de categorias tem o ramo `household_id is null` (globais).
    // (Todas têm `archived_at is null`; o discriminante é `household_id is null`.)
    const sqlText = (s: unknown): string =>
      JSON.stringify(s, (_k, v) => (typeof v === 'bigint' ? v.toString() : v))
        .toLowerCase()
        .replace(/\s+/g, ' ');
    expect(sqlText(categoriesSql)).toContain('household_id is null');
    expect(sqlText(accountsSql)).not.toContain('household_id is null');
    expect(sqlText(cardsSql)).not.toContain('household_id is null');
  });
});
