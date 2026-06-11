'use client';

import { useState } from 'react';

import { NewTaskModal } from '@/app/(app)/tarefas/_components/NewTaskModal';

/**
 * `<NewTaskButton>` — botão "+ Nova" (client) que abre o `<NewTaskModal>`.
 *
 * A página `/tarefas` é um RSC; este wrapper isola o estado de abertura do
 * modal para o lado do cliente. Substitui o antigo botão `disabled` hardcoded
 * ("Disponível na próxima versão — usa o Jarvis para criar tarefas").
 */
export function NewTaskButton(): React.ReactElement {
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
      <NewTaskModal open={open} onClose={() => setOpen(false)} />
    </>
  );
}
