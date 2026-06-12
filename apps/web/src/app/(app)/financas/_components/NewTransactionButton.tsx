'use client';

import { useState } from 'react';

import type { FinanceFilterOptions } from '@/lib/finance/list-variable-transactions';

import { NewTransactionModal } from '@/app/(app)/financas/_components/NewTransactionModal';

/**
 * `<NewTransactionButton>` — botão "+ Nova" (client) que abre o
 * `<NewTransactionModal>` (A1 make-it-work).
 *
 * A página `/financas/variaveis` é um RSC; este wrapper isola o estado de
 * abertura do modal no cliente. Substitui o antigo botão `disabled` hardcoded
 * ("Disponível na próxima versão — usa o Jarvis para registar transacções").
 */
export function NewTransactionButton({
  options,
}: {
  readonly options: FinanceFilterOptions;
}): React.ReactElement {
  const [open, setOpen] = useState(false);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="rounded-md bg-blue-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-blue-700"
      >
        + Nova
      </button>
      <NewTransactionModal open={open} onClose={() => setOpen(false)} options={options} />
    </>
  );
}
