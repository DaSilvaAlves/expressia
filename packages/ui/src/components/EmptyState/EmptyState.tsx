import type * as React from 'react';

/**
 * `<EmptyState>` — estado vazio partilhado do design system (Story 5.9 AC4 —
 * DP-5.9.C). Server Component (sem `'use client'`) — navegação via `<a href>`
 * simples (o `packages/ui` é framework-agnóstico: não depende de `next` nem de
 * `react-router`; um CTA de empty-state não precisa de client-side routing e o
 * `<a>` renderiza HTML idêntico ao `<Link>` — byte-a-byte com o precedente
 * `VisaoEmptyState` consolidado nesta story, AC5.c).
 *
 * **API (DP-5.9.C = A parcial):** props genéricas (`illustration?/title?/body?/
 * cta?`) + `variant?` enum com defaults PT-PT. Um caller pode passar só
 * `variant="chat"` (defaults) OU props explícitas (override). Props explícitas
 * têm precedência sobre os defaults da variante.
 *
 * **Ilustração:** `illustration` é opcional (`null`/`undefined` → sem
 * ilustração). No MVP não há SVGs de designer; o Epic 5 §7 prevê ilustrações
 * reais no Epic 6 (front-end-spec). Aceitar `null` é intencional.
 *
 * **Estilo:** replicado byte-a-byte do VisaoEmptyState da Story 5.6 (mesmo
 * padding, superfície neutra clara e CTA azul) — PO-FIX-3 (@po): alinhar com o
 * precedente real, não inventar. Dark mode sem leak (variante escura em todas
 * as classes de cor).
 *
 * Trace: Story 5.9 AC4/AC5/AC6; DP-5.9.C; front-end-spec §7 (lista de empty
 * states); precedente `VisaoEmptyState.tsx`.
 */

/** Variantes com defaults PT-PT pré-definidos (front-end-spec §7). */
export type EmptyStateVariant = 'visao' | 'tarefas' | 'financas' | 'chat';

/** CTA opcional do empty-state. */
export interface EmptyStateCta {
  readonly label: string;
  readonly href: string;
}

export interface EmptyStateProps {
  /** Variante com defaults PT-PT. Se fornecida, `title`/`body`/`cta` são opcionais. */
  readonly variant?: EmptyStateVariant;
  /** Ilustração SVG opcional (Epic 6). `null`/`undefined` → sem ilustração. */
  readonly illustration?: React.ReactNode;
  /** Título principal (override do default da variante). */
  readonly title?: string;
  /** Copy explicativa (override do default da variante). */
  readonly body?: string;
  /** CTA opcional (override do default da variante). */
  readonly cta?: EmptyStateCta;
}

interface VariantDefaults {
  readonly title: string;
  readonly body: string;
  readonly cta?: EmptyStateCta;
}

/** Defaults PT-PT por variante (front-end-spec §7 l.1232-1239). */
const VARIANT_DEFAULTS: Record<EmptyStateVariant, VariantDefaults> = {
  visao: {
    title: 'Ainda não há nada para mostrar.',
    body: 'Carrega no chat e diz "criar tarefa de comprar pão amanhã" para começar.',
    cta: { label: 'Abrir o chat', href: '/jarvis' },
  },
  tarefas: {
    title: 'Sem tarefas para mostrar.',
    body: 'Diz ao chat ou adiciona manualmente.',
    cta: { label: 'Abrir o chat', href: '/jarvis' },
  },
  financas: {
    title: 'Sem movimentos registados.',
    body: 'Diz ao chat "gastei €X em Y" ou adiciona manualmente.',
    cta: { label: 'Abrir o chat', href: '/jarvis' },
  },
  chat: {
    title: 'Olá. Em que posso ajudar?',
    body: 'Escreve uma mensagem para começar.',
    // sem CTA — já estamos no chat.
  },
};

export function EmptyState({
  variant,
  illustration,
  title,
  body,
  cta,
}: EmptyStateProps): React.ReactElement {
  const defaults = variant ? VARIANT_DEFAULTS[variant] : undefined;
  const resolvedTitle = title ?? defaults?.title ?? '';
  const resolvedBody = body ?? defaults?.body ?? '';
  // `cta` explícito tem precedência; senão usa o default da variante (pode ser undefined).
  const resolvedCta = cta ?? defaults?.cta;

  return (
    <div className="rounded-lg border border-black/10 bg-neutral-50 p-10 text-center dark:border-white/10 dark:bg-neutral-900/40">
      {illustration ? <div className="mb-4 flex justify-center">{illustration}</div> : null}
      <p className="text-base font-medium text-neutral-800 dark:text-neutral-200">
        {resolvedTitle}
      </p>
      <p className="mt-2 text-sm text-neutral-600 dark:text-neutral-400">{resolvedBody}</p>
      {resolvedCta ? (
        <div className="mt-5 flex justify-center">
          <a
            href={resolvedCta.href}
            className="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 dark:bg-blue-500 dark:hover:bg-blue-600"
          >
            {resolvedCta.label}
          </a>
        </div>
      ) : null}
    </div>
  );
}
