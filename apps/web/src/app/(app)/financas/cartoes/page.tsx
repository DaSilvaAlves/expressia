import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { format } from 'date-fns';

import { createServerSupabaseClient } from '@meu-jarvis/auth/server';
import { captureException, withSpan } from '@meu-jarvis/observability';

import { withHousehold } from '@/lib/agent/db-shim';
import { resolveHouseholdId } from '@/lib/api-helpers/auth';
import { getCardStatements, type CardStatementData } from '@/lib/finance/list-card-statements';

import { CardStatementCard } from '@/app/(app)/financas/_components/CardStatementCard';
import { FinanceEmptyState } from '@/app/(app)/financas/_components/FinanceEmptyState';
import { FinanceViewTabs } from '@/app/(app)/financas/_components/FinanceViewTabs';
import { NewCardButton } from '@/app/(app)/financas/_components/NewCardButton';

export const metadata: Metadata = {
  title: 'Finanças — Cartões — Expressia',
};

/**
 * `/financas/cartoes` — Vista de cartões (Story 4.8).
 *
 * Server Component (RSC) — fetch via `withHousehold` (RLS viva — 2.ª rede
 * SEC-4) com filtro `household_id` app-enforced no helper (1.ª rede). Por
 * cartão, mostra a fatura corrente e a próxima calculadas
 * on-the-fly do ciclo `closing_day`/`due_day` (DP7=A) e as prestações
 * associadas. Criação via `<NewCardButton>` (A3 make-it-work — supersede a
 * vista read-only D-4.8.7); edição continua via Jarvis.
 *
 * Trace: Story 4.8 AC1, AC4, AC5, AC6.
 */
export default async function FinancasCartoesPage(): Promise<React.ReactElement> {
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
        <FinanceViewTabs current="cartoes" />
        <FinanceEmptyState variant="error" />
      </div>
    );
  }

  // `today` — data de calendário corrente, sem ajuste de timezone (D-4.8.5).
  const today = format(new Date(), 'yyyy-MM-dd');

  let cards: readonly CardStatementData[];
  try {
    const result = await withSpan(
      'finance.cards.render',
      { route: '/financas/cartoes' },
      async () =>
        withHousehold({ userId: user.id, householdId }, (tx) =>
          getCardStatements({ db: tx, today, householdId }),
        ),
    );
    cards = result.cards;
  } catch (err) {
    captureException(err instanceof Error ? err : new Error(String(err)), {
      userId: user.id,
      route: '/financas/cartoes',
    });
    return (
      <div className="space-y-6">
        <header>
          <h1 className="text-2xl font-bold">Finanças</h1>
        </header>
        <FinanceViewTabs current="cartoes" />
        <FinanceEmptyState variant="error" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <header className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">Finanças</h1>
        <NewCardButton />
      </header>

      <FinanceViewTabs current="cartoes" />

      {cards.length === 0 ? (
        <FinanceEmptyState
          variant="no-results"
          message="Ainda não há cartões. Cria um com o Jarvis."
        />
      ) : (
        <div className="space-y-4">
          {cards.map((card) => (
            <CardStatementCard key={card.id} card={card} />
          ))}
        </div>
      )}
    </div>
  );
}
