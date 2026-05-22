/**
 * Helper de agregação da vista "Cartões" — fatura on-the-fly por ciclo
 * (Story 4.8 AC3, D-4.8.3, D-4.8.6).
 *
 * `getCardStatements` é `db`-injectável (padrão D-4.6.7) — testável sem
 * Postgres. Faz 4 queries fixas (cartões; transacções dos cartões numa janela
 * ampla; prestações; progresso das prestações) e faz o bucketing por ciclo
 * em JS — SEM N+1 independentemente do número de cartões (D-4.8.3). O
 * household scoping é feito pela RLS (`getDb()` authenticated).
 *
 * Total da fatura = `SUM(expense) − SUM(income)`; `transfer` excluído
 * (D-4.8.6, coerente com R-4.10 do epic).
 *
 * Trace: Story 4.8 AC3, D-4.8.3, D-4.8.6; DP7=A (fatura on-the-fly).
 */
import { sql } from 'drizzle-orm';
import { addMonths, formatISO, parseISO, subMonths } from 'date-fns';

import type { DbShim } from '@/lib/agent/db-shim';
import {
  calcStatementCycle,
  type StatementCycle,
} from '@/lib/finance/card-statement-helpers';
import type { FinanceKind } from '@/lib/finance/month-summary';

/** Janela de fetch de transacções — folga sobre o ciclo corrente + próximo. */
const FETCH_WINDOW_MONTHS = 2;

export type CardType = 'credit' | 'debit';

export interface CardInstallment {
  readonly id: string;
  readonly description: string;
  readonly perInstallmentCents: number;
  readonly totalAmountCents: number;
  readonly numInstallments: number;
  /** Parcelas já decorridas (`transaction_date <= today`). */
  readonly paidCount: number;
}

export interface CardStatementData {
  readonly id: string;
  readonly name: string;
  readonly last4: string | null;
  readonly cardType: CardType;
  readonly accountName: string;
  /** `null` = cartão sem ciclo de fatura (débito, ou crédito sem closing/due — D-4.8.4). */
  readonly cycle: StatementCycle | null;
  readonly currentTotalCents: number;
  readonly nextTotalCents: number;
  readonly installments: readonly CardInstallment[];
}

interface CardRow {
  id: string;
  name: string;
  last4: string | null;
  card_type: CardType;
  closing_day: number | null;
  due_day: number | null;
  account_name: string;
}

interface TxRow {
  card_id: string;
  transaction_date: string;
  kind: FinanceKind;
  amount_cents: number;
}

interface InstallmentRow {
  id: string;
  card_id: string;
  description: string;
  per_installment_cents: number;
  total_amount_cents: number;
  num_installments: number;
}

interface ProgressRow {
  installment_id: string;
  paid_count: number;
}

/** Soma as transacções de uma janela `[start, end]` (inclusiva) — D-4.8.6. */
function sumWindow(txs: readonly TxRow[], start: string, end: string): number {
  let total = 0;
  for (const t of txs) {
    if (t.transaction_date < start || t.transaction_date > end) continue;
    if (t.kind === 'expense') total += t.amount_cents;
    else if (t.kind === 'income') total -= t.amount_cents;
    // `transfer` é ignorado (D-4.8.6).
  }
  return total;
}

/**
 * Agrega, por cartão do household, a fatura corrente e a próxima (calculadas
 * on-the-fly do ciclo `closing_day`/`due_day`) e as prestações associadas.
 */
export async function getCardStatements({
  db,
  today,
}: {
  db: DbShim;
  today: string;
}): Promise<{ cards: readonly CardStatementData[] }> {
  const windowStart = formatISO(subMonths(parseISO(today), FETCH_WINDOW_MONTHS), {
    representation: 'date',
  });
  const windowEnd = formatISO(addMonths(parseISO(today), FETCH_WINDOW_MONTHS), {
    representation: 'date',
  });

  const [cardRows, txRows, installmentRows, progressRows] = await Promise.all([
    db.execute<CardRow>(sql`
      select
        c.id, c.name, c.last4, c.card_type, c.closing_day, c.due_day,
        coalesce(a.name, '—') as account_name
      from public.cards c
      left join public.accounts a on a.id = c.account_id
      where c.archived_at is null
      order by c.name asc
    `),
    db.execute<TxRow>(sql`
      select
        card_id,
        transaction_date::text as transaction_date,
        kind,
        amount_cents::int as amount_cents
      from public.transactions
      where card_id is not null
        and transaction_date >= ${windowStart}::date
        and transaction_date <= ${windowEnd}::date
    `),
    db.execute<InstallmentRow>(sql`
      select
        id, card_id, description,
        per_installment_cents::int as per_installment_cents,
        total_amount_cents::int as total_amount_cents,
        num_installments::int as num_installments
      from public.installments
      order by purchased_on desc
    `),
    db.execute<ProgressRow>(sql`
      select installment_id, count(*)::int as paid_count
      from public.transactions
      where installment_id is not null
        and transaction_date <= ${today}::date
      group by installment_id
    `),
  ]);

  const progressMap = new Map(progressRows.map((p) => [p.installment_id, p.paid_count]));

  const installmentsByCard = new Map<string, CardInstallment[]>();
  for (const r of installmentRows) {
    const list = installmentsByCard.get(r.card_id) ?? [];
    list.push({
      id: r.id,
      description: r.description,
      perInstallmentCents: r.per_installment_cents,
      totalAmountCents: r.total_amount_cents,
      numInstallments: r.num_installments,
      paidCount: progressMap.get(r.id) ?? 0,
    });
    installmentsByCard.set(r.card_id, list);
  }

  const txByCard = new Map<string, TxRow[]>();
  for (const t of txRows) {
    const list = txByCard.get(t.card_id) ?? [];
    list.push(t);
    txByCard.set(t.card_id, list);
  }

  const cards: CardStatementData[] = cardRows.map((c) => {
    // D-4.8.4 — só há ciclo se `closing_day` E `due_day` forem não-NULL.
    const cycle =
      c.closing_day !== null && c.due_day !== null
        ? calcStatementCycle(c.closing_day, c.due_day, today)
        : null;

    let currentTotalCents = 0;
    let nextTotalCents = 0;
    if (cycle) {
      const txs = txByCard.get(c.id) ?? [];
      currentTotalCents = sumWindow(txs, cycle.currentCycleStart, cycle.currentCycleEnd);
      nextTotalCents = sumWindow(txs, cycle.nextCycleStart, cycle.nextCycleEnd);
    }

    return {
      id: c.id,
      name: c.name,
      last4: c.last4,
      cardType: c.card_type,
      accountName: c.account_name,
      cycle,
      currentTotalCents,
      nextTotalCents,
      installments: installmentsByCard.get(c.id) ?? [],
    };
  });

  return { cards };
}
