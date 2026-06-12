import type { Metadata } from 'next';
import { redirect } from 'next/navigation';

import { createServerSupabaseClient } from '@meu-jarvis/auth/server';
import { captureException, withSpan } from '@meu-jarvis/observability';

import { withHousehold } from '@/lib/agent/db-shim';
import { resolveHouseholdId } from '@/lib/api-helpers/auth';
import {
  getVariableTxFilterOptions,
  listVariableTransactions,
  type FinanceFilterOptions,
  type VariableTxFilters,
  type VariableTxPage,
} from '@/lib/finance/list-variable-transactions';
import type { FinanceKind } from '@/lib/finance/month-summary';

import { FinanceEmptyState } from '@/app/(app)/financas/_components/FinanceEmptyState';
import { FinanceViewTabs } from '@/app/(app)/financas/_components/FinanceViewTabs';
import { NewTransactionButton } from '@/app/(app)/financas/_components/NewTransactionButton';
import { VariableTxFilters as VariableTxFiltersBar } from '@/app/(app)/financas/_components/VariableTxFilters';
import { VariableTxList } from '@/app/(app)/financas/_components/VariableTxList';

export const metadata: Metadata = {
  title: 'Finanças — Variáveis — Expressia',
};

const FILTER_KEYS = ['from', 'to', 'category_id', 'account_id', 'card_id', 'kind'] as const;
const VALID_KINDS: readonly FinanceKind[] = ['expense', 'income', 'transfer'];

interface PageProps {
  searchParams: Promise<Record<string, string | undefined>>;
}

/**
 * `/financas/variaveis` — Vista de transacções variáveis (Story 4.7).
 *
 * Server Component (RSC) — fetch via `withHousehold` (RLS viva — 2.ª rede
 * SEC-4) com filtro `household_id` app-enforced nos helpers (1.ª rede). Lista
 * as transacções manuais (`origin=manual` — D-4.7.2) com filtros e paginação
 * keyset. Ambos os fetches correm no MESMO callback withHousehold (AC3).
 * Create via botão "+ Nova" (`<NewTransactionButton>` — A1) ou via Jarvis.
 *
 * Trace: Story 4.7 AC1, AC3, AC5, AC7.
 */
export default async function FinancasVariaveisPage({
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
        <FinanceViewTabs current="variaveis" />
        <FinanceEmptyState variant="error" />
      </div>
    );
  }

  const rawParams = await searchParams;
  const rawKind = rawParams.kind;
  const filters: VariableTxFilters = {
    from: rawParams.from,
    to: rawParams.to,
    categoryId: rawParams.category_id,
    accountId: rawParams.account_id,
    cardId: rawParams.card_id,
    kind: VALID_KINDS.includes(rawKind as FinanceKind) ? (rawKind as FinanceKind) : undefined,
    cursor: rawParams.cursor ?? null,
  };
  const hasActiveFilters = FILTER_KEYS.some((k) => rawParams[k]);

  let page: VariableTxPage;
  let options: FinanceFilterOptions;
  try {
    [page, options] = await withSpan(
      'finance.variable-list.render',
      { route: '/financas/variaveis' },
      async () =>
        withHousehold({ userId: user.id, householdId }, (tx) =>
          Promise.all([
            listVariableTransactions({ db: tx, householdId, filters }),
            getVariableTxFilterOptions({ db: tx, householdId }),
          ]),
        ),
    );
  } catch (err) {
    captureException(err instanceof Error ? err : new Error(String(err)), {
      userId: user.id,
      route: '/financas/variaveis',
    });
    return (
      <div className="space-y-6">
        <header>
          <h1 className="text-2xl font-bold">Finanças</h1>
        </header>
        <FinanceViewTabs current="variaveis" />
        <FinanceEmptyState variant="error" />
      </div>
    );
  }

  // Próxima página keyset — preserva os filtros activos, troca o cursor.
  let nextHref: string | null = null;
  if (page.nextCursor) {
    const np = new URLSearchParams();
    for (const [k, v] of Object.entries(rawParams)) {
      if (v && k !== 'cursor') np.set(k, v);
    }
    np.set('cursor', page.nextCursor);
    nextHref = `/financas/variaveis?${np.toString()}`;
  }

  return (
    <div className="space-y-6">
      <header className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">Finanças</h1>
        <NewTransactionButton options={options} />
      </header>

      <FinanceViewTabs current="variaveis" />

      <VariableTxFiltersBar options={options} />

      {page.rows.length === 0 ? (
        <FinanceEmptyState
          variant="no-results"
          message={
            hasActiveFilters
              ? 'Sem transacções para os filtros seleccionados.'
              : 'Ainda não há transacções variáveis. Regista a primeira com o botão "+ Nova" ou pelo Jarvis.'
          }
        />
      ) : (
        <VariableTxList rows={page.rows} nextHref={nextHref} />
      )}
    </div>
  );
}
