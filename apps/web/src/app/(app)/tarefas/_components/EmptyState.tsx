'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';

/**
 * `<EmptyState>` — 3 variants PT-PT (Story 3.3 T8.1 / AC9).
 *
 * - `no-tasks`: zero tarefas + zero filtros. CTA cria primeira + link Jarvis.
 * - `filtered-empty`: zero matches mas filtros activos. CTA limpa filtros.
 * - `error`: RSC fetch falhou. CTA tenta novamente (router.refresh).
 */
export interface EmptyStateProps {
  readonly variant: 'no-tasks' | 'filtered-empty' | 'error';
}

export function EmptyState({ variant }: EmptyStateProps): React.ReactElement {
  const router = useRouter();

  if (variant === 'error') {
    return (
      <div
        role="alert"
        className="rounded-lg border border-red-200 bg-red-50 p-6 text-center dark:border-red-900 dark:bg-red-950/30"
      >
        <p className="text-sm text-red-800 dark:text-red-200">
          Não foi possível carregar as tarefas. Tenta novamente.
        </p>
        <button
          type="button"
          onClick={() => router.refresh()}
          className="mt-3 rounded-md border border-red-300 bg-white px-3 py-1.5 text-sm font-medium text-red-700 hover:bg-red-50 dark:border-red-700 dark:bg-red-950 dark:text-red-200"
        >
          Tentar novamente
        </button>
      </div>
    );
  }

  if (variant === 'filtered-empty') {
    return (
      <div className="rounded-lg border border-black/10 bg-neutral-50 p-6 text-center dark:border-white/10 dark:bg-neutral-900/40">
        <p className="text-sm text-neutral-700 dark:text-neutral-300">
          Sem tarefas com este filtro. Limpa filtros ou cria uma.
        </p>
        <button
          type="button"
          onClick={() => router.push('/tarefas')}
          className="mt-3 rounded-md border border-black/15 bg-white px-3 py-1.5 text-sm font-medium hover:bg-neutral-50 dark:border-white/15 dark:bg-neutral-800 dark:hover:bg-neutral-700"
        >
          Limpar filtros
        </button>
      </div>
    );
  }

  // no-tasks
  return (
    <div className="rounded-lg border border-black/10 bg-neutral-50 p-8 text-center dark:border-white/10 dark:bg-neutral-900/40">
      <p className="text-sm text-neutral-700 dark:text-neutral-300">
        Ainda não tens tarefas. Fala com o Jarvis ou cria a primeira.
      </p>
      <div className="mt-4 flex justify-center gap-2">
        <button
          type="button"
          disabled
          title="Disponível na próxima versão — usa o Jarvis"
          className="cursor-not-allowed rounded-md bg-blue-600 px-3 py-1.5 text-sm font-medium text-white opacity-60"
        >
          + Criar primeira tarefa
        </button>
        <Link
          href="/jarvis"
          className="rounded-md border border-black/15 px-3 py-1.5 text-sm font-medium hover:bg-neutral-100 dark:border-white/15 dark:hover:bg-neutral-800"
        >
          Falar com o Jarvis
        </Link>
      </div>
    </div>
  );
}
