import type { CategoryBreakdownRow } from '@/lib/finance/month-summary';

import { MoneyDisplay } from '@meu-jarvis/ui';

/**
 * `<CategoryBreakdown>` — divisão das transacções do mês por categoria
 * (Story 4.6 AC6).
 *
 * Despesas e receitas em secções separadas. Cada linha tem uma barra
 * proporcional ao maior valor da secção. `transfer` não é apresentado aqui
 * (movimento interno — D-4.6.5).
 *
 * Trace: Story 4.6 AC6, D-4.6.5.
 */
export interface CategoryBreakdownProps {
  readonly rows: readonly CategoryBreakdownRow[];
}

interface SectionProps {
  readonly title: string;
  readonly rows: readonly CategoryBreakdownRow[];
  readonly tone: 'expense' | 'income';
}

function CategorySection({ title, rows, tone }: SectionProps): React.ReactElement | null {
  if (rows.length === 0) return null;
  const max = Math.max(...rows.map((r) => r.totalCents), 1);
  const barColor = tone === 'expense' ? 'bg-red-400/70' : 'bg-green-400/70';

  return (
    <div>
      <h3 className="mb-2 text-sm font-semibold text-neutral-700 dark:text-neutral-300">
        {title}
      </h3>
      <ul className="space-y-2">
        {rows.map((row) => (
          <li key={`${row.categoryId ?? 'sem'}-${row.kind}`} className="text-sm">
            <div className="flex items-center justify-between gap-3">
              <span className="text-neutral-700 dark:text-neutral-300">
                {row.categoryName}
                <span className="ml-1 text-xs text-neutral-400">({row.txCount})</span>
              </span>
              <MoneyDisplay cents={row.totalCents} tone={tone} />
            </div>
            <div className="mt-1 h-1.5 w-full rounded-full bg-black/5 dark:bg-white/5">
              <div
                className={`h-1.5 rounded-full ${barColor}`}
                style={{ width: `${Math.round((row.totalCents / max) * 100)}%` }}
              />
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}

export function CategoryBreakdown({ rows }: CategoryBreakdownProps): React.ReactElement {
  const expenses = rows.filter((r) => r.kind === 'expense');
  const incomes = rows.filter((r) => r.kind === 'income');

  return (
    <section
      className="space-y-5 rounded-lg border border-black/10 bg-white p-4 dark:border-white/10 dark:bg-neutral-900"
      aria-label="Divisão por categoria"
    >
      <h2 className="text-base font-semibold">Por categoria</h2>
      <CategorySection title="Despesas" rows={expenses} tone="expense" />
      <CategorySection title="Receitas" rows={incomes} tone="income" />
    </section>
  );
}
