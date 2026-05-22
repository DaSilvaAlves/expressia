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

function dbReturning(rows: unknown[]): DbShim {
  return { execute: vi.fn().mockResolvedValue(rows) } as unknown as DbShim;
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
    const r = await listVariableTransactions({ db: dbReturning([]), filters: {} });
    expect(r.rows).toEqual([]);
    expect(r.nextCursor).toBeNull();
  });

  it('(2) mapeia os campos da row correctamente', async () => {
    const r = await listVariableTransactions({
      db: dbReturning([txRow(UUID_A, '2026-05-10')]),
      filters: {},
    });
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
    const r = await listVariableTransactions({
      db: dbReturning([
        txRow(UUID_A, '2026-05-10'),
        txRow(UUID_B, '2026-05-09'),
        txRow(UUID_C, '2026-05-08'),
      ]),
      filters: { limit: 2 },
    });
    expect(r.rows).toHaveLength(2);
    expect(r.nextCursor).not.toBeNull();
  });

  it('(4) nextCursor null quando rows <= limit', async () => {
    const r = await listVariableTransactions({
      db: dbReturning([txRow(UUID_A, '2026-05-10'), txRow(UUID_B, '2026-05-09')]),
      filters: { limit: 2 },
    });
    expect(r.rows).toHaveLength(2);
    expect(r.nextCursor).toBeNull();
  });

  it('(5) cursor malformado → não lança, trata como sem cursor', async () => {
    const r = await listVariableTransactions({
      db: dbReturning([txRow(UUID_A, '2026-05-10')]),
      filters: { cursor: 'lixo-invalido' },
    });
    expect(r.rows).toHaveLength(1);
  });
});

describe('getVariableTxFilterOptions', () => {
  it('(6) devolve categorias/contas/cartões', async () => {
    const execute = vi
      .fn()
      .mockResolvedValueOnce([{ id: 'c1', name: 'Alimentação' }])
      .mockResolvedValueOnce([{ id: 'a1', name: 'Millennium' }])
      .mockResolvedValueOnce([{ id: 'k1', name: 'Visa' }]);
    const db = { execute } as unknown as DbShim;
    const r = await getVariableTxFilterOptions({ db });
    expect(r.categories).toEqual([{ id: 'c1', name: 'Alimentação' }]);
    expect(r.accounts).toEqual([{ id: 'a1', name: 'Millennium' }]);
    expect(r.cards).toEqual([{ id: 'k1', name: 'Visa' }]);
    expect(execute).toHaveBeenCalledTimes(3);
  });

  it('(7) sem opções → arrays vazios', async () => {
    const execute = vi
      .fn()
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([]);
    const r = await getVariableTxFilterOptions({ db: { execute } as unknown as DbShim });
    expect(r.categories).toEqual([]);
    expect(r.accounts).toEqual([]);
    expect(r.cards).toEqual([]);
  });
});
