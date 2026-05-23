// @vitest-environment node
/**
 * Tests — helper de agregação da vista "Património" (Story 4.9 AC7, AC2).
 *
 * `db` injectável. 2 `execute` em ordem fixa: contas, somas por conta+kind.
 * Padrão herdado de `list-card-statements.test.ts` (Story 4.8).
 *
 * Testa todos os recortes da D-4.9.1/2/3/4/5/6: base = initial_balance_cents
 * (não balance_cents), `transfer` ignorado, `is_projected=true` ignorado (na
 * query SQL — testes validam que o helper agrega correctamente o que recebe),
 * agrupamento por banco com grupo "Sem banco" no fim, saldos negativos
 * (descoberto) suportados.
 */
import { describe, expect, it, vi } from 'vitest';

import type { DbShim } from '@/lib/agent/db-shim';
import { getAccountBalances } from '@/lib/finance/account-balances';

/** `db` falso — 2 `execute` em ordem: contas, somas. */
function fakeDb(accounts: unknown[], sums: unknown[]): DbShim {
  const execute = vi
    .fn()
    .mockResolvedValueOnce(accounts)
    .mockResolvedValueOnce(sums);
  return { execute } as unknown as DbShim;
}

function account(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 'acc-1',
    name: 'Conta Principal',
    account_type: 'corrente',
    bank_name: 'Millennium BCP',
    iban_last4: '1234',
    initial_balance_cents: 100000,
    ...overrides,
  };
}

function sumsFor(
  accountId: string,
  income: number,
  expense: number,
): Record<string, unknown> {
  return { account_id: accountId, income_cents: income, expense_cents: expense };
}

