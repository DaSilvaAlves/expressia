import type * as React from 'react';

/**
 * `<WidgetSkeleton>` — placeholder leve (pulse) com a forma aproximada de um
 * card de widget (Story 5.6 AC6). Usado como `fallback` de cada `<Suspense>`
 * por widget no `<WidgetGrid>`, para que um widget lento não bloqueie o render
 * dos restantes (front-end-spec §5.4 l.553 + §13 l.1487).
 *
 * `aria-hidden` — o skeleton é decorativo; o conteúdo real anuncia-se quando
 * resolve. `role="status"` no contentor sinaliza carregamento a tecnologias de
 * apoio sem expor a estrutura interna.
 *
 * Trace: Story 5.6 AC6.
 */
export function WidgetSkeleton(): React.ReactElement {
  return (
    <div
      role="status"
      aria-label="A carregar widget"
      className="flex flex-col rounded-lg border border-black/10 bg-white p-4 dark:border-white/10 dark:bg-neutral-900"
    >
      <div aria-hidden className="animate-pulse space-y-3">
        <div className="h-4 w-1/3 rounded bg-neutral-200 dark:bg-neutral-700" />
        <div className="space-y-2">
          <div className="h-3 w-full rounded bg-neutral-200 dark:bg-neutral-700" />
          <div className="h-3 w-5/6 rounded bg-neutral-200 dark:bg-neutral-700" />
          <div className="h-3 w-2/3 rounded bg-neutral-200 dark:bg-neutral-700" />
        </div>
      </div>
    </div>
  );
}
