'use client';

import { useTransition } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';

/**
 * `<RecurrenceFilters>` — barra de filtros da vista "Recorrentes"
 * (Story 4.7 AC4, AC6).
 *
 * URL-state via `useSearchParams` + `useRouter`. Filtros: estado (`active`),
 * frequência (`frequency`), tipo (`kind`). Sem cursor — a vista não pagina
 * (D-4.7.4).
 *
 * Trace: Story 4.7 AC4, AC6.
 */
const FIELD_CLASS =
  'rounded-md border border-black/15 bg-white px-2 py-1 dark:border-white/15 dark:bg-neutral-900';
const LABEL_CLASS = 'text-xs text-neutral-600 dark:text-neutral-400';

export function RecurrenceFilters(): React.ReactElement {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [, startTransition] = useTransition();

  function updateFilter(key: string, value: string): void {
    const params = new URLSearchParams(searchParams.toString());
    if (value) params.set(key, value);
    else params.delete(key);
    const qs = params.toString();
    startTransition(() => {
      router.push(qs ? `/financas/recorrentes?${qs}` : '/financas/recorrentes', {
        scroll: false,
      });
    });
  }

  const hasActiveFilters = Array.from(searchParams.keys()).length > 0;

  return (
    <div className="flex flex-wrap items-end gap-2 text-sm">
      <label className="flex flex-col gap-1">
        <span className={LABEL_CLASS}>Estado</span>
        <select
          value={searchParams.get('active') ?? ''}
          onChange={(e) => updateFilter('active', e.target.value)}
          aria-label="Estado"
          className={FIELD_CLASS}
        >
          <option value="">Todas</option>
          <option value="true">Activas</option>
          <option value="false">Inactivas</option>
        </select>
      </label>

      <label className="flex flex-col gap-1">
        <span className={LABEL_CLASS}>Frequência</span>
        <select
          value={searchParams.get('frequency') ?? ''}
          onChange={(e) => updateFilter('frequency', e.target.value)}
          aria-label="Frequência"
          className={FIELD_CLASS}
        >
          <option value="">Todas</option>
          <option value="daily">Diária</option>
          <option value="weekly">Semanal</option>
          <option value="biweekly">Quinzenal</option>
          <option value="monthly">Mensal</option>
          <option value="quarterly">Trimestral</option>
          <option value="yearly">Anual</option>
          <option value="custom">Personalizada</option>
        </select>
      </label>

      <label className="flex flex-col gap-1">
        <span className={LABEL_CLASS}>Tipo</span>
        <select
          value={searchParams.get('kind') ?? ''}
          onChange={(e) => updateFilter('kind', e.target.value)}
          aria-label="Tipo"
          className={FIELD_CLASS}
        >
          <option value="">Todos</option>
          <option value="expense">Despesa</option>
          <option value="income">Receita</option>
          <option value="transfer">Transferência</option>
        </select>
      </label>

      {hasActiveFilters ? (
        <button
          type="button"
          onClick={() =>
            startTransition(() => router.push('/financas/recorrentes', { scroll: false }))
          }
          className="self-end rounded-md border border-black/15 bg-white px-3 py-1 text-xs font-medium hover:bg-neutral-50 dark:border-white/15 dark:bg-neutral-800 dark:hover:bg-neutral-700"
        >
          Limpar filtros
        </button>
      ) : null}
    </div>
  );
}
