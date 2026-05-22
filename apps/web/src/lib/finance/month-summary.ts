/**
 * Helper de agregação da vista "Este mês" — leitura real do mês (Story 4.6
 * AC3, AC8, D-4.6.7).
 *
 * Função pura de leitura: recebe `db` injectável (padrão `listTasksHelper` da
 * Story 3.3) — testável sem Postgres real. Reutilizável pela tool
 * `query_finance_summary` (Story 4.10, DP5).
 *
 * Invariante crítico (R-4.10, AC8): os totais NUNCA misturam sinais. O valor
 * `amount_cents` é sempre positivo; o sinal lógico vem de `kind`. Todas as
 * somas usam `FILTER (WHERE kind = ...)`. `transfer` é movimento interno do
 * household — NUNCA entra em entrado/saído/saldo (D-4.6.5).
 *
 * Trace: Story 4.6 AC3, AC8, D-4.6.5, D-4.6.7; finance.ts (transactions).
 */
import { sql } from 'drizzle-orm';

import type { DbShim } from '@/lib/agent/db-shim';

export type FinanceKind = 'expense' | 'income' | 'transfer';

export interface MonthSummaryInput {
  /** Cliente Drizzle RLS-scoped (`getDb()`) — injectado pelo RSC. */
  readonly db: DbShim;
  /** Primeiro dia do mês visualizado — YYYY-MM-DD. */
  readonly monthStart: string;
  /** Último dia do mês visualizado — YYYY-MM-DD. */
  readonly monthEnd: string;
}

export interface CategoryBreakdownRow {
  readonly categoryId: string | null;
  readonly categoryName: string;
  readonly kind: FinanceKind;
  readonly totalCents: number;
  readonly txCount: number;
}

export interface DayBreakdownRow {
  readonly day: string;
  readonly expenseCents: number;
  readonly incomeCents: number;
}

export interface MonthSummary {
  readonly totalIncomeCents: number;
  readonly totalExpenseCents: number;
  /** Income − Expense (transfer excluído — D-4.6.5). Pode ser negativo. */
  readonly netCents: number;
  /** Ordenado por `totalCents` desc. */
  readonly byCategory: readonly CategoryBreakdownRow[];
  /** Um row por dia com movimento, ordenado por data asc. */
  readonly byDay: readonly DayBreakdownRow[];
}

interface TotalsRow {
  total_income_cents: number;
  total_expense_cents: number;
}

interface CategoryRow {
  category_id: string | null;
  category_name: string;
  kind: FinanceKind;
  total_cents: number;
  tx_count: number;
}

interface DayRow {
  day: string;
  expense_cents: number;
  income_cents: number;
}

/**
 * Agrega as transacções reais (`is_projected = false`) do mês `[monthStart,
 * monthEnd]`: totais por `kind`, breakdown por categoria e por dia.
 */
export async function getMonthSummary({
  db,
  monthStart,
  monthEnd,
}: MonthSummaryInput): Promise<MonthSummary> {
  const [totalsRows, categoryRows, dayRows] = await Promise.all([
    db.execute<TotalsRow>(sql`
      select
        coalesce(sum(amount_cents) filter (where kind = 'income'), 0)::int  as total_income_cents,
        coalesce(sum(amount_cents) filter (where kind = 'expense'), 0)::int as total_expense_cents
      from public.transactions
      where transaction_date >= ${monthStart}::date
        and transaction_date <= ${monthEnd}::date
        and is_projected = false
    `),
    db.execute<CategoryRow>(sql`
      select
        t.category_id,
        coalesce(c.name, 'Sem categoria') as category_name,
        t.kind,
        sum(t.amount_cents)::int as total_cents,
        count(*)::int as tx_count
      from public.transactions t
      left join public.categories c on c.id = t.category_id
      where t.transaction_date >= ${monthStart}::date
        and t.transaction_date <= ${monthEnd}::date
        and t.is_projected = false
      group by t.category_id, c.name, t.kind
      order by total_cents desc
    `),
    db.execute<DayRow>(sql`
      select
        transaction_date::text as day,
        coalesce(sum(amount_cents) filter (where kind = 'expense'), 0)::int as expense_cents,
        coalesce(sum(amount_cents) filter (where kind = 'income'), 0)::int  as income_cents
      from public.transactions
      where transaction_date >= ${monthStart}::date
        and transaction_date <= ${monthEnd}::date
        and is_projected = false
      group by transaction_date
      order by transaction_date asc
    `),
  ]);

  const totals = totalsRows[0] ?? { total_income_cents: 0, total_expense_cents: 0 };
  const totalIncomeCents = totals.total_income_cents;
  const totalExpenseCents = totals.total_expense_cents;

  return {
    totalIncomeCents,
    totalExpenseCents,
    netCents: totalIncomeCents - totalExpenseCents,
    byCategory: categoryRows.map((r) => ({
      categoryId: r.category_id,
      categoryName: r.category_name,
      kind: r.kind,
      totalCents: r.total_cents,
      txCount: r.tx_count,
    })),
    byDay: dayRows.map((r) => ({
      day: r.day,
      expenseCents: r.expense_cents,
      incomeCents: r.income_cents,
    })),
  };
}
