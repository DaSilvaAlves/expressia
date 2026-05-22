/**
 * Helper de listagem das transacções variáveis — vista "Variáveis"
 * (Story 4.7 AC2, D-4.7.2, D-4.7.5).
 *
 * Função pura de leitura: recebe `db` injectável (padrão `month-summary.ts` da
 * Story 4.6, D-4.6.7) — testável sem Postgres real.
 *
 * D-4.7.2 — "Variáveis" = transacções manuais: `recurrence_id IS NULL AND
 * installment_id IS NULL` (equivalente a `origin=manual` da API 4.3).
 * Transacções geradas pelo cron/prestações não aparecem nesta vista.
 *
 * Paginação keyset reutiliza `encode/decodeTransactionCursor` da Story 4.3
 * (`@/lib/api-schemas/transactions`) — order `transaction_date desc, id desc`.
 *
 * Trace: Story 4.7 AC2, D-4.7.2, D-4.7.4, D-4.7.5; API 4.3 `transacoes`.
 */
import { sql } from 'drizzle-orm';

import type { DbShim } from '@/lib/agent/db-shim';
import {
  decodeTransactionCursor,
  encodeTransactionCursor,
} from '@/lib/api-schemas/transactions';
import type { FinanceKind } from '@/lib/finance/month-summary';

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 100;

export interface VariableTxFilters {
  readonly from?: string;
  readonly to?: string;
  readonly categoryId?: string;
  readonly accountId?: string;
  readonly cardId?: string;
  readonly kind?: FinanceKind;
  readonly cursor?: string | null;
  readonly limit?: number;
}

export interface VariableTxRow {
  readonly id: string;
  readonly transactionDate: string;
  readonly description: string;
  readonly kind: FinanceKind;
  readonly amountCents: number;
  readonly categoryName: string;
  readonly accountOrCardLabel: string;
}

export interface VariableTxPage {
  readonly rows: readonly VariableTxRow[];
  readonly nextCursor: string | null;
}

interface TxQueryRow {
  id: string;
  transaction_date: string;
  description: string;
  kind: FinanceKind;
  amount_cents: number;
  category_name: string;
  account_or_card_label: string;
}

/**
 * Lista transacções variáveis (`origin=manual`) do household, com filtros e
 * paginação keyset. Apenas transacções reais (`is_projected = false`).
 */
export async function listVariableTransactions({
  db,
  filters,
}: {
  db: DbShim;
  filters: VariableTxFilters;
}): Promise<VariableTxPage> {
  const limit = Math.min(Math.max(filters.limit ?? DEFAULT_LIMIT, 1), MAX_LIMIT);

  const conditions = [
    sql`t.recurrence_id is null`,
    sql`t.installment_id is null`,
    sql`t.is_projected = false`,
  ];
  if (filters.from) conditions.push(sql`t.transaction_date >= ${filters.from}::date`);
  if (filters.to) conditions.push(sql`t.transaction_date <= ${filters.to}::date`);
  if (filters.categoryId) conditions.push(sql`t.category_id = ${filters.categoryId}::uuid`);
  if (filters.accountId) conditions.push(sql`t.account_id = ${filters.accountId}::uuid`);
  if (filters.cardId) conditions.push(sql`t.card_id = ${filters.cardId}::uuid`);
  if (filters.kind) conditions.push(sql`t.kind = ${filters.kind}::transaction_kind`);

  // Keyset cursor — order `transaction_date desc, id desc` (reusa Story 4.3).
  const cursor = filters.cursor ? decodeTransactionCursor(filters.cursor) : null;
  if (cursor) {
    conditions.push(sql`(
      t.transaction_date < ${cursor.last_transaction_date}::date
      or (t.transaction_date = ${cursor.last_transaction_date}::date and t.id < ${cursor.last_id}::uuid)
    )`);
  }

  const whereSql = conditions.reduce((acc, c, idx) => (idx === 0 ? c : sql`${acc} and ${c}`));

  // limit + 1 — a row extra sinaliza que há próxima página.
  const queryRows = await db.execute<TxQueryRow>(sql`
    select
      t.id,
      t.transaction_date::text as transaction_date,
      t.description,
      t.kind,
      t.amount_cents::int as amount_cents,
      coalesce(c.name, 'Sem categoria') as category_name,
      coalesce(a.name, ca.name, '—') as account_or_card_label
    from public.transactions t
    left join public.categories c on c.id = t.category_id
    left join public.accounts a on a.id = t.account_id
    left join public.cards ca on ca.id = t.card_id
    where ${whereSql}
    order by t.transaction_date desc, t.id desc
    limit ${limit + 1}
  `);

  const hasMore = queryRows.length > limit;
  const page = hasMore ? queryRows.slice(0, limit) : queryRows;
  const last = page[page.length - 1];
  const nextCursor =
    hasMore && last
      ? encodeTransactionCursor({
          last_transaction_date: last.transaction_date,
          last_id: last.id,
        })
      : null;

  return {
    rows: page.map((r) => ({
      id: r.id,
      transactionDate: r.transaction_date,
      description: r.description,
      kind: r.kind,
      amountCents: r.amount_cents,
      categoryName: r.category_name,
      accountOrCardLabel: r.account_or_card_label,
    })),
    nextCursor,
  };
}

export interface FinanceFilterOption {
  readonly id: string;
  readonly name: string;
}

export interface FinanceFilterOptions {
  readonly categories: readonly FinanceFilterOption[];
  readonly accounts: readonly FinanceFilterOption[];
  readonly cards: readonly FinanceFilterOption[];
}

/**
 * Carrega as opções (id + nome) para os selects de filtro da vista
 * "Variáveis": categorias, contas e cartões do household (não arquivados).
 */
export async function getVariableTxFilterOptions({
  db,
}: {
  db: DbShim;
}): Promise<FinanceFilterOptions> {
  const [categories, accounts, cards] = await Promise.all([
    db.execute<FinanceFilterOption>(sql`
      select id, name from public.categories
      where archived_at is null
      order by name asc
    `),
    db.execute<FinanceFilterOption>(sql`
      select id, name from public.accounts
      where archived_at is null
      order by name asc
    `),
    db.execute<FinanceFilterOption>(sql`
      select id, name from public.cards
      where archived_at is null
      order by name asc
    `),
  ]);
  return { categories, accounts, cards };
}
