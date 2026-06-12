'use client';

import { useState } from 'react';

import { NewRecurrenceModal } from '@/app/(app)/financas/_components/NewRecurrenceModal';

/**
 * `<NewRecurrenceButton>` — botão "+ Nova" (client) que abre o
 * `<NewRecurrenceModal>` (A4 make-it-work).
 *
 * A página `/financas/recorrentes` é um RSC; este wrapper isola o estado de
 * abertura do modal no cliente. Substitui o antigo botão `disabled` hardcoded
 * ("Disponível na próxima versão — usa o Jarvis para criar recorrências").
 */
export function NewRecurrenceButton(): React.ReactElement {
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
      <NewRecurrenceModal open={open} onClose={() => setOpen(false)} />
    </>
  );
}
