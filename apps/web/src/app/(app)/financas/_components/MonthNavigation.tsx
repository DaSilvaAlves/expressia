'use client';

import { useCallback, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import { addMonths, format, parseISO } from 'date-fns';

/**
 * `<MonthNavigation>` — botões mês anterior / mês actual / mês seguinte +
 * título do mês (Story 4.6 AC5, DP3=B navegação livre).
 *
 * URL state via `?mes=YYYY-MM`. "Mês actual" remove o param. Passado e futuro
 * sem limite. Atalhos de teclado: ← (anterior), → (seguinte), T (actual).
 *
 * Trace: Story 4.6 AC5, DP3=B; precedente `WeekNavigation` (Story 3.5).
 */
export interface MonthNavigationProps {
  /** Mês visualizado — YYYY-MM. */
  readonly monthKey: string;
  /** Label PT-PT do mês — ex: "maio 2026". */
  readonly monthLabel: string;
}

export function MonthNavigation({
  monthKey,
  monthLabel,
}: MonthNavigationProps): React.ReactElement {
  const router = useRouter();
  const base = useMemo(() => parseISO(`${monthKey}-01`), [monthKey]);

  const goTo = useCallback(
    (offset: number | null) => {
      if (offset === null) {
        router.push('/financas/este-mes');
        return;
      }
      const target = format(addMonths(base, offset), 'yyyy-MM');
      router.push(`/financas/este-mes?mes=${target}`);
    },
    [router, base],
  );

  const buttonClass =
    'rounded-md border border-black/15 bg-white px-2.5 py-1 text-sm font-medium hover:bg-neutral-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 dark:border-white/15 dark:bg-neutral-800 dark:hover:bg-neutral-700';

  return (
    <nav
      aria-label="Navegação de mês"
      className="flex items-center justify-between gap-3 rounded-md border border-black/10 bg-white px-3 py-2 dark:border-white/10 dark:bg-neutral-900"
    >
      <div className="flex items-center gap-1">
        <button
          type="button"
          onClick={() => goTo(-1)}
          title="Mês anterior"
          className={buttonClass}
        >
          ‹<span className="sr-only"> Mês anterior</span>
        </button>
        <button
          type="button"
          onClick={() => goTo(null)}
          title="Mês actual"
          className={buttonClass}
        >
          Mês actual
        </button>
        <button
          type="button"
          onClick={() => goTo(1)}
          title="Mês seguinte"
          className={buttonClass}
        >
          ›<span className="sr-only"> Mês seguinte</span>
        </button>
      </div>

      <h2 className="flex-1 text-center text-sm font-semibold capitalize text-neutral-800 dark:text-neutral-200">
        {monthLabel}
      </h2>

      <div className="w-[150px]" aria-hidden="true" />
    </nav>
  );
}
