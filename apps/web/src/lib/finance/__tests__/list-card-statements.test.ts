// @vitest-environment node
/**
 * Tests — helper de agregação da vista "Cartões" (Story 4.8 AC7, AC3).
 *
 * `db` injectável. 4 `execute` em ordem fixa: cartões, transacções,
 * prestações, progresso. `calcStatementCycle` NÃO é mockado — a aritmética
 * real é usada.
 *
 * `today` fixo em 2026-05-22; um cartão closingDay=15/dueDay=5 tem fatura
 * corrente [2026-05-16, 2026-06-15] e próxima [2026-06-16, 2026-07-15].
 */
import { describe, expect, it, vi } from 'vitest';

import type { DbShim } from '@/lib/agent/db-shim';
import { getCardStatements } from '@/lib/finance/list-card-statements';
import { boundParamValues } from '@/lib/finance/__tests__/_sql-bound-params';

const TODAY = '2026-05-22';
const HOUSEHOLD_ID = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';

/** `db` falso — 4 `execute` em ordem: cartões, tx, prestações, progresso. */
function fakeDb(
  cards: unknown[],
  txs: unknown[],
  installments: unknown[],
  progress: unknown[],
): DbShim {
  const execute = vi
    .fn()
    .mockResolvedValueOnce(cards)
    .mockResolvedValueOnce(txs)
    .mockResolvedValueOnce(installments)
    .mockResolvedValueOnce(progress);
  return { execute } as unknown as DbShim;
}

/** Atalho — injecta `today` + `householdId` autenticado nos call sites. */
function statementsOf(
  cards: unknown[],
  txs: unknown[],
  installments: unknown[],
  progress: unknown[],
) {
  return getCardStatements({
    db: fakeDb(cards, txs, installments, progress),
    today: TODAY,
    householdId: HOUSEHOLD_ID,
  });
}

function creditCard(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 'card-1',
    name: 'Millennium',
    last4: '1234',
    card_type: 'credit',
    closing_day: 15,
    due_day: 5,
    account_name: 'Millennium BCP',
    ...overrides,
  };
}

function tx(date: string, kind: string, amount: number): Record<string, unknown> {
  return { card_id: 'card-1', transaction_date: date, kind, amount_cents: amount };
}

describe('getCardStatements', () => {
  it('(1) zero cartões → cards []', async () => {
    const r = await statementsOf([], [], [], []);
    expect(r.cards).toEqual([]);
  });

  it('(2) cartão de crédito → totais somados das janelas corrente e próxima', async () => {
    const r = await statementsOf(
      [creditCard()],
      [
        tx('2026-05-20', 'expense', 10000), // janela corrente
        tx('2026-06-20', 'expense', 5000), // janela próxima
      ],
      [],
      [],
    );
    expect(r.cards[0]?.currentTotalCents).toBe(10000);
    expect(r.cards[0]?.nextTotalCents).toBe(5000);
    expect(r.cards[0]?.cycle).not.toBeNull();
  });

  it('(3) FRONTEIRA D-4.8.1 — transacção no closing_day entra na fatura que fecha', async () => {
    // currentCycleEnd = 2026-06-15; uma tx nessa data conta na fatura corrente.
    const r = await statementsOf([creditCard()], [tx('2026-06-15', 'expense', 8000)], [], []);
    expect(r.cards[0]?.currentTotalCents).toBe(8000);
  });

  it('(4) cartão de débito (closing_day null) → sem ciclo, totais 0', async () => {
    const r = await statementsOf(
      [creditCard({ id: 'card-d', card_type: 'debit', closing_day: null, due_day: null })],
      [{ card_id: 'card-d', transaction_date: '2026-05-20', kind: 'expense', amount_cents: 9999 }],
      [],
      [],
    );
    expect(r.cards[0]?.cycle).toBeNull();
    expect(r.cards[0]?.currentTotalCents).toBe(0);
    expect(r.cards[0]?.nextTotalCents).toBe(0);
  });

  it('(5) total exclui transfer; income subtrai (D-4.8.6)', async () => {
    const r = await statementsOf(
      [creditCard()],
      [
        tx('2026-05-20', 'expense', 10000),
        tx('2026-05-21', 'income', 3000), // reembolso → subtrai
        tx('2026-05-21', 'transfer', 99999), // ignorado
      ],
      [],
      [],
    );
    expect(r.cards[0]?.currentTotalCents).toBe(7000); // 10000 − 3000
  });

  it('(6) prestações anexadas com paidCount do progresso', async () => {
    const r = await statementsOf(
      [creditCard()],
      [],
      [
        {
          id: 'inst-1',
          card_id: 'card-1',
          description: 'Portátil',
          per_installment_cents: 10000,
          total_amount_cents: 120000,
          num_installments: 12,
        },
      ],
      [{ installment_id: 'inst-1', paid_count: 3 }],
    );
    expect(r.cards[0]?.installments).toHaveLength(1);
    expect(r.cards[0]?.installments[0]).toMatchObject({
      description: 'Portátil',
      numInstallments: 12,
      paidCount: 3,
    });
  });

  it('(7) SEC-4 AC7 — household_id é parâmetro bound nas 4 queries (incl. installments, novo WHERE)', async () => {
    const execute = vi.fn().mockResolvedValue([]);
    const db = { execute } as unknown as DbShim;
    await getCardStatements({ db, today: TODAY, householdId: HOUSEHOLD_ID });

    // 4 queries: cartões (0), transacções (1), prestações (2), progresso (3).
    expect(execute).toHaveBeenCalledTimes(4);
    const [cardsSql, txSql, installmentsSql, progressSql] = [
      execute.mock.calls[0]?.[0],
      execute.mock.calls[1]?.[0],
      execute.mock.calls[2]?.[0],
      execute.mock.calls[3]?.[0],
    ];
    // PO-OBS-2 — assert mais que uma query; installments ganha WHERE totalmente
    // novo (o ponto mais propenso a esquecimento).
    expect(boundParamValues(cardsSql)).toContain(HOUSEHOLD_ID);
    expect(boundParamValues(txSql)).toContain(HOUSEHOLD_ID);
    expect(boundParamValues(installmentsSql)).toContain(HOUSEHOLD_ID);
    expect(boundParamValues(progressSql)).toContain(HOUSEHOLD_ID);
  });
});
