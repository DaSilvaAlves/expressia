import Link from 'next/link';
import { format, parseISO } from 'date-fns';

import type { VariableTxRow } from '@/lib/finance/list-variable-transactions';

import { DeleteRowButton } from '@/app/(app)/financas/_components/DeleteRowButton';
import { MoneyDisplay } from '@meu-jarvis/ui';

/**
 * `<VariableTxList>` — lista de transacções variáveis (Story 4.7 AC3).
 *
 * Server Component — recebe as rows já agregadas do helper
 * `listVariableTransactions`. Cada linha tem uma acção de eliminar (DELETE
 * hard — AC5). `nextHref` (quando há mais) liga à próxima página keyset.
 *
 * Trace: Story 4.7 AC3, AC5.
 */
export interface VariableTxListProps {
  readonly rows: readonly VariableTxRow[];
  /** Href da próxima página (cursor) ou `null` se não há mais. */
  readonly nextHref: string | null;
}

/** `transfer` é neutro — não é entrada nem saída do agregado (D-4.6.5). */
function toneForKind(kind: VariableTxRow['kind']): 'expense' | 'income' | 'neutral' {
  if (kind === 'expense') return 'expense';
  if (kind === 'income') return 'income';
  return 'neutral';
}

export function VariableTxList({ rows, nextHref }: VariableTxListProps): React.ReactElement {
  return (
    <div className="space-y-3">
      <ul className="divide-y divide-black/5 rounded-lg border border-black/10 dark:divide-white/5 dark:border-white/10">
        {rows.map((row) => (
          <li
            key={row.id}
            className="flex flex-wrap items-center justify-between gap-3 px-4 py-2.5 text-sm"
          >
            <span className="flex min-w-0 flex-col">
              <span className="truncate font-medium text-neutral-800 dark:text-neutral-100">
                {row.description}
              </span>
              <span className="text-xs text-neutral-500">
                {format(parseISO(row.transactionDate), 'dd/MM/yyyy')} · {row.categoryName} ·{' '}
                {row.accountOrCardLabel}
              </span>
            </span>
            <span className="flex items-center gap-3">
              <MoneyDisplay cents={row.amountCents} tone={toneForKind(row.kind)} />
              <DeleteRowButton
                endpoint={`/api/financas/transacoes/${row.id}`}
                confirmMessage={`Eliminar a transacção "${row.description}"? Esta acção não pode ser anulada.`}
                itemLabel={`transacção ${row.description}`}
              />
            </span>
          </li>
        ))}
      </ul>

      {nextHref ? (
        <div className="flex justify-center">
          <Link
            href={nextHref}
            scroll={false}
            className="rounded-md border border-black/15 bg-white px-4 py-1.5 text-sm font-medium hover:bg-neutral-50 dark:border-white/15 dark:bg-neutral-800 dark:hover:bg-neutral-700"
          >
            Carregar mais →
          </Link>
        </div>
      ) : null}
    </div>
  );
}
