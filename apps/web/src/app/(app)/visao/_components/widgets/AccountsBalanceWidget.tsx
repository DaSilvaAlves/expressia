import type * as React from 'react';

import { captureException } from '@meu-jarvis/observability';
import { MoneyDisplay } from '@meu-jarvis/ui';

import { getDb } from '@/lib/agent/db-shim';
import { getAccountsBalance } from '@/lib/visao/queries';
import { WidgetCard } from '@/app/(app)/visao/_components/WidgetCard';

/**
 * `<AccountsBalanceWidget>` — widget `accounts_balance` (Story 5.6 AC4).
 *
 * RSC-direct via `getDb()` + `getAccountsBalance` (DP-5.6.A=B). Mostra o saldo
 * total (`totalBalanceCents`, tone `signed`) + nº de contas. Empty inline quando
 * não há contas. Rodapé "Ver contas →" `/financas/patrimonio`.
 *
 * Default OFF — só renderiza quando o utilizador o activa em `widgets_enabled`.
 *
 * Trace: Story 5.6 AC4 (accounts_balance); RLS NFR5.
 */
export async function AccountsBalanceWidget(): Promise<React.ReactElement> {
  let totalBalanceCents = 0;
  let accountCount = 0;
  try {
    const data = await getAccountsBalance(getDb());
    totalBalanceCents = data.totalBalanceCents;
    accountCount = data.accountCount;
  } catch (err) {
    captureException(err instanceof Error ? err : new Error(String(err)), {
      route: '/visao',
      extra: { widget: 'accounts_balance' },
    });
  }

  return (
    <WidgetCard title="Saldo por conta" footer={{ label: 'Ver contas', href: '/financas/patrimonio' }}>
      {accountCount === 0 ? (
        <p className="text-neutral-500">Sem contas registadas.</p>
      ) : (
        <div className="space-y-1">
          <p className="text-lg font-semibold">
            <MoneyDisplay cents={totalBalanceCents} tone="signed" />
          </p>
          <p className="text-xs text-neutral-500">
            {accountCount} {accountCount === 1 ? 'conta' : 'contas'}
          </p>
        </div>
      )}
    </WidgetCard>
  );
}
