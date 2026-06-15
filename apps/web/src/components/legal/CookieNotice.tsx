'use client';

/**
 * `CookieNotice` — aviso mínimo de cookies para a landing pública (`/`).
 *
 * A Expressia utiliza apenas cookies ESSENCIAIS de sessão (autenticação), que
 * não exigem consentimento prévio nos termos do RGPD. Ainda assim, por boa
 * prática de transparência, informamos o visitante na primeira visita. Não é um
 * gestor de consentimento pesado — é um aviso informativo com botão de
 * dispensa.
 *
 * Montado SÓ na landing pública (`page.tsx`), nunca dentro da app autenticada:
 *   - a landing é o primeiro ponto de contacto público — local natural do aviso;
 *   - dentro de `(app)` seria ruído, já que só há cookies essenciais.
 *
 * LIÇÃO FIX-1 (Story 5.7, CRÍTICA): Client Components renderizam no SSR. O
 * acesso a `localStorage` é SEMPRE em `useEffect` (client-only) — NUNCA no corpo
 * do render nem no `useState` inicial — para não quebrar o SSR (sem `window`) e
 * evitar mismatch de hidratação. O banner começa oculto e só aparece após o
 * effect confirmar (client-side) que ainda não foi dispensado.
 *
 * Persistência via `localStorage` (guard de primeira visita) — não é um cookie,
 * pelo que não conflitua com a própria política de cookies essenciais.
 *
 * Trace: prontidão soft-launch (transparência RGPD/cookies).
 */
import { useEffect, useState } from 'react';

import Link from 'next/link';

/** Chave de `localStorage` que marca o aviso como dispensado pelo utilizador. */
const COOKIE_NOTICE_KEY = 'expressia-cookie-notice-dismissed';

export function CookieNotice(): React.ReactElement | null {
  // Começa oculto: evita flash do banner no SSR e antes do effect ler o guard.
  const [visible, setVisible] = useState(false);

  // FIX-1: leitura de `localStorage` SÓ no client, dentro do effect.
  useEffect(() => {
    try {
      const dismissed = window.localStorage.getItem(COOKIE_NOTICE_KEY);
      if (dismissed !== 'true') setVisible(true);
    } catch {
      // `localStorage` pode lançar (modo privado/storage bloqueado). Nesse caso,
      // mostramos o aviso — degradação graciosa, sem quebrar a página.
      setVisible(true);
    }
  }, []);

  function handleDismiss(): void {
    try {
      window.localStorage.setItem(COOKIE_NOTICE_KEY, 'true');
    } catch {
      // Ignora falhas de escrita (storage bloqueado) — fecha à mesma na sessão.
    }
    setVisible(false);
  }

  if (!visible) return null;

  return (
    <div
      role="region"
      aria-label="Aviso de cookies"
      className="fixed inset-x-0 bottom-0 z-50 border-t border-border-default bg-surface px-6 py-4 shadow-lg"
    >
      <div className="mx-auto flex w-full max-w-3xl flex-col items-start gap-3 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-sm text-foreground">
          Utilizamos cookies essenciais para o funcionamento do serviço. Sabe mais na nossa{' '}
          <Link
            href="/privacidade"
            className="text-primary underline-offset-4 hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-surface"
          >
            Política de Privacidade
          </Link>
          .
        </p>
        <button
          type="button"
          onClick={handleDismiss}
          className="flex min-h-11 shrink-0 items-center justify-center rounded-md bg-primary px-5 py-2 text-sm font-medium text-surface transition-colors hover:bg-primary-hover focus:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-surface"
        >
          Compreendi
        </button>
      </div>
    </div>
  );
}
