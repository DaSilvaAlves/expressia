'use client';

import { useState } from 'react';

import { NewCardModal } from '@/app/(app)/financas/_components/NewCardModal';

/**
 * `<NewCardButton>` — botão "+ Novo" (client) que abre o `<NewCardModal>`
 * (A3 make-it-work).
 *
 * A página `/financas/cartoes` é um RSC; este wrapper isola o estado de
 * abertura do modal no cliente. Substitui o antigo botão `disabled` hardcoded
 * ("Disponível na próxima versão — usa o Jarvis para criar cartões").
 */
export function NewCardButton(): React.ReactElement {
  const [open, setOpen] = useState(false);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="rounded-md bg-blue-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-blue-700"
      >
        + Novo
      </button>
      <NewCardModal open={open} onClose={() => setOpen(false)} />
    </>
  );
}
