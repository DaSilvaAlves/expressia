'use client';

import { useTransition } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';

import type { FinanceFilterOptions } from '@/lib/finance/list-variable-transactions';

/**
 * `<VariableTxFilters>` — barra de filtros da vista "Variáveis"
 * (Story 4.7 AC3, AC6).
 *
 * URL-state via `useSearchParams` + `useRouter` (padrão `TaskFilters` da
 * Story 3.3 / `MonthNavigation` da Story 4.6). Mudança de filtro → `router.push`
 * → RSC re-fetch. O `cursor` é reposto a cada mudança (a paginação anterior
 * deixa de aplicar).
 *
 * Filtros: período (`from`/`to`), categoria, conta/cartão, tipo (`kind`).
 *
 * Trace: Story 4.7 AC3, AC6.
 */
export interface VariableTxFiltersProps {
  readonly options: FinanceFilterOptions;
}

const FIELD_CLASS =
  'rounded-md border border-black/15 bg-white px-2 py-1 dark:border-white/15 dark:bg-neutral-900';
const LABEL_CLASS = 'text-xs text-neutral-600 dark:text-neutral-400';

export function VariableTxFilters({ options }: VariableTxFiltersProps): React.ReactElement {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [, startTransition] = useTransition();

  function updateFilter(key: string, value: string): void {
    const params = new URLSearchParams(searchParams.toString());
    if (value) params.set(key, value);
    else params.delete(key);
    // Reset da paginação — o cursor anterior já não aplica aos novos filtros.
    params.delete('cursor');
    const qs = params.toString();
    startTransition(() => {
      router.push(qs ? `/financas/variaveis?${qs}` : '/financas/variaveis', { scroll: false });
    });
  }

  const hasActiveFilters = Array.from(searchParams.keys()).some((k) => k !== 'cursor');

  return (
    <div className="flex flex-wrap items-end gap-2 text-sm">
      <label className="flex flex-col gap-1">
        <span className={LABEL_CLASS}>De</span>
        <input
          type="date"
          value={searchParams.get('from') ?? ''}
          onChange={(e) => updateFilter('from', e.target.value)}
          aria-label="Data de"
          className={FIELD_CLASS}
        />
      </label>

      <label className="flex flex-col gap-1">
        <span className={LABEL_CLASS}>Até</span>
        <input
          type="date"
          value={searchParams.get('to') ?? ''}
          onChange={(e) => updateFilter('to', e.target.value)}
          aria-label="Data até"
          className={FIELD_CLASS}
        />
      </label>

      <label className="flex flex-col gap-1">
        <span className={LABEL_CLASS}>Categoria</span>
        <select
          value={searchParams.get('category_id') ?? ''}
          onChange={(e) => updateFilter('category_id', e.target.value)}
          aria-label="Categoria"
          className={FIELD_CLASS}
        >
          <option value="">Todas</option>
          {options.categories.map((o) => (
            <option key={o.id} value={o.id}>
              {o.name}
            </option>
          ))}
        </select>
      </label>

      <label className="flex flex-col gap-1">
        <span className={LABEL_CLASS}>Conta</span>
        <select
          value={searchParams.get('account_id') ?? ''}
          onChange={(e) => updateFilter('account_id', e.target.value)}
          aria-label="Conta"
          className={FIELD_CLASS}
        >
          <option value="">Todas</option>
          {options.accounts.map((o) => (
            <option key={o.id} value={o.id}>
              {o.name}
            </option>
          ))}
        </select>
      </label>

      <label className="flex flex-col gap-1">
        <span className={LABEL_CLASS}>Cartão</span>
        <select
          value={searchParams.get('card_id') ?? ''}
          onChange={(e) => updateFilter('card_id', e.target.value)}
          aria-label="Cartão"
          className={FIELD_CLASS}
        >
          <option value="">Todos</option>
          {options.cards.map((o) => (
            <option key={o.id} value={o.id}>
              {o.name}
            </option>
          ))}
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
            startTransition(() => router.push('/financas/variaveis', { scroll: false }))
          }
          className="self-end rounded-md border border-black/15 bg-white px-3 py-1 text-xs font-medium hover:bg-neutral-50 dark:border-white/15 dark:bg-neutral-800 dark:hover:bg-neutral-700"
        >
          Limpar filtros
        </button>
      ) : null}
    </div>
  );
}
