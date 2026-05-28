import type * as React from 'react';
import { parseISO } from 'date-fns';

import { captureException } from '@meu-jarvis/observability';
import { DateDisplay, MoneyDisplay } from '@meu-jarvis/ui';

import { getDb } from '@/lib/agent/db-shim';
import { getRecurrencesNext } from '@/lib/visao/queries';
import { WidgetCard } from '@/app/(app)/visao/_components/WidgetCard';

/**
 * `<RecurrencesNextWidget>` — widget `recurrences_next` (Story 5.6 AC4).
 *
 * RSC-direct via `getDb()` + `getRecurrencesNext` (DP-5.6.A=B). Mostra até 5
 * próximas recorrências: data (`<DateDisplay>`) + descrição + `<MoneyDisplay>`.
 * `tone` mapeia o `kind` (income=+verde, expense=−vermelho, transfer=neutro).
 * Empty inline quando vazio. Rodapé "Ver recorrências →" `/financas/recorrentes`.
 *
 * Data civil (`nextRunOn` = 'YYYY-MM-DD') via `parseISO` para `<DateDisplay>`
 * preservar o dia (cuidado timezone documentado no `DateDisplay`).
 *
 * Trace: Story 5.6 AC4 (recurrences_next); RLS NFR5.
 */
export async function RecurrencesNextWidget(): Promise<React.ReactElement> {
  let recurrences: Awaited<ReturnType<typeof getRecurrencesNext>>['recurrences'] = [];
  try {
    const data = await getRecurrencesNext(getDb());
    recurrences = data.recurrences;
  } catch (err) {
    captureException(err instanceof Error ? err : new Error(String(err)), {
      route: '/visao',
      extra: { widget: 'recurrences_next' },
    });
  }

  const visible = recurrences.slice(0, 5);

  return (
    <WidgetCard
      title="Próximas recorrências"
      footer={{ label: 'Ver recorrências', href: '/financas/recorrentes' }}
    >
      {visible.length === 0 ? (
        <p className="text-neutral-500">Sem recorrências próximas.</p>
      ) : (
        <ul className="space-y-2">
          {visible.map((rec) => (
            <li key={rec.id} className="flex items-center gap-2">
              <span className="shrink-0 tabular-nums text-xs text-neutral-500">
                <DateDisplay value={parseISO(rec.nextRunOn)} preset="short" />
              </span>
              <span className="flex-1 truncate">{rec.description}</span>
              <span className="shrink-0 text-xs font-medium">
                <MoneyDisplay
                  cents={rec.amountCents}
                  tone={rec.kind === 'income' ? 'income' : rec.kind === 'expense' ? 'expense' : 'neutral'}
                />
              </span>
            </li>
          ))}
        </ul>
      )}
    </WidgetCard>
  );
}
