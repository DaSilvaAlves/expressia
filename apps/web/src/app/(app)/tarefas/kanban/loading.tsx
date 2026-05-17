/**
 * `/tarefas/kanban` — Loading skeleton (Story 3.4 T4.2).
 *
 * Renderiza 4 colunas placeholder com 3 cards skeleton cada. Mantém o height
 * aproximado para evitar layout shift quando a página real renderizar.
 */
export default function TarefasKanbanLoading(): React.ReactElement {
  return (
    <div className="space-y-6">
      <header className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">Tarefas</h1>
      </header>

      <div className="flex gap-1 border-b border-black/10 dark:border-white/10" aria-hidden="true">
        <div className="px-4 py-2">
          <div className="h-4 w-16 animate-pulse rounded bg-neutral-200 dark:bg-neutral-700" />
        </div>
        <div className="px-4 py-2">
          <div className="h-4 w-20 animate-pulse rounded bg-neutral-200 dark:bg-neutral-700" />
        </div>
      </div>

      <div className="flex gap-4 overflow-x-hidden" aria-label="A carregar quadro Kanban">
        {[0, 1, 2, 3].map((colIdx) => (
          <div
            key={colIdx}
            className="flex w-72 shrink-0 flex-col gap-2 rounded-lg border border-black/10 bg-neutral-50 p-3 dark:border-white/10 dark:bg-neutral-900/40"
          >
            <div className="h-6 w-32 animate-pulse rounded bg-neutral-200 dark:bg-neutral-700" />
            {[0, 1, 2].map((cardIdx) => (
              <div
                key={cardIdx}
                className="h-18 animate-pulse rounded-md bg-neutral-200 dark:bg-neutral-700"
                style={{ height: 72 }}
              />
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}
