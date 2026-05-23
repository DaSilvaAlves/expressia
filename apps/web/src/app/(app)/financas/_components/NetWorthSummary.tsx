import { MoneyDisplay } from '@/app/(app)/financas/_components/MoneyDisplay';

/**
 * `<NetWorthSummary>` — cartão de destaque com o património total e o número
 * de contas activas (Story 4.9 AC3).
 *
 * Usa `MoneyDisplay tone="signed"` (D-4.9.8) — total pode ser negativo se o
 * agregado tiver, no balanço, mais despesas do que receitas + saldos iniciais.
 *
 * Trace: Story 4.9 AC3.
 */
export interface NetWorthSummaryProps {
  readonly totalCents: number;
  readonly accountCount: number;
}

export function NetWorthSummary({
  totalCents,
  accountCount,
}: NetWorthSummaryProps): React.ReactElement {
  const accountLabel =
    accountCount === 1 ? '1 conta activa' : `${accountCount} contas activas`;

  return (
    <section
      aria-label="Património total"
      className="rounded-lg border border-black/10 bg-gradient-to-br from-blue-50 to-white p-5 shadow-sm dark:border-white/10 dark:from-blue-950/40 dark:to-neutral-900"
    >
      <p className="text-xs font-medium uppercase tracking-wide text-neutral-500 dark:text-neutral-400">
        Património total
      </p>
      <p className="mt-1 text-3xl font-bold">
        <MoneyDisplay cents={totalCents} tone="signed" />
      </p>
      <p className="mt-2 text-sm text-neutral-600 dark:text-neutral-400">{accountLabel}</p>
    </section>
  );
}
