import { format, parseISO } from 'date-fns';

import type { CardStatementData } from '@/lib/finance/list-card-statements';

import { CardInstallmentsList } from '@/app/(app)/financas/_components/CardInstallmentsList';
import { MoneyDisplay } from '@meu-jarvis/ui';

/**
 * `<CardStatementCard>` — cartão de Finanças com a fatura corrente e a
 * próxima (Story 4.8 AC4, AC5, AC6).
 *
 * Cartões sem ciclo de fatura (débito, ou crédito sem `closing_day`/`due_day`
 * — D-4.8.4) renderizam com uma nota, sem secção de fatura.
 *
 * Trace: Story 4.8 AC4, AC5, AC6, D-4.8.4.
 */
export interface CardStatementCardProps {
  readonly card: CardStatementData;
}

function formatDate(iso: string): string {
  return format(parseISO(iso), 'dd/MM/yyyy');
}

/** Tom do total da fatura — positivo (a pagar) = vermelho; crédito = verde. */
function toneForTotal(cents: number): 'expense' | 'income' | 'neutral' {
  if (cents > 0) return 'expense';
  if (cents < 0) return 'income';
  return 'neutral';
}

interface StatementBlockProps {
  readonly label: string;
  readonly totalCents: number;
  readonly cycleEnd: string;
  readonly dueDate: string;
}

function StatementBlock({
  label,
  totalCents,
  cycleEnd,
  dueDate,
}: StatementBlockProps): React.ReactElement {
  return (
    <div className="rounded-md border border-black/10 bg-neutral-50 p-3 dark:border-white/10 dark:bg-neutral-900/40">
      <p className="text-xs uppercase tracking-wide text-neutral-500">{label}</p>
      <p className="mt-1 text-lg font-semibold">
        <MoneyDisplay cents={totalCents} tone={toneForTotal(totalCents)} />
      </p>
      <p className="mt-1 text-xs text-neutral-500">
        Fecha a {formatDate(cycleEnd)} · Vence a {formatDate(dueDate)}
      </p>
    </div>
  );
}

export function CardStatementCard({ card }: CardStatementCardProps): React.ReactElement {
  return (
    <section className="rounded-lg border border-black/10 bg-white p-4 dark:border-white/10 dark:bg-neutral-900">
      <header className="flex items-center justify-between gap-3">
        <h2 className="text-base font-semibold">
          {card.name}
          {card.last4 ? (
            <span className="ml-1 font-normal text-neutral-400">···· {card.last4}</span>
          ) : null}
        </h2>
        <span className="shrink-0 rounded-full bg-black/5 px-2 py-0.5 text-[0.65rem] uppercase tracking-wide text-neutral-500 dark:bg-white/10">
          {card.cardType === 'credit' ? 'Crédito' : 'Débito'}
        </span>
      </header>
      <p className="mt-0.5 text-xs text-neutral-500">{card.accountName}</p>

      {card.cycle ? (
        <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
          <StatementBlock
            label="Fatura corrente"
            totalCents={card.currentTotalCents}
            cycleEnd={card.cycle.currentCycleEnd}
            dueDate={card.cycle.currentDueDate}
          />
          <StatementBlock
            label="Próxima fatura"
            totalCents={card.nextTotalCents}
            cycleEnd={card.cycle.nextCycleEnd}
            dueDate={card.cycle.nextDueDate}
          />
        </div>
      ) : (
        <p className="mt-3 rounded-md border border-black/10 bg-neutral-50 p-3 text-sm text-neutral-500 dark:border-white/10 dark:bg-neutral-900/40">
          Sem ciclo de fatura definido.
        </p>
      )}

      <CardInstallmentsList installments={card.installments} />
    </section>
  );
}
