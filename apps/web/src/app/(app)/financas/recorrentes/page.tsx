import type { Metadata } from 'next';
import { redirect } from 'next/navigation';

import { createServerSupabaseClient } from '@meu-jarvis/auth/server';
import { captureException, withSpan } from '@meu-jarvis/observability';

import { withHousehold } from '@/lib/agent/db-shim';
import { resolveHouseholdId } from '@/lib/api-helpers/auth';
import type { FinanceRecurrenceFrequency } from '@/lib/finance/finance-recurrence-helpers';
import {
  listRecurrences,
  type RecurrenceFilters,
  type RecurrenceListRow,
} from '@/lib/finance/list-recurrences';
import type { FinanceKind } from '@/lib/finance/month-summary';

import { FinanceEmptyState } from '@/app/(app)/financas/_components/FinanceEmptyState';
import { FinanceViewTabs } from '@/app/(app)/financas/_components/FinanceViewTabs';
import { NewRecurrenceButton } from '@/app/(app)/financas/_components/NewRecurrenceButton';
import { RecurrenceFilters as RecurrenceFiltersBar } from '@/app/(app)/financas/_components/RecurrenceFilters';
import { RecurrenceList } from '@/app/(app)/financas/_components/RecurrenceList';

export const metadata: Metadata = {
  title: 'Finanças — Recorrentes — Expressia',
};

const VALID_KINDS: readonly FinanceKind[] = ['expense', 'income', 'transfer'];
const VALID_FREQUENCIES: readonly FinanceRecurrenceFrequency[] = [
  'daily',
  'weekly',
  'biweekly',
  'monthly',
  'quarterly',
  'yearly',
  'custom',
];

interface PageProps {
  searchParams: Promise<Record<string, string | undefined>>;
}

/**
 * `/financas/recorrentes` — Vista de recorrências financeiras (Story 4.7).
 *
 * Server Component (RSC) — fetch via `withHousehold` (RLS viva — 2.ª rede
 * SEC-4) com filtro `household_id` app-enforced no helper (1.ª rede). Lista as
 * `recurrences` com filtros `active`/`frequency`/`kind`. Sem paginação (D-4.7.4).
 * Create/Update via Jarvis (D-4.7.1); DELETE soft via row action (AC5).
 *
 * Trace: Story 4.7 AC1, AC4, AC5, AC7.
 */
export default async function FinancasRecorrentesPage({
  searchParams,
}: PageProps): Promise<React.ReactElement> {
  const supabase = await createServerSupabaseClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect('/entrar');

  const householdId = await resolveHouseholdId(user.id);
  if (!householdId) {
    return (
      <div className="space-y-6">
        <header>
          <h1 className="text-2xl font-bold">Finanças</h1>
        </header>
        <FinanceViewTabs current="recorrentes" />
        <FinanceEmptyState variant="error" />
      </div>
    );
  }

  const rawParams = await searchParams;
  const rawActive = rawParams.active;
  const rawFrequency = rawParams.frequency;
  const rawKind = rawParams.kind;
  const filters: RecurrenceFilters = {
    active: rawActive === 'true' ? true : rawActive === 'false' ? false : undefined,
    frequency: VALID_FREQUENCIES.includes(rawFrequency as FinanceRecurrenceFrequency)
      ? (rawFrequency as FinanceRecurrenceFrequency)
      : undefined,
    kind: VALID_KINDS.includes(rawKind as FinanceKind) ? (rawKind as FinanceKind) : undefined,
  };
  const hasActiveFilters =
    filters.active !== undefined || filters.frequency !== undefined || filters.kind !== undefined;

  let rows: readonly RecurrenceListRow[];
  try {
    const result = await withSpan(
      'finance.recurrence-list.render',
      { route: '/financas/recorrentes' },
      async () =>
        withHousehold({ userId: user.id, householdId }, (tx) =>
          listRecurrences({ db: tx, householdId, filters }),
        ),
    );
    rows = result.rows;
  } catch (err) {
    captureException(err instanceof Error ? err : new Error(String(err)), {
      userId: user.id,
      route: '/financas/recorrentes',
    });
    return (
      <div className="space-y-6">
        <header>
          <h1 className="text-2xl font-bold">Finanças</h1>
        </header>
        <FinanceViewTabs current="recorrentes" />
        <FinanceEmptyState variant="error" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <header className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">Finanças</h1>
        <NewRecurrenceButton />
      </header>

      <FinanceViewTabs current="recorrentes" />

      <RecurrenceFiltersBar />

      {rows.length === 0 ? (
        <FinanceEmptyState
          variant="no-results"
          message={
            hasActiveFilters
              ? 'Sem recorrências para os filtros seleccionados.'
              : 'Ainda não há recorrências. Cria uma com o Jarvis (ex: "renda de €700 todo o dia 8").'
          }
        />
      ) : (
        <RecurrenceList rows={rows} />
      )}
    </div>
  );
}
