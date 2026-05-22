/**
 * Helper de projecção de 30 dias da vista "Este mês" — DP2=C híbrido
 * (Story 4.6 AC4, D-4.6.3, D-4.6.6).
 *
 * Janela: `[today, today + 30d]` inclusive (FR18). Duas fontes:
 *   - Prestações: lidas directamente de `transactions` (`is_projected = true`,
 *     `installment_id IS NOT NULL`) — já materializadas na criação do
 *     installment (DP8=A, Story 4.4).
 *   - Recorrências: projectadas on-the-fly iterando `calcNextRunDate`
 *     (Story 4.5) a partir de `next_run_on` (ou `starts_on` se NULL).
 *
 * Sem dupla contagem (D-4.6.3, R-4.6.3): o critério é estrito `date > today`.
 * A ocorrência de hoje de uma recorrência, se ainda não foi materializada
 * pelo cron (corre às 03:00 UTC), não aparece nem no real nem na projecção —
 * fica momentaneamente invisível até ao run do cron. Aceitável no MVP.
 *
 * Trace: Story 4.6 AC4, D-4.6.3, D-4.6.5, D-4.6.6; epic DP2=C, FR18.
 */
import { sql } from 'drizzle-orm';
import { addDays, formatISO, parseISO } from 'date-fns';

import { childLogger } from '@meu-jarvis/observability';

import type { DbShim } from '@/lib/agent/db-shim';
import {
  calcNextRunDate,
  type FinanceRecurrenceForCalc,
  type FinanceRecurrenceFrequency,
} from '@/lib/finance/finance-recurrence-helpers';
import type { FinanceKind } from '@/lib/finance/month-summary';

/** Horizonte da projecção em dias (FR18). */
const PROJECTION_WINDOW_DAYS = 30;
/** Teto de iterações por recorrência — D-4.6.6 (folga 2× sobre ≤31 ocorrências/30d). */
const MAX_ITERATIONS_PER_RECURRENCE = 60;

export interface MonthProjectionInput {
  /** Cliente Drizzle RLS-scoped (`getDb()`). */
  readonly db: DbShim;
  /** Data corrente — YYYY-MM-DD. */
  readonly today: string;
}

export interface ProjectedItem {
  readonly date: string;
  readonly description: string;
  readonly kind: FinanceKind;
  readonly amountCents: number;
  readonly source: 'recurrence' | 'installment';
}

export interface MonthProjection {
  /** `today + 30d` — YYYY-MM-DD. */
  readonly windowEnd: string;
  /** Itens projectados, ordenados por data asc. */
  readonly items: readonly ProjectedItem[];
  readonly projectedIncomeCents: number;
  readonly projectedExpenseCents: number;
}

interface InstallmentRow {
  date: string;
  description: string;
  kind: FinanceKind;
  amount_cents: number;
}

interface RecurrenceRow {
  description: string;
  kind: FinanceKind;
  amount_cents: number;
  frequency: FinanceRecurrenceFrequency;
  interval: number;
  custom_rrule: string | null;
  starts_on: string;
  ends_on: string | null;
  next_run_on: string | null;
}

/**
 * Calcula a projecção dos próximos 30 dias: prestações materializadas +
 * recorrências projectadas on-the-fly.
 */
export async function getMonthProjection({
  db,
  today,
}: MonthProjectionInput): Promise<MonthProjection> {
  const windowEnd = formatISO(addDays(parseISO(today), PROJECTION_WINDOW_DAYS), {
    representation: 'date',
  });

  const [installmentRows, recurrenceRows] = await Promise.all([
    db.execute<InstallmentRow>(sql`
      select
        transaction_date::text as date,
        description,
        kind,
        amount_cents::int as amount_cents
      from public.transactions
      where is_projected = true
        and installment_id is not null
        and transaction_date >= ${today}::date
        and transaction_date <= ${windowEnd}::date
      order by transaction_date asc
    `),
    db.execute<RecurrenceRow>(sql`
      select
        description,
        kind,
        amount_cents,
        frequency,
        interval,
        custom_rrule,
        starts_on::text  as starts_on,
        ends_on::text    as ends_on,
        next_run_on::text as next_run_on
      from public.recurrences
      where active = true
    `),
  ]);

  const items: ProjectedItem[] = installmentRows.map((r) => ({
    date: r.date,
    description: r.description,
    kind: r.kind,
    amountCents: r.amount_cents,
    source: 'installment' as const,
  }));

  const log = childLogger({ helper: 'getMonthProjection' });

  for (const rec of recurrenceRows) {
    const def: FinanceRecurrenceForCalc = {
      frequency: rec.frequency,
      interval: rec.interval,
      customRrule: rec.custom_rrule,
      endsOn: rec.ends_on,
    };
    let cursor: string | null = rec.next_run_on ?? rec.starts_on;
    let iterations = 0;
    for (; cursor !== null && iterations < MAX_ITERATIONS_PER_RECURRENCE; iterations++) {
      if (cursor > windowEnd) break;
      // Critério estrito `> today` — evita dupla contagem com a transacção do
      // dia já materializada pelo cron (D-4.6.3, R-4.6.3).
      if (cursor > today) {
        items.push({
          date: cursor,
          description: rec.description,
          kind: rec.kind,
          amountCents: rec.amount_cents,
          source: 'recurrence',
        });
      }
      cursor = calcNextRunDate(def, cursor);
    }
    if (iterations >= MAX_ITERATIONS_PER_RECURRENCE) {
      // Anómalo (D-4.6.6) — recorrência com cadência inesperada ou next_run_on
      // muito stale. A projecção fica truncada nas 60 ocorrências.
      log.warn(
        { iterations, frequency: rec.frequency },
        'projecção de recorrência atingiu o teto de iterações',
      );
    }
  }

  items.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));

  let projectedIncomeCents = 0;
  let projectedExpenseCents = 0;
  for (const it of items) {
    if (it.kind === 'income') projectedIncomeCents += it.amountCents;
    else if (it.kind === 'expense') projectedExpenseCents += it.amountCents;
    // `transfer` fica de fora dos subtotais (D-4.6.5).
  }

  return { windowEnd, items, projectedIncomeCents, projectedExpenseCents };
}
