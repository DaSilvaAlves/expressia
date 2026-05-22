/**
 * Helper de listagem das recorrências financeiras — vista "Recorrentes"
 * (Story 4.7 AC4, D-4.7.4, D-4.7.5).
 *
 * Função pura de leitura `db`-injectável (padrão D-4.6.7). Sem paginação —
 * a API `recorrencias` (Story 4.4) tem hard cap 200 e volume baixo (D-4.7.4).
 *
 * Trace: Story 4.7 AC4, D-4.7.4, D-4.7.5; API 4.4 `recorrencias`.
 */
import { sql } from 'drizzle-orm';

import type { DbShim } from '@/lib/agent/db-shim';
import type { FinanceRecurrenceFrequency } from '@/lib/finance/finance-recurrence-helpers';
import type { FinanceKind } from '@/lib/finance/month-summary';

/** Limite de segurança — alinhado com o hard cap 200 da API 4.4. */
const HARD_CAP = 200;

export interface RecurrenceFilters {
  /** `undefined` = todas; `true` = só activas; `false` = só inactivas. */
  readonly active?: boolean;
  readonly frequency?: FinanceRecurrenceFrequency;
  readonly kind?: FinanceKind;
}

export interface RecurrenceListRow {
  readonly id: string;
  readonly description: string;
  readonly kind: FinanceKind;
  readonly amountCents: number;
  readonly frequency: FinanceRecurrenceFrequency;
  readonly intervalCount: number;
  /** YYYY-MM-DD ou `null` (criada mas ainda sem primeira geração). */
  readonly nextRunOn: string | null;
  readonly active: boolean;
  readonly categoryName: string;
  readonly accountOrCardLabel: string;
}

interface RecurrenceQueryRow {
  id: string;
  description: string;
  kind: FinanceKind;
  amount_cents: number;
  frequency: FinanceRecurrenceFrequency;
  interval_count: number;
  next_run_on: string | null;
  active: boolean;
  category_name: string;
  account_or_card_label: string;
}

/**
 * Lista as recorrências do household com filtros opcionais
 * `active`/`frequency`/`kind`. Order `created_at desc, id desc`.
 */
export async function listRecurrences({
  db,
  filters,
}: {
  db: DbShim;
  filters: RecurrenceFilters;
}): Promise<{ rows: readonly RecurrenceListRow[] }> {
  const conditions = [sql`true`];
  if (filters.active !== undefined) {
    conditions.push(sql`r.active = ${filters.active}`);
  }
  if (filters.frequency) {
    conditions.push(sql`r.frequency = ${filters.frequency}::recurrence_freq_finance`);
  }
  if (filters.kind) {
    conditions.push(sql`r.kind = ${filters.kind}::transaction_kind`);
  }
  const whereSql = conditions.reduce((acc, c, idx) => (idx === 0 ? c : sql`${acc} and ${c}`));

  const queryRows = await db.execute<RecurrenceQueryRow>(sql`
    select
      r.id,
      r.description,
      r.kind,
      r.amount_cents::int as amount_cents,
      r.frequency,
      r.interval::int as interval_count,
      r.next_run_on::text as next_run_on,
      r.active,
      coalesce(c.name, 'Sem categoria') as category_name,
      coalesce(a.name, ca.name, '—') as account_or_card_label
    from public.recurrences r
    left join public.categories c on c.id = r.category_id
    left join public.accounts a on a.id = r.account_id
    left join public.cards ca on ca.id = r.card_id
    where ${whereSql}
    order by r.created_at desc, r.id desc
    limit ${HARD_CAP}
  `);

  return {
    rows: queryRows.map((r) => ({
      id: r.id,
      description: r.description,
      kind: r.kind,
      amountCents: r.amount_cents,
      frequency: r.frequency,
      intervalCount: r.interval_count,
      nextRunOn: r.next_run_on,
      active: r.active,
      categoryName: r.category_name,
      accountOrCardLabel: r.account_or_card_label,
    })),
  };
}
