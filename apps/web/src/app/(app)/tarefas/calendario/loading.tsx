/**
 * `/tarefas/calendario` — Loading skeleton (Story 3.5 AC10a).
 *
 * Renderiza sidebar + 7 colunas placeholder com 3 cards skeleton cada.
 * Mantém altura aproximada para evitar layout shift quando RSC real renderizar.
 */
export default function TarefasCalendarioLoading(): React.ReactElement {
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
        <div className="px-4 py-2">
          <div className="h-4 w-24 animate-pulse rounded bg-neutral-200 dark:bg-neutral-700" />
        </div>
      </div>

      <div className="h-10 animate-pulse rounded-md bg-neutral-100 dark:bg-neutral-800" />

      <div
        className="grid gap-2 lg:grid-cols-[140px_1fr]"
        aria-label="A carregar calendário semanal"
      >
        <div className="flex w-full flex-col gap-2 rounded-md border border-black/10 bg-neutral-50 p-2 dark:border-white/10 dark:bg-neutral-900/40">
          <div className="h-6 w-24 animate-pulse rounded bg-neutral-200 dark:bg-neutral-700" />
          {[0, 1, 2, 3, 4].map((idx) => (
            <div key={idx} className="h-7 animate-pulse rounded-sm bg-neutral-200 dark:bg-neutral-700" />
          ))}
        </div>
        <div className="grid grid-cols-1 gap-2 md:grid-cols-3 lg:grid-cols-7">
          {[0, 1, 2, 3, 4, 5, 6].map((colIdx) => (
            <div
              key={colIdx}
              className="flex flex-col gap-1 rounded-md border border-black/10 bg-neutral-50 p-2 dark:border-white/10 dark:bg-neutral-900/40"
            >
              <div className="h-6 w-full animate-pulse rounded bg-neutral-200 dark:bg-neutral-700" />
              {[0, 1, 2].map((cardIdx) => (
                <div key={cardIdx} className="h-7 animate-pulse rounded-sm bg-neutral-200 dark:bg-neutral-700" />
              ))}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
