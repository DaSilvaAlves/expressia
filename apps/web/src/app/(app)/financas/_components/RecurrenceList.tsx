import { format, parseISO } from 'date-fns';

import type { RecurrenceListRow } from '@/lib/finance/list-recurrences';

import { DeleteRowButton } from '@/app/(app)/financas/_components/DeleteRowButton';
import { MoneyDisplay } from '@/app/(app)/financas/_components/MoneyDisplay';
import { frequencyLabel } from '@/app/(app)/financas/_components/RecurrenceFrequencyLabel';

/**
 * `<RecurrenceList>` — lista de recorrências financeiras (Story 4.7 AC4).
 *
 * Server Component. Cada linha mostra descrição, valor, frequência PT-PT,
 * próxima ocorrência e estado. A acção de eliminar é DELETE soft
 * (`active=false` — AC5, D-4.7.3).
 *
 * Trace: Story 4.7 AC4, AC5, D-4.7.3, R-4.7.5.
 */
export interface RecurrenceListProps {
  readonly rows: readonly RecurrenceListRow[];
}

function toneForKind(kind: RecurrenceListRow['kind']): 'expense' | 'income' | 'neutral' {
  if (kind === 'expense') return 'expense';
  if (kind === 'income') return 'income';
  return 'neutral';
}

/** Label da próxima ocorrência — `null` quando o cron ainda não correu (R-4.7.5). */
function nextRunLabel(nextRunOn: string | null): string {
  if (nextRunOn === null) return 'A aguardar primeira geração';
  return `Próxima: ${format(parseISO(nextRunOn), 'dd/MM/yyyy')}`;
}

export function RecurrenceList({ rows }: RecurrenceListProps): React.ReactElement {
  return (
    <ul className="divide-y divide-black/5 rounded-lg border border-black/10 dark:divide-white/5 dark:border-white/10">
      {rows.map((row) => (
        <li
          key={row.id}
          className="flex flex-wrap items-center justify-between gap-3 px-4 py-2.5 text-sm"
        >
          <span className="flex min-w-0 flex-col">
            <span className="flex items-center gap-2">
              <span className="truncate font-medium text-neutral-800 dark:text-neutral-100">
                {row.description}
              </span>
              {row.active ? null : (
                <span className="shrink-0 rounded-full bg-black/5 px-2 py-0.5 text-[0.65rem] uppercase tracking-wide text-neutral-500 dark:bg-white/10">
                  Inactiva
                </span>
              )}
            </span>
            <span className="text-xs text-neutral-500">
              {frequencyLabel(row.frequency)}
              {row.intervalCount > 1 ? ` (a cada ${row.intervalCount})` : ''} · {row.categoryName}{' '}
              · {row.accountOrCardLabel} · {nextRunLabel(row.nextRunOn)}
            </span>
          </span>
          <span className="flex items-center gap-3">
            <MoneyDisplay cents={row.amountCents} tone={toneForKind(row.kind)} />
            <DeleteRowButton
              endpoint={`/api/financas/recorrencias/${row.id}`}
              confirmMessage={`Desactivar a recorrência "${row.description}"? As transacções já geradas são mantidas.`}
              itemLabel={`recorrência ${row.description}`}
            />
          </span>
        </li>
      ))}
    </ul>
  );
}
