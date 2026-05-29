'use client';

import { useRouter } from 'next/navigation';

import { EmptyState as SharedEmptyState } from '@meu-jarvis/ui';

/**
 * `<EmptyState>` — 3 variants PT-PT (Story 3.3 T8.1 / AC9).
 *
 * - `no-tasks`: zero tarefas + zero filtros. **Story 5.9 AC7 — migrado** para
 *   o `<EmptyState variant="tarefas">` de `@meu-jarvis/ui` (copy canónica
 *   front-end-spec §7; o placeholder desactivado "+ Criar primeira tarefa" foi
 *   removido — era não-funcional, "Disponível na próxima versão", D-5.9.2).
 * - `filtered-empty`: zero matches mas filtros activos. CTA limpa filtros (local
 *   — precisa de `router`, sem equivalente directo no shared).
 * - `error`: RSC fetch falhou. CTA tenta novamente (`router.refresh` — local).
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

  // no-tasks — Story 5.9 AC7: delega ao componente shared do design system.
  return <SharedEmptyState variant="tarefas" />;
}
