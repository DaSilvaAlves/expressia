import type * as React from 'react';
import Link from 'next/link';

/**
 * `<WidgetCard>` — wrapper de apresentação consistente dos 7 widgets da Visão
 * (Story 5.6 AC5). Header com título (`<h2>` semântico) + slot opcional de
 * controlos (reservado para a Story 5.7 — NÃO implementado aqui) + área de
 * conteúdo + rodapé opcional com link `"Ver … →"`.
 *
 * Estilo coerente com os cards existentes (`MonthTotalsCard`/`AccountBalanceCard`
 * em `financas/_components/`) + suporte dark mode sem leak (AC5.a). Link de
 * rodapé navegável por teclado via `<Link>` (AC5.b — WCAG AA básico).
 *
 * Trace: Story 5.6 AC5; precedente `financas/_components` cards.
 */
export interface WidgetCardProps {
  /** Título do card (PT-PT) — renderizado como `<h2>` semântico. */
  readonly title: string;
  /** Conteúdo do widget. */
  readonly children: React.ReactNode;
  /** Rodapé opcional `"Ver … →"`. Omitido → sem rodapé. */
  readonly footer?: {
    readonly label: string;
    readonly href: string;
  };
  /**
   * Slot opcional para controlos no header (Story 5.7 — `⚙ ×`). Aqui sempre
   * `undefined`; o slot existe apenas para estabilizar a estrutura.
   */
  readonly headerActions?: React.ReactNode;
}

export function WidgetCard({
  title,
  children,
  footer,
  headerActions,
}: WidgetCardProps): React.ReactElement {
  return (
    <section
      className="flex flex-col rounded-lg border border-black/10 bg-white p-4 dark:border-white/10 dark:bg-neutral-900"
      aria-label={title}
    >
      <header className="mb-3 flex items-center justify-between gap-2">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-neutral-500">
          {title}
        </h2>
        {headerActions ? <div className="flex items-center gap-1">{headerActions}</div> : null}
      </header>

      <div className="flex-1 text-sm text-neutral-800 dark:text-neutral-200">{children}</div>

      {footer ? (
        <footer className="mt-3 border-t border-black/5 pt-3 dark:border-white/5">
          <Link
            href={footer.href}
            className="text-sm font-medium text-blue-600 hover:underline dark:text-blue-400"
          >
            {footer.label} →
          </Link>
        </footer>
      ) : null}
    </section>
  );
}
