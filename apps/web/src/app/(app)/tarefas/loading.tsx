/**
 * `/tarefas` loading skeleton — Story 3.3 T3.5.
 *
 * Exibido durante navegação RSC (filters/sort change → re-fetch server-side).
 * Skeleton com header + filter bar placeholder + 5 task row placeholders.
 */
export default function Loading(): React.ReactElement {
  return (
    <div className="space-y-6">
      <header className="flex items-center justify-between">
        <div className="h-7 w-32 animate-pulse rounded bg-neutral-200 dark:bg-neutral-800" />
        <div className="h-8 w-20 animate-pulse rounded bg-neutral-200 dark:bg-neutral-800" />
      </header>
      <div className="flex gap-2 border-b border-black/10 dark:border-white/10">
        {Array.from({ length: 3 }).map((_, i) => (
          <div
            key={i}
            className="h-8 w-20 animate-pulse rounded-t bg-neutral-200 dark:bg-neutral-800"
          />
        ))}
      </div>
      <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <div className="h-9 flex-1 animate-pulse rounded bg-neutral-200 dark:bg-neutral-800" />
        <div className="h-9 w-48 animate-pulse rounded bg-neutral-200 dark:bg-neutral-800" />
      </div>
      <div className="space-y-2">
        {Array.from({ length: 5 }).map((_, i) => (
          <div
            key={i}
            className="h-12 w-full animate-pulse rounded bg-neutral-200 dark:bg-neutral-800"
          />
        ))}
      </div>
    </div>
  );
}
