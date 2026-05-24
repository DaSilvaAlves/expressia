import Link from 'next/link';

import type { AccountBalance, AccountType } from '@/lib/finance/account-balances';

import { MoneyDisplay } from '@meu-jarvis/ui';

/**
 * `<AccountBalanceCard>` — cartão por conta na vista Património
 * (Story 4.9 AC4, AC5, D-4.9.5/8).
 *
 * Mostra: nome + tipo de conta em PT-PT + iban_last4 (`••••1234` se existir);
 * `balanceCents` em destaque com `tone="signed"` (suporta negativo);
 * decomposição "Entradas" (`incomeCents`, income) / "Saídas" (`expenseCents`,
 * expense); link "Ver movimentos" → `/financas/variaveis?account_id=<id>`
 * (drilldown D-4.9.5; reusa filtro da vista 4.7).
 *
 * Trace: Story 4.9 AC4, AC5, D-4.9.5, D-4.9.8.
 */
export interface AccountBalanceCardProps {
  readonly account: AccountBalance;
}

/**
 * Mapa `account_type` enum → label PT-PT (precedente D-4.7.6
 * `RecurrenceFrequencyLabel`). Co-localizado para evitar dispersão.
 */
const ACCOUNT_TYPE_LABEL: Record<AccountType, string> = {
  corrente: 'Conta corrente',
  poupanca: 'Poupança',
  credito_consignado: 'Crédito consignado',
  investimentos: 'Investimentos',
  dinheiro: 'Dinheiro',
  outro: 'Outra',
};

export function AccountBalanceCard({
  account,
}: AccountBalanceCardProps): React.ReactElement {
  const typeLabel = ACCOUNT_TYPE_LABEL[account.accountType];
  const ibanLabel = account.ibanLast4 ? `••••${account.ibanLast4}` : null;

  return (
    <article className="rounded-md border border-black/10 bg-white p-4 dark:border-white/10 dark:bg-neutral-900">
      <header className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="truncate text-base font-semibold">{account.name}</h3>
          <p className="mt-0.5 text-xs text-neutral-500 dark:text-neutral-400">
            {typeLabel}
            {ibanLabel ? <span className="ml-2 font-mono">{ibanLabel}</span> : null}
          </p>
        </div>
        <p className="text-lg font-semibold">
          <MoneyDisplay cents={account.balanceCents} tone="signed" />
        </p>
      </header>

      <dl className="mt-3 grid grid-cols-2 gap-3 border-t border-black/5 pt-3 text-sm dark:border-white/5">
        <div>
          <dt className="text-xs uppercase tracking-wide text-neutral-500">Entradas</dt>
          <dd className="mt-0.5">
            <MoneyDisplay cents={account.incomeCents} tone="income" />
          </dd>
        </div>
        <div>
          <dt className="text-xs uppercase tracking-wide text-neutral-500">Saídas</dt>
          <dd className="mt-0.5">
            <MoneyDisplay cents={account.expenseCents} tone="expense" />
          </dd>
        </div>
      </dl>

      <div className="mt-3 border-t border-black/5 pt-3 dark:border-white/5">
        <Link
          href={`/financas/variaveis?account_id=${account.id}`}
          className="text-sm font-medium text-blue-600 hover:text-blue-700 dark:text-blue-400 dark:hover:text-blue-300"
        >
          Ver movimentos →
        </Link>
      </div>
    </article>
  );
}
