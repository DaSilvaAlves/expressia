'use client';

import { useState } from 'react';

import { NewAccountModal } from '@/app/(app)/financas/_components/NewAccountModal';

/**
 * `<NewAccountButton>` — botão "+ Nova conta" (client) que abre o
 * `<NewAccountModal>` (A2 make-it-work).
 *
 * A página `/financas/patrimonio` é um RSC; este wrapper isola o estado de
 * abertura do modal no cliente. Substitui o antigo botão `disabled` hardcoded
 * ("Disponível na próxima versão — a gestão de contas será adicionada numa
 * story dedicada").
 */
export function NewAccountButton(): React.ReactElement {
  const [open, setOpen] = useState(false);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="rounded-md bg-blue-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-blue-700"
      >
        + Nova conta
      </button>
      <NewAccountModal open={open} onClose={() => setOpen(false)} />
    </>
  );
}
