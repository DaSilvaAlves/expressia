'use client';

import { useState } from 'react';

import type { BankGroupBalance } from '@/lib/finance/account-balances';

import { AccountBalanceCard } from '@/app/(app)/financas/_components/AccountBalanceCard';
import { MoneyDisplay } from '@/app/(app)/financas/_components/MoneyDisplay';

/**
 * `<BankGroup>` — grupo colapsável de contas de um banco
 * (Story 4.9 AC4, D-4.9.5/6).
 *
 * Client component (interacção de expandir/colapsar via estado local). Default
 * EXPANDIDO (D-4.9.5). Cabeçalho mostra nome do banco (ou "Sem banco" para
 * `bankName === null` — D-4.9.6) + subtotal do grupo (com sinal — D-4.9.8) +
 * número de contas. Quando expandido, renderiza um `<AccountBalanceCard>` por
 * conta.
 *
 * Trace: Story 4.9 AC4, D-4.9.5, D-4.9.6, D-4.9.8.
 */
export interface BankGroupProps {
  readonly group: BankGroupBalance;
}

/**
 * Converte um nome de banco arbitrário (ex: "Millennium BCP", "Caixa Geral de
 * Depósitos") num slug seguro para usar como HTML id / aria-controls.
 * Acentos descartados, espaços → hífens, caracteres especiais → hífens.
 */
function bankNameToId(bankName: string | null): string {
  if (bankName === null) return 'sem-banco';
  return bankName
    .normalize('NFD')
    .replace(/\p{M}+/gu, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

export function BankGroup({ group }: BankGroupProps): React.ReactElement {
  const [expanded, setExpanded] = useState(true);
  const groupLabel = group.bankName ?? 'Sem banco';
  const bodyId = `bank-group-body-${bankNameToId(group.bankName)}`;
  const count = group.accounts.length;
  const countLabel = count === 1 ? '1 conta' : `${count} contas`;

  return (
    <section
      className="rounded-lg border border-black/10 dark:border-white/10"
      aria-label={`Grupo de banco: ${groupLabel}`}
    >
      <header className="flex items-center justify-between gap-3 px-4 py-3">
        <button
          type="button"
          onClick={() => setExpanded((e) => !e)}
          aria-expanded={expanded}
          aria-controls={bodyId}
          className="flex flex-1 items-center gap-2 text-left text-base font-semibold hover:text-blue-600 dark:hover:text-blue-400"
        >
          <span aria-hidden="true" className="inline-block w-4 text-neutral-500">
            {expanded ? '▾' : '▸'}
          </span>
          <span className="truncate">{groupLabel}</span>
          <span className="ml-2 text-xs font-normal text-neutral-500 dark:text-neutral-400">
            ({countLabel})
          </span>
        </button>
        <p className="shrink-0 text-base font-semibold">
          <MoneyDisplay cents={group.subtotalCents} tone="signed" />
        </p>
      </header>

      {expanded ? (
        <div
          id={bodyId}
          className="space-y-2 border-t border-black/5 bg-neutral-50/50 p-3 dark:border-white/5 dark:bg-neutral-950/40"
        >
          {group.accounts.map((account) => (
            <AccountBalanceCard key={account.id} account={account} />
          ))}
        </div>
      ) : null}
    </section>
  );
}
