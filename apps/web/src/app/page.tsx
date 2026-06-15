import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';

import { createServerSupabaseClient } from '@meu-jarvis/auth/server';

export const metadata: Metadata = {
  title: 'Expressia — Tarefas, finanças e rotinas da família',
  description:
    'O assistente em português europeu para organizar tarefas, finanças e as rotinas da tua família. Experimenta grátis, sem cartão.',
};

/**
 * `force-dynamic` — a raiz `/` lê a sessão via Supabase Auth (`cookies()`), pelo
 * que tem de ser sempre renderizada por request. Sem isto, o Next podia tentar
 * pré-renderizar estaticamente e nunca aplicar o `redirect('/visao')` do
 * utilizador autenticado.
 */
export const dynamic = 'force-dynamic';

/**
 * Raiz `/` — porta de entrada pública do produto (Story 5.10 AC6, DP-5.10.F = B).
 *
 * Comportamento condicional à sessão (a verificação corre ANTES de qualquer
 * render — AC6.d, sem leak sessão→landing):
 *   (a) AUTENTICADO → `redirect('/visao')` (precedente RSC `visao/page.tsx`).
 *   (b) NÃO-AUTENTICADO → landing pública de marketing: wordmark "Expressia"
 *       (`font-serif`, coerente com `(auth)/layout.tsx`/`OnboardingTour`), claim
 *       PT-PT (tarefas + finanças + rotinas da família), CTA primário
 *       "Experimenta grátis" → `/registar` (sem cartão, FR33) + CTA secundário
 *       "Entrar" → `/entrar`.
 *
 * Design dark-first com tokens `@meu-jarvis/ui` — sem cores hardcoded (AC7.c).
 * Touch targets ≥ 44px nos dois CTAs (`min-h-11` = 44px / front-end-spec §9).
 * Sem hero/secções de feature elaboradas — não há wireframe; não inventar
 * (Constitution Article IV; DP-5.10.F rejeita C).
 *
 * Trace: Story 5.10 AC6, AC7; DP-5.10.F = B; FR33 (trial sem cartão); NFR5/NFR8.
 */
export default async function HomePage(): Promise<React.ReactElement> {
  const supabase = await createServerSupabaseClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  // Sessão válida → directo para a Visão (preserva DP5 = A para o caso autenticado).
  // Corre ANTES do render da landing (AC6.d) — um autenticado nunca a vê.
  if (user) redirect('/visao');

  return (
    <main className="flex min-h-screen flex-col items-center justify-center bg-canvas px-6 py-16 text-center">
      <div className="flex w-full max-w-md flex-col items-center gap-8">
        <header className="flex flex-col items-center gap-4">
          <h1 className="font-serif text-5xl font-bold tracking-tight text-primary sm:text-6xl">
            Expressia
          </h1>
          <p className="max-w-prose text-balance text-lg text-foreground sm:text-xl">
            O assistente em português europeu para organizar as tarefas, as finanças e as rotinas
            da tua família — num só sítio.
          </p>
        </header>

        <div className="flex w-full flex-col gap-3">
          <Link
            href="/registar"
            className="flex min-h-11 w-full items-center justify-center rounded-md bg-primary px-6 py-3 text-base font-medium text-surface transition-colors hover:bg-primary-hover focus:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-canvas"
          >
            Experimenta grátis
          </Link>
          <Link
            href="/entrar"
            className="flex min-h-11 w-full items-center justify-center rounded-md border border-border-default px-6 py-3 text-base font-medium text-foreground transition-colors hover:bg-bg-muted focus:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-canvas"
          >
            Entrar
          </Link>
        </div>

        <p className="text-sm text-muted-foreground">14 dias grátis com plano Família. Sem cartão.</p>
      </div>
    </main>
  );
}
