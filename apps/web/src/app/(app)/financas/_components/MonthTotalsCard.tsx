import type { MonthSummary } from '@/lib/finance/month-summary';

import { MoneyDisplay } from '@meu-jarvis/ui';

/**
 * `<MonthTotalsCard>` — cartão com os 3 totais do mês: entrou / saiu / saldo
 * (Story 4.6 AC6).
 *
 * O saldo (`netCents`) pode ser negativo — o `tone` é dinâmico.
 *
 * Trace: Story 4.6 AC6, D-4.6.5.
 */
export interface MonthTotalsCardProps {
  readonly summary: MonthSummary;
}

export function MonthTotalsCard({ summary }: MonthTotalsCardProps): React.ReactElement {
  const { totalIncomeCents, totalExpenseCents, netCents } = summary;

  return (
    <section
      className="grid grid-cols-1 gap-3 sm:grid-cols-3"
      aria-label="Totais do mês"
    >
      <div className="rounded-lg border border-black/10 bg-white p-4 dark:border-white/10 dark:bg-neutral-900">
        <p className="text-xs uppercase tracking-wide text-neutral-500">Entrou</p>
        <p className="mt-1 text-lg font-semibold">
          <MoneyDisplay cents={totalIncomeCents} tone="income" />
        </p>
      </div>
      <div className="rounded-lg border border-black/10 bg-white p-4 dark:border-white/10 dark:bg-neutral-900">
        <p className="text-xs uppercase tracking-wide text-neutral-500">Saiu</p>
        <p className="mt-1 text-lg font-semibold">
          <MoneyDisplay cents={totalExpenseCents} tone="expense" />
        </p>
      </div>
      <div className="rounded-lg border border-black/10 bg-white p-4 dark:border-white/10 dark:bg-neutral-900">
        <p className="text-xs uppercase tracking-wide text-neutral-500">Saldo do mês</p>
        <p className="mt-1 text-lg font-semibold">
          <MoneyDisplay cents={netCents} tone={netCents >= 0 ? 'income' : 'expense'} />
        </p>
      </div>
    </section>
  );
}
