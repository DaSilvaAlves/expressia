import { format, parseISO } from 'date-fns';
import { pt } from 'date-fns/locale';

import type { DayBreakdownRow } from '@/lib/finance/month-summary';

import { MoneyDisplay } from '@/app/(app)/financas/_components/MoneyDisplay';

/**
 * `<DayBreakdown>` — movimento dia-a-dia do mês (Story 4.6 AC6).
 *
 * Apenas dias com movimento (o helper já filtra). Cada linha mostra a entrada
 * e a saída do dia quando não-zero.
 *
 * Trace: Story 4.6 AC6.
 */
export interface DayBreakdownProps {
  readonly rows: readonly DayBreakdownRow[];
}

function formatDayLabel(iso: string): string {
  return format(parseISO(iso), "d 'de' MMMM", { locale: pt });
}

export function DayBreakdown({ rows }: DayBreakdownProps): React.ReactElement {
  return (
    <section
      className="rounded-lg border border-black/10 bg-white p-4 dark:border-white/10 dark:bg-neutral-900"
      aria-label="Movimento por dia"
    >
      <h2 className="mb-3 text-base font-semibold">Por dia</h2>
      <ul className="divide-y divide-black/5 dark:divide-white/5">
        {rows.map((row) => (
          <li
            key={row.day}
            className="flex items-center justify-between gap-3 py-2 text-sm"
          >
            <span className="capitalize text-neutral-700 dark:text-neutral-300">
              {formatDayLabel(row.day)}
            </span>
            <span className="flex items-center gap-3">
              {row.incomeCents > 0 ? (
                <MoneyDisplay cents={row.incomeCents} tone="income" />
              ) : null}
              {row.expenseCents > 0 ? (
                <MoneyDisplay cents={row.expenseCents} tone="expense" />
              ) : null}
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}
