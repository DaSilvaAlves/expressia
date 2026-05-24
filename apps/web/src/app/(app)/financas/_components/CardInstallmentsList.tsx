import type { CardInstallment } from '@/lib/finance/list-card-statements';

import { MoneyDisplay } from '@meu-jarvis/ui';

/**
 * `<CardInstallmentsList>` — compras parceladas associadas a um cartão
 * (Story 4.8 AC5).
 *
 * Por prestação: descrição, valor por parcela, valor total e progresso
 * "Parcela X de N" (X = parcelas decorridas; N = total).
 *
 * Trace: Story 4.8 AC5.
 */
export interface CardInstallmentsListProps {
  readonly installments: readonly CardInstallment[];
}

export function CardInstallmentsList({
  installments,
}: CardInstallmentsListProps): React.ReactElement | null {
  if (installments.length === 0) return null;

  return (
    <div className="mt-3 border-t border-black/5 pt-3 dark:border-white/5">
      <h4 className="mb-2 text-xs font-semibold uppercase tracking-wide text-neutral-500">
        Compras parceladas
      </h4>
      <ul className="space-y-1.5">
        {installments.map((inst) => {
          // O progresso é limitado a [0, numInstallments] — defensivo.
          const paid = Math.min(Math.max(inst.paidCount, 0), inst.numInstallments);
          return (
            <li key={inst.id} className="flex items-center justify-between gap-3 text-sm">
              <span className="flex min-w-0 flex-col">
                <span className="truncate text-neutral-700 dark:text-neutral-300">
                  {inst.description}
                </span>
                <span className="text-xs text-neutral-500">
                  Parcela {paid} de {inst.numInstallments} ·{' '}
                  <MoneyDisplay cents={inst.perInstallmentCents} />/mês
                </span>
              </span>
              <MoneyDisplay cents={inst.totalAmountCents} tone="expense" />
            </li>
          );
        })}
      </ul>
    </div>
  );
}
