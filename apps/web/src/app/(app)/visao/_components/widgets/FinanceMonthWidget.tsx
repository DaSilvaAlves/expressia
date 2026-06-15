import type * as React from 'react';

import { captureException } from '@meu-jarvis/observability';
import { MoneyDisplay } from '@meu-jarvis/ui';

import { getFinancesMonthCached } from '@/lib/visao/queries';
import { WidgetCard } from '@/app/(app)/visao/_components/WidgetCard';

/**
 * `<FinanceMonthWidget>` — widget `finance_month` (Story 5.6 AC4).
 *
 * RSC-direct via `getFinancesMonthCached` (Story 5.10 AC5 — `React.cache`).
 * Mostra o saldo do
 * mês (`balance`, tone `signed`) + entradas/saídas + nº transacções. Empty inline
 * quando não há transacções. Rodapé "Ver mês →" `/financas/este-mes`.
 *
 * Valores via `<MoneyDisplay>` — nunca formatar `€` à mão (CON9).
 *
 * Trace: Story 5.6 AC4 (finance_month); RLS NFR5.
 */
export async function FinanceMonthWidget({
  householdId,
  userId,
}: {
  householdId: string;
  userId: string;
}): Promise<React.ReactElement> {
  let incomeTotal = 0;
  let expenseTotal = 0;
  let balance = 0;
  let transactionCount = 0;
  try {
    // SEC-6 — RLS-enforced no wrapper; 1.ª rede mantida no helper. Cache dedup.
    const data = await getFinancesMonthCached(userId, householdId);
    incomeTotal = data.incomeTotal;
    expenseTotal = data.expenseTotal;
    balance = data.balance;
    transactionCount = data.transactionCount;
  } catch (err) {
    captureException(err instanceof Error ? err : new Error(String(err)), {
      route: '/visao',
      extra: { widget: 'finance_month' },
    });
  }

  return (
    <WidgetCard title="Gastos do mês" footer={{ label: 'Ver mês', href: '/financas/este-mes' }}>
      {transactionCount === 0 ? (
        <p className="text-neutral-500">Sem movimentos este mês.</p>
      ) : (
        <div className="space-y-2">
          <p className="text-lg font-semibold">
            <MoneyDisplay cents={balance} tone="signed" />
          </p>
          <dl className="grid grid-cols-2 gap-x-2 gap-y-1 text-xs text-neutral-500">
            <dt>Entrou</dt>
            <dd className="text-right">
              <MoneyDisplay cents={incomeTotal} tone="income" />
            </dd>
            <dt>Saiu</dt>
            <dd className="text-right">
              <MoneyDisplay cents={expenseTotal} tone="expense" />
            </dd>
          </dl>
          <p className="text-xs text-neutral-500">
            {transactionCount} {transactionCount === 1 ? 'transacção' : 'transacções'}
          </p>
        </div>
      )}
    </WidgetCard>
  );
}
