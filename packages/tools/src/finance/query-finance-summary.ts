/**
 * Tool `query_finance_summary` — consulta read-only do sumário financeiro
 * do mês (totais income/expense + topCategories + netWorth opcional).
 *
 * Domínio: `finance`. Tool **read-only** — produz row inerte em
 * `agent_reverse_ops` com `table='_noop'` (R1b v1.1 da Story 3.8).
 *
 * Scope (Story 4.10 AC5):
 *   - `monthAnchor` opcional (default = hoje) — qualquer dia do mês a consultar
 *   - `includeNetWorth` opcional (default true)
 *
 * Implementação (D-4.10.5 com PO_FIX_INLINE F5):
 *   - `computeMonthBounds(anchor)` produz `{ monthStart, monthEnd }`.
 *   - Cross-package: o package `@meu-jarvis/tools` NÃO pode importar de
 *     `apps/web/src/lib/finance/` (boundary). Replicamos as queries SQL inline
 *     (cópia controlada, espelha as queries de `getMonthSummary` e
 *     `getAccountBalances` exactamente — D-4.10.5 mantém o INVARIANTE de
 *     consistência calculatória com a UI; qualquer mudança na fórmula nas
 *     Stories 4.6/4.9 obriga a actualizar aqui também).
 *   - `topCategories` derivado de byCategory filtered por kind='expense' +
 *     slice(0, 5).
 *
 * Trace: Story 4.10 AC5 + DP-4.10.B (parametrizado) + D-4.10.3 (sentinela _noop) +
 *        D-4.10.5 (reuse calculatório com helpers 4.6/4.9) + PO_FIX_INLINE F5.
 */
import { randomUUID } from 'node:crypto';

import { sql } from 'drizzle-orm';
import { z } from 'zod';

import type {
  ReverseOpPayload,
  ToolDefinition,
  ToolExecutionContext,
} from '../contracts';
import { computeMonthBounds } from './_helpers/month-bounds';

const QueryFinanceSummaryInputSchema = z.object({
  monthAnchor: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, 'monthAnchor deve estar no formato YYYY-MM-DD')
    .optional(),
  includeNetWorth: z.boolean().optional(),
});

export type QueryFinanceSummaryInput = z.infer<typeof QueryFinanceSummaryInputSchema>;

const TopCategorySchema = z.object({
  categoryId: z.string().uuid().nullable(),
  categoryName: z.string(),
  totalCents: z.number().int(),
});

const QueryFinanceSummaryOutputSchema = z.object({
  monthAnchor: z.string(),
  totalIncomeCents: z.number().int(),
  totalExpenseCents: z.number().int(),
  netCents: z.number().int(),
  topCategories: z.array(TopCategorySchema).max(5),
  netWorthCents: z.number().int().nullable(),
  accountCount: z.number().int().nonnegative(),
});

export type QueryFinanceSummaryOutput = z.infer<
  typeof QueryFinanceSummaryOutputSchema
>;

interface TotalsRow {
  readonly total_income_cents: number;
  readonly total_expense_cents: number;
}

interface CategoryRow {
  readonly category_id: string | null;
  readonly category_name: string;
  readonly kind: 'expense' | 'income' | 'transfer';
  readonly total_cents: number;
}

interface AccountRow {
  readonly id: string;
  readonly initial_balance_cents: number;
}

interface SumRow {
  readonly account_id: string;
  readonly income_cents: number;
  readonly expense_cents: number;
}

const MONTH_NAMES_PT = [
  'janeiro',
  'fevereiro',
  'março',
  'abril',
  'maio',
  'junho',
  'julho',
  'agosto',
  'setembro',
  'outubro',
  'novembro',
  'dezembro',
];

function todayIsoDate(): string {
  // Determinístico em UTC — para preview e default. O cálculo do mês usa
  // exclusivamente strings YYYY-MM-DD, não Date objects.
  const now = new Date();
  const y = now.getUTCFullYear();
  const m = now.getUTCMonth() + 1;
  const d = now.getUTCDate();
  const pad2 = (n: number): string => (n < 10 ? `0${String(n)}` : String(n));
  return `${String(y)}-${pad2(m)}-${pad2(d)}`;
}

function monthLabelPt(anchor: string): string {
  const [yearStr, monthStr] = anchor.split('-');
  const year = Number(yearStr ?? '0');
  const monthIdx = Number(monthStr ?? '1') - 1;
  const monthName = MONTH_NAMES_PT[monthIdx] ?? 'mês';
  return `${monthName} de ${String(year)}`;
}

export const queryFinanceSummary: ToolDefinition<
  QueryFinanceSummaryInput,
  QueryFinanceSummaryOutput
