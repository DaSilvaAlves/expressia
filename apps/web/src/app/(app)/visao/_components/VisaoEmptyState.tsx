import type * as React from 'react';
import Link from 'next/link';

/**
 * `<VisaoEmptyState>` — empty-state central da `/visao` quando NENHUM widget
 * activo tem conteúdo a mostrar (utilizador novo sem tarefas/finanças)
 * (Story 5.6 AC7 / DP-5.6.C).
 *
 * Componente **local** (não `@meu-jarvis/ui` `<EmptyState>`, que só chega na
 * Story 5.9 — DP-5.6.C). Precedente: `financas/_components/FinanceEmptyState.tsx`.
 *
 * Copy PT-PT exacta do front-end-spec §5.4 l.529-542 + §7 l.1232 (AC7.c).
 * CTA `[Abrir o chat]` → `/jarvis` (rota verificada — PO-FIX-1 confirmou as rotas).
 *
 * Server Component (sem `'use client'`) — navegação por `<Link>`, sem estado.
 *
 * Trace: Story 5.6 AC7.
 */
export function VisaoEmptyState(): React.ReactElement {
  return (
    <div className="rounded-lg border border-black/10 bg-neutral-50 p-10 text-center dark:border-white/10 dark:bg-neutral-900/40">
      <p className="text-base font-medium text-neutral-800 dark:text-neutral-200">
        Ainda não há nada para mostrar.
      </p>
      <p className="mt-2 text-sm text-neutral-600 dark:text-neutral-400">
        Carrega no chat e diz &quot;criar tarefa de comprar pão amanhã&quot; para começar.
      </p>
      <div className="mt-5 flex justify-center">
        <Link
          href="/jarvis"
          className="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 dark:bg-blue-500 dark:hover:bg-blue-600"
        >
          Abrir o chat
        </Link>
      </div>
    </div>
  );
}
