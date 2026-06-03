import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { endOfMonth, format, parseISO, startOfMonth } from 'date-fns';
import { pt } from 'date-fns/locale';

import { createServerSupabaseClient } from '@meu-jarvis/auth/server';
import { captureException, withSpan } from '@meu-jarvis/observability';

import { withHousehold } from '@/lib/agent/db-shim';
import { resolveHouseholdId } from '@/lib/api-helpers/auth';
import { getMonthProjection, type MonthProjection } from '@/lib/finance/month-projection';
import { getMonthSummary, type MonthSummary } from '@/lib/finance/month-summary';

import { CategoryBreakdown } from '@/app/(app)/financas/_components/CategoryBreakdown';
import { DayBreakdown } from '@/app/(app)/financas/_components/DayBreakdown';
import { FinanceEmptyState } from '@/app/(app)/financas/_components/FinanceEmptyState';
import { FinanceViewTabs } from '@/app/(app)/financas/_components/FinanceViewTabs';
import { MonthNavigation } from '@/app/(app)/financas/_components/MonthNavigation';
import { MonthTotalsCard } from '@/app/(app)/financas/_components/MonthTotalsCard';
import { ProjectionPanel } from '@/app/(app)/financas/_components/ProjectionPanel';

export const metadata: Metadata = {
  title: 'Finanças — Este mês — Expressia',
};

/** `YYYY-MM` com mês 01-12. */
const MONTH_PARAM_RE = /^\d{4}-(0[1-9]|1[0-2])$/;

interface PageProps {
  searchParams: Promise<Record<string, string | undefined>>;
}

/**
 * Resolve o mês a visualizar a partir do search param `?mes=`. Param ausente
 * ou malformado → mês corrente (fallback defensivo, sem erro — AC5, R-4.6.5).
 */
function resolveMonth(raw: string | undefined): { monthKey: string; monthStartDate: Date } {
  if (raw && MONTH_PARAM_RE.test(raw)) {
    return { monthKey: raw, monthStartDate: startOfMonth(parseISO(`${raw}-01`)) };
  }
  const now = new Date();
  return { monthKey: format(now, 'yyyy-MM'), monthStartDate: startOfMonth(now) };
}

/**
 * `/financas/este-mes` — Vista mensal de Finanças (Story 4.6).
 *
 * Server Component (RSC) que faz fetch via `withHousehold` (RLS viva — 2.ª
 * rede SEC-4) com filtro `household_id` app-enforced nos helpers (1.ª rede).
 * Agrega o mês real (`getMonthSummary`) e, no mês corrente, a projecção dos
 * próximos 30 dias (`getMonthProjection` — DP2=C). Ambos os fetches correm no
 * MESMO callback `withHousehold` (partilham transação/contexto RLS).
 * Navegação de meses livre via `?mes=`
 * (DP3=B). Instrumentado com `withSpan` (AC7).
 *
 * Trace: Story 4.6 AC1, AC5, AC6, AC7; epic DP2=C, DP3=B, FR18.
 */
export default async function FinancasEsteMesPage({
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
        <FinanceViewTabs current="este-mes" />
        <FinanceEmptyState variant="error" />
      </div>
    );
  }

  const rawParams = await searchParams;
  const { monthKey, monthStartDate } = resolveMonth(rawParams.mes);
  const monthStart = format(monthStartDate, 'yyyy-MM-dd');
  const monthEnd = format(endOfMonth(monthStartDate), 'yyyy-MM-dd');
  const monthLabel = format(monthStartDate, 'MMMM yyyy', { locale: pt });

  // `today` é a data de calendário corrente — sem ajuste de timezone, coerente
  // com D-4.5.5 (datas financeiras são datas de calendário, não instantes).
  const now = new Date();
  const today = format(now, 'yyyy-MM-dd');
  const isCurrentMonth = monthKey === format(now, 'yyyy-MM');

  let summary: MonthSummary;
  let projection: MonthProjection | null;
  try {
    [summary, projection] = await withSpan(
      'finance.month-view.render',
      { route: '/financas/este-mes' },
      async (span) => {
        span.setAttribute('finance.month', monthKey);
        // Ambos os fetches no MESMO callback withHousehold — partilham a
        // transação/contexto RLS (AC3).
        return withHousehold({ userId: user.id, householdId }, (tx) =>
          Promise.all([
            getMonthSummary({ db: tx, householdId, monthStart, monthEnd }),
            isCurrentMonth
              ? getMonthProjection({ db: tx, householdId, today })
              : Promise.resolve(null),
          ]),
        );
      },
    );
  } catch (err) {
    captureException(err instanceof Error ? err : new Error(String(err)), {
      userId: user.id,
      route: '/financas/este-mes',
    });
    return (
      <div className="space-y-6">
        <header>
          <h1 className="text-2xl font-bold">Finanças</h1>
        </header>
        <FinanceViewTabs current="este-mes" />
        <MonthNavigation monthKey={monthKey} monthLabel={monthLabel} />
        <FinanceEmptyState variant="error" />
      </div>
    );
  }

  const isEmpty = summary.byDay.length === 0;

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-bold">Finanças</h1>
      </header>

      <FinanceViewTabs current="este-mes" />

      <MonthNavigation monthKey={monthKey} monthLabel={monthLabel} />

      {isEmpty ? (
        <FinanceEmptyState variant="no-movements" monthLabel={monthLabel} />
      ) : (
        <>
          <MonthTotalsCard summary={summary} />
          <CategoryBreakdown rows={summary.byCategory} />
          <DayBreakdown rows={summary.byDay} />
        </>
      )}

      {isCurrentMonth && projection ? (
        <ProjectionPanel projection={projection} />
      ) : (
        <p className="text-sm text-neutral-500">
          A projecção dos próximos 30 dias aparece na vista do mês corrente.
        </p>
      )}
    </div>
  );
}
