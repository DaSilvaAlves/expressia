import { format, parseISO } from 'date-fns';
import { pt } from 'date-fns/locale';

import type { MonthProjection } from '@/lib/finance/month-projection';

import { MoneyDisplay } from '@/app/(app)/financas/_components/MoneyDisplay';

/**
 * `<ProjectionPanel>` — projecção dos próximos 30 dias (Story 4.6 AC4, AC6).
 *
 * Renderizado apenas na vista do mês corrente (D-4.6.4). Lista recorrências e
 * prestações futuras com badge de origem, e os subtotais projectados.
 *
 * Trace: Story 4.6 AC4, AC6, D-4.6.4.
 */
export interface ProjectionPanelProps {
  readonly projection: MonthProjection;
}

function formatItemDate(iso: string): string {
  return format(parseISO(iso), "d 'de' MMM", { locale: pt });
}

export function ProjectionPanel({ projection }: ProjectionPanelProps): React.ReactElement {
  const { items, projectedIncomeCents, projectedExpenseCents } = projection;

  return (
    <section
      className="rounded-lg border border-black/10 bg-white p-4 dark:border-white/10 dark:bg-neutral-900"
      aria-label="Projecção dos próximos 30 dias"
    >
      <div className="mb-3 flex items-center justify-between gap-3">
        <h2 className="text-base font-semibold">Próximos 30 dias</h2>
        <span className="flex items-center gap-3 text-sm">
          {projectedIncomeCents > 0 ? (
            <MoneyDisplay cents={projectedIncomeCents} tone="income" />
          ) : null}
          {projectedExpenseCents > 0 ? (
            <MoneyDisplay cents={projectedExpenseCents} tone="expense" />
          ) : null}
        </span>
      </div>

      {items.length === 0 ? (
        <p className="text-sm text-neutral-500">
          Sem recorrentes nem prestações previstas para os próximos 30 dias.
        </p>
      ) : (
        <ul className="divide-y divide-black/5 dark:divide-white/5">
          {items.map((item, idx) => (
            <li
              key={`${item.source}-${item.date}-${idx}`}
              className="flex items-center justify-between gap-3 py-2 text-sm"
            >
              <span className="flex min-w-0 items-center gap-2">
                <span className="shrink-0 text-neutral-400">{formatItemDate(item.date)}</span>
                <span className="truncate text-neutral-700 dark:text-neutral-300">
                  {item.description}
                </span>
                <span className="shrink-0 rounded-full bg-black/5 px-2 py-0.5 text-[0.65rem] uppercase tracking-wide text-neutral-500 dark:bg-white/10">
                  {item.source === 'recurrence' ? 'Recorrente' : 'Prestação'}
                </span>
              </span>
              <MoneyDisplay
                cents={item.amountCents}
                tone={item.kind === 'income' ? 'income' : item.kind === 'expense' ? 'expense' : 'neutral'}
              />
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