describe('getAccountBalances', () => {
  it('(1) zero contas → groups [], totalCents 0, accountCount 0', async () => {
    const r = await getAccountBalances({ db: fakeDb([], []) });
    expect(r.groups).toEqual([]);
    expect(r.totalCents).toBe(0);
    expect(r.accountCount).toBe(0);
  });

  it('(2) uma conta sem transacções → balance = initial', async () => {
    const r = await getAccountBalances({
      db: fakeDb([account({ initial_balance_cents: 100000 })], []),
    });
    expect(r.totalCents).toBe(100000);
    expect(r.groups).toHaveLength(1);
    expect(r.groups[0]?.accounts[0]?.balanceCents).toBe(100000);
    expect(r.groups[0]?.accounts[0]?.incomeCents).toBe(0);
    expect(r.groups[0]?.accounts[0]?.expenseCents).toBe(0);
  });

  it('(3) saldo positivo — D-4.9.1 — balance = initial + income − expense', async () => {
    // initial 100000 + income 250000 − expense (34000+7870)=41870 → 308130
    const r = await getAccountBalances({
      db: fakeDb(
        [account({ initial_balance_cents: 100000 })],
        [sumsFor('acc-1', 250000, 41870)],
      ),
    });
    expect(r.groups[0]?.accounts[0]?.balanceCents).toBe(308130);
    expect(r.totalCents).toBe(308130);
  });

  it('(4) saldo NEGATIVO (descoberto) — D-4.9.8 — balance pode ser negativo', async () => {
    // initial 10000 + income 5000 − expense 20000 → -5000
    const r = await getAccountBalances({
      db: fakeDb(
        [account({ initial_balance_cents: 10000 })],
        [sumsFor('acc-1', 5000, 20000)],
      ),
    });
    expect(r.groups[0]?.accounts[0]?.balanceCents).toBe(-5000);
    expect(r.totalCents).toBe(-5000);
  });

  it('(5) D-4.9.2 — transfer NÃO está nas somas recebidas (query filtra por kind income/expense)', async () => {
    // A query SQL produz apenas income_cents e expense_cents — transfer não
    // pode aparecer nas SumRows. Helper soma o que recebe. Validamos que o
    // helper NÃO somaria transfer mesmo se chegasse no payload (já que só
    // lê income_cents/expense_cents). initial=100, income=50, expense=10 → 140.
    const r = await getAccountBalances({
      db: fakeDb(
        [account({ initial_balance_cents: 100 })],
        [sumsFor('acc-1', 50, 10)],
      ),
    });
    expect(r.groups[0]?.accounts[0]?.balanceCents).toBe(140);
    // O contrato é: o helper NÃO lê quaisquer `transfer_cents` — não existem.
    expect(r.groups[0]?.accounts[0]).not.toHaveProperty('transferCents');
  });

  it('(6) D-4.9.3 — só conta com somas (representa is_projected=false agregado pela query); conta sem somas → saldo = initial', async () => {
    // Acc-A com somas, Acc-B sem somas (representa caso em que todas as
    // transacções desta conta são is_projected=true ou simplesmente não há
    // transacções reais). Acc-B balance = initial puro.
    const r = await getAccountBalances({
      db: fakeDb(
        [
          account({ id: 'acc-A', name: 'A', initial_balance_cents: 5000 }),
          account({ id: 'acc-B', name: 'B', initial_balance_cents: 3000 }),
        ],
        [sumsFor('acc-A', 1000, 500)],
      ),
    });
    const flat = r.groups.flatMap((g) => g.accounts);
    const a = flat.find((x) => x.id === 'acc-A');
    const b = flat.find((x) => x.id === 'acc-B');
    expect(a?.balanceCents).toBe(5500); // 5000 + 1000 − 500
    expect(b?.balanceCents).toBe(3000); // initial puro (sem income/expense reais)
  });

  it('(7) D-4.9.6 — agrupamento por banco; grupo "Sem banco" (bank_name NULL) por ÚLTIMO', async () => {
    const r = await getAccountBalances({
      db: fakeDb(
        [
          account({ id: 'a1', name: 'C1', bank_name: 'Caixa Geral', initial_balance_cents: 1000 }),
          account({ id: 'a2', name: 'C2', bank_name: null, initial_balance_cents: 500 }),
          account({ id: 'a3', name: 'C3', bank_name: 'BPI', initial_balance_cents: 2000 }),
        ],
        [],
      ),
    });
    expect(r.groups).toHaveLength(3);
    expect(r.groups[0]?.bankName).toBe('BPI');
    expect(r.groups[1]?.bankName).toBe('Caixa Geral');
    expect(r.groups[r.groups.length - 1]?.bankName).toBeNull(); // Sem banco por último
  });

  it('(8) subtotalCents por grupo + totalCents global correctos', async () => {
    const r = await getAccountBalances({
      db: fakeDb(
        [
          account({ id: 'a1', name: 'C1', bank_name: 'BPI', initial_balance_cents: 1000 }),
          account({ id: 'a2', name: 'C2', bank_name: 'BPI', initial_balance_cents: 500 }),
          account({ id: 'a3', name: 'C3', bank_name: 'Millennium BCP', initial_balance_cents: 2000 }),
        ],
        [
          sumsFor('a1', 100, 0),
          sumsFor('a3', 0, 500),
        ],
      ),
    });
    // BPI: (1000+100) + (500+0) = 1600. Millennium: (2000-500) = 1500. Total 3100.
    const bpi = r.groups.find((g) => g.bankName === 'BPI');
    const mil = r.groups.find((g) => g.bankName === 'Millennium BCP');
    expect(bpi?.subtotalCents).toBe(1600);
    expect(mil?.subtotalCents).toBe(1500);
    expect(r.totalCents).toBe(3100);
    expect(r.accountCount).toBe(3);
  });

  it('(9) contas dentro de um grupo ordenadas por nome PT-PT case-insensitive', async () => {
    const r = await getAccountBalances({
      db: fakeDb(
        [
          account({ id: 'a1', name: 'Zebra', bank_name: 'BPI', initial_balance_cents: 0 }),
          account({ id: 'a2', name: 'álamo', bank_name: 'BPI', initial_balance_cents: 0 }),
          account({ id: 'a3', name: 'Mediana', bank_name: 'BPI', initial_balance_cents: 0 }),
        ],
        [],
      ),
    });
    expect(r.groups[0]?.accounts.map((a) => a.name)).toEqual(['álamo', 'Mediana', 'Zebra']);
  });
});
