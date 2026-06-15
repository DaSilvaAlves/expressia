'use client';

import { useCallback, useEffect, useMemo } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';

import {
  addWeeksLocal,
  formatWeekIso,
  formatWeekRange,
  resolveWeekStart,
} from '@/app/(app)/tarefas/calendario/_components/week-helpers';

/**
 * `<WeekNavigation>` — botões prev/today/next + título range PT-PT (Story 3.5 AC7).
 *
 * - URL state via `searchParams.week=2026-W21`.
 * - "Hoje" remove o param (router.push('/tarefas/calendario')).
 * - Keyboard shortcuts: ← (prev), → (next), T (today). `aria-keyshortcuts` documenta.
 * - R3 DST mitigation: usa `date-fns` (`startOfWeek` + `addWeeks` em `week-helpers.ts`).
 */
export interface WeekNavigationProps {
  readonly weekStartIso: string;
  readonly weekRangeLabel?: string;
}

export function WeekNavigation({
  weekStartIso,
  weekRangeLabel,
}: WeekNavigationProps): React.ReactElement {
  const router = useRouter();
  const searchParams = useSearchParams();

  const weekStart = useMemo(() => resolveWeekStart(weekStartIso), [weekStartIso]);

  const navigateTo = useCallback(
    (target: Date | null) => {
      if (target === null) {
        router.push('/tarefas/calendario');
        return;
      }
      const params = new URLSearchParams(searchParams.toString());
      params.set('week', formatWeekIso(target));
      router.push(`/tarefas/calendario?${params.toString()}`);
    },
    [router, searchParams],
  );

  const goPrev = useCallback(() => navigateTo(addWeeksLocal(weekStart, -1)), [navigateTo, weekStart]);
  const goNext = useCallback(() => navigateTo(addWeeksLocal(weekStart, 1)), [navigateTo, weekStart]);
  const goToday = useCallback(() => navigateTo(null), [navigateTo]);

  useEffect(() => {
    function handleKey(event: KeyboardEvent): void {
      // Ignorar shortcuts quando user está a digitar em input/textarea/contenteditable.
      const target = event.target as HTMLElement | null;
      if (target) {
        const tag = target.tagName;
        if (
          tag === 'INPUT' ||
          tag === 'TEXTAREA' ||
          tag === 'SELECT' ||
          target.isContentEditable
        ) {
          return;
        }
      }
      if (event.altKey || event.ctrlKey || event.metaKey) return;

      if (event.key === 'ArrowLeft') {
        event.preventDefault();
        goPrev();
      } else if (event.key === 'ArrowRight') {
        event.preventDefault();
        goNext();
      } else if (event.key === 't' || event.key === 'T') {
        event.preventDefault();
        goToday();
      }
    }
    document.addEventListener('keydown', handleKey);
    return () => document.removeEventListener('keydown', handleKey);
  }, [goPrev, goNext, goToday]);

  const label = weekRangeLabel ?? formatWeekRange(weekStart);

  return (
    <nav
      aria-label="Navegação de semana"
      className="flex items-center justify-between gap-3 rounded-md border border-black/10 bg-white px-3 py-2 dark:border-white/10 dark:bg-neutral-900"
    >
      <div className="flex items-center gap-1">
        <button
          type="button"
          onClick={goPrev}
          aria-keyshortcuts="ArrowLeft"
          title="Semana anterior (←)"
          className="rounded-md border border-black/15 bg-white px-2.5 py-1 text-sm font-medium hover:bg-neutral-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 dark:border-white/15 dark:bg-neutral-800 dark:hover:bg-neutral-700"
        >
          ‹
          <span className="sr-only"> Semana anterior</span>
        </button>
        <button
          type="button"
          onClick={goToday}
          aria-keyshortcuts="t"
          title="Semana actual (T)"
          className="rounded-md border border-black/15 bg-white px-3 py-1 text-sm font-medium hover:bg-neutral-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 dark:border-white/15 dark:bg-neutral-800 dark:hover:bg-neutral-700"
        >
          Hoje
        </button>
        <button
          type="button"
          onClick={goNext}
          aria-keyshortcuts="ArrowRight"
          title="Semana seguinte (→)"
          className="rounded-md border border-black/15 bg-white px-2.5 py-1 text-sm font-medium hover:bg-neutral-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 dark:border-white/15 dark:bg-neutral-800 dark:hover:bg-neutral-700"
        >
          ›
          <span className="sr-only"> Semana seguinte</span>
        </button>
      </div>

      <h2 className="flex-1 text-center text-sm font-semibold text-neutral-800 dark:text-neutral-200">
        {label}
      </h2>

      {/* Story 5.10 AC1 — spacer de simetria só em ≥640px (ver MonthNavigation). */}
      <div className="hidden w-[140px] sm:block" aria-hidden="true" />
    </nav>
  );
}
