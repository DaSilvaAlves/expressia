import type { Metadata } from 'next';
import { redirect } from 'next/navigation';

import { createServerSupabaseClient } from '@meu-jarvis/auth/server';
import { captureException, withSpan } from '@meu-jarvis/observability';

import { withHousehold } from '@/lib/agent/db-shim';
import { resolveHouseholdId } from '@/lib/api-helpers/auth';
import { getAccountBalances, type NetWorth } from '@/lib/finance/account-balances';

import { BankGroup } from '@/app/(app)/financas/_components/BankGroup';
import { FinanceEmptyState } from '@/app/(app)/financas/_components/FinanceEmptyState';
import { FinanceViewTabs } from '@/app/(app)/financas/_components/FinanceViewTabs';
import { NetWorthSummary } from '@/app/(app)/financas/_components/NetWorthSummary';
import { NewAccountButton } from '@/app/(app)/financas/_components/NewAccountButton';

export const metadata: Metadata = {
  title: 'Finanças — Património — Expressia',
};

/**
 * `/financas/patrimonio` — Vista de Património (Story 4.9).
 *
 * Server Component (RSC) — fetch via `withHousehold` (RLS viva em runtime —
 * 2.ª rede SEC-4) com filtro `household_id` app-enforced no helper (1.ª rede).
 * Por conta não-arquivada, computa o saldo on-read
 * (DP1=A) — `initial + income − expense` — agregado por banco (D-4.9.6), com
 * património total destacado e drilldown banco→conta→movimentos (D-4.9.5).
 * Criação de contas via botão "+ Nova conta" (`<NewAccountButton>` — A2,
 * fecha a lacuna FUP-4.9.A) ligado ao `POST /api/financas/contas` (Story 4.2).
 *
 * Trace: Story 4.9 AC1, AC3, AC8; FR17; DP1=A.
 */
export default async function FinancasPatrimonioPage(): Promise<React.ReactElement> {
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
        <FinanceViewTabs current="patrimonio" />
        <FinanceEmptyState variant="error" />
      </div>
    );
  }

  let netWorth: NetWorth;
  try {
    netWorth = await withSpan(
      'finance.patrimony.render',
      { route: '/financas/patrimonio' },
      async () =>
        withHousehold({ userId: user.id, householdId }, (tx) =>
          getAccountBalances({ db: tx, householdId }),
        ),
    );
  } catch (err) {
    captureException(err instanceof Error ? err : new Error(String(err)), {
      userId: user.id,
      route: '/financas/patrimonio',
    });
    return (
      <div className="space-y-6">
        <header>
          <h1 className="text-2xl font-bold">Finanças</h1>
        </header>
        <FinanceViewTabs current="patrimonio" />
        <FinanceEmptyState variant="error" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <header className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">Finanças</h1>
        <NewAccountButton />
      </header>

      <FinanceViewTabs current="patrimonio" />

      {netWorth.accountCount === 0 ? (
        <FinanceEmptyState
          variant="no-results"
          message="Ainda não há contas registadas."
        />
      ) : (
        <>
          <NetWorthSummary
            totalCents={netWorth.totalCents}
            accountCount={netWorth.accountCount}
          />
          <div className="space-y-3">
            {netWorth.groups.map((group, idx) => (
              <BankGroup
                key={group.bankName ?? `__no_bank_${idx}`}
                group={group}
              />
            ))}
          </div>
        </>
      )}
    </div>
  );
}