> = {
  name: 'query_finance_summary',
  domain: 'finance',
  description:
    'Usa esta tool quando o utilizador quer consultar o sumário financeiro do mês (totais de receita/despesa, top categorias de gastos, património opcional). Aceita monthAnchor opcional (qualquer dia do mês — default hoje) e includeNetWorth opcional (default true).',
  inputSchema: QueryFinanceSummaryInputSchema,
  outputSchema: QueryFinanceSummaryOutputSchema,
  estimatedTokens: 120,

  preview(input) {
    const anchor = input.monthAnchor ?? todayIsoDate();
    return `Consultar sumário financeiro de ${monthLabelPt(anchor)}`;
  },

  async execute(input, ctx: ToolExecutionContext): Promise<QueryFinanceSummaryOutput> {
    const monthAnchor = input.monthAnchor ?? todayIsoDate();
    const { monthStart, monthEnd } = computeMonthBounds(monthAnchor);
    const includeNetWorth = input.includeNetWorth !== false;

    // ─── Totais do mês ────────────────────────────────────────────────────
    // Replicado de `apps/web/src/lib/finance/month-summary.ts:85-93` —
    // boundary cross-package proíbe import directo. RLS via ctx.db filtra
    // automaticamente por household.
    const totalsRows = (await ctx.db.execute(sql`
      select
        coalesce(sum(amount_cents) filter (where kind = 'income'), 0)::int  as total_income_cents,
        coalesce(sum(amount_cents) filter (where kind = 'expense'), 0)::int as total_expense_cents
      from transactions
      where transaction_date >= ${monthStart}::date
        and transaction_date <= ${monthEnd}::date
        and is_projected = false
    `)) as ReadonlyArray<TotalsRow>;

    const totals = totalsRows[0] ?? { total_income_cents: 0, total_expense_cents: 0 };

    // ─── Breakdown por categoria (filtrar para 'expense' top 5 — D-4.10.5)
    const categoryRows = (await ctx.db.execute(sql`
      select
        t.category_id,
        coalesce(c.name, 'Sem categoria') as category_name,
        t.kind,
        sum(t.amount_cents)::int as total_cents
      from transactions t
      left join categories c on c.id = t.category_id
      where t.transaction_date >= ${monthStart}::date
        and t.transaction_date <= ${monthEnd}::date
        and t.is_projected = false
        and t.kind = 'expense'
      group by t.category_id, c.name, t.kind
      order by total_cents desc
      limit 5
    `)) as ReadonlyArray<CategoryRow>;

    const topCategories = categoryRows.map((r) => ({
      categoryId: r.category_id,
      categoryName: r.category_name,
      totalCents: r.total_cents,
    }));

    // ─── Net Worth (opcional) ─────────────────────────────────────────────
    let netWorthCents: number | null = null;
    let accountCount = 0;
    if (includeNetWorth) {
      // Replicado de `apps/web/src/lib/finance/account-balances.ts:91-111`.
      const accountRows = (await ctx.db.execute(sql`
        select id, initial_balance_cents::int as initial_balance_cents
        from accounts
        where archived_at is null
      `)) as ReadonlyArray<AccountRow>;

      const sumRows = (await ctx.db.execute(sql`
        select
          account_id,
          coalesce(sum(amount_cents) filter (where kind = 'income'), 0)::int as income_cents,
          coalesce(sum(amount_cents) filter (where kind = 'expense'), 0)::int as expense_cents
        from transactions
        where account_id is not null
          and is_projected = false
        group by account_id
      `)) as ReadonlyArray<SumRow>;

      const sumByAccount = new Map<string, { income: number; expense: number }>();
      for (const s of sumRows) {
        sumByAccount.set(s.account_id, {
          income: s.income_cents,
          expense: s.expense_cents,
        });
      }

      let total = 0;
      for (const acc of accountRows) {
        const sums = sumByAccount.get(acc.id);
        const income = sums?.income ?? 0;
        const expense = sums?.expense ?? 0;
        total += acc.initial_balance_cents + income - expense;
      }
      netWorthCents = total;
      accountCount = accountRows.length;
    }

    return {
      monthAnchor,
      totalIncomeCents: totals.total_income_cents,
      totalExpenseCents: totals.total_expense_cents,
      netCents: totals.total_income_cents - totals.total_expense_cents,
      topCategories,
      netWorthCents,
      accountCount,
    };
  },

  /**
   * Sentinela inerte `_noop` (pattern Story 3.8 R1b).
   *
   * Tool read-only — FR6 undo conceptualmente não-aplicável. `executeAtomic`
   * força persistência de uma row em `agent_reverse_ops`; usamos `table='_noop'`
   * + UUID válido para satisfazer `ReverseOpDeleteRowSchema` sem permitir
   * undo real. Endpoint `/undo` (Task T11) responde 410 Gone para `_noop`.
   */
  async reverse(): Promise<ReverseOpPayload> {
    return {
      kind: 'delete_row',
      table: '_noop',
      id: randomUUID(),
    };
  },
};
