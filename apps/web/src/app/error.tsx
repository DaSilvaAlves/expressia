'use client';

import * as Sentry from '@sentry/nextjs';
import { useEffect } from 'react';

/**
 * Error boundary global da app (App Router).
 *
 * Observabilidade (Soft-launch A3): reporta o erro ao Sentry via
 * `captureException`. O `@sentry/nextjs` é inicializado em
 * `sentry.client.config.ts` com o DSN de `NEXT_PUBLIC_SENTRY_DSN` —
 * `captureException` é **no-op enquanto o DSN não estiver configurado**, pelo que
 * o código pode ir já para produção e só começa a reportar quando o DSN for
 * definido na Vercel (sem partir o boundary nem exigir configuração prévia).
 *
 * Mantemos o `console.error` (visível em logs server/browser) em complemento à
 * captura — útil em dev e quando o Sentry está inactivo.
 *
 * Trace: Story 1.7 (Sentry EU), Soft-launch A3, NFR12.
 */
export default function ErrorBoundary({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // No-op sem DSN — só reporta quando SENTRY_DSN estiver definido na Vercel.
    Sentry.captureException(error);
    // eslint-disable-next-line no-console
    console.error('[Expressia] erro de runtime:', error);
  }, [error]);

  return (
    <main className="flex min-h-screen flex-col items-center justify-center p-8 text-center">
      <h1 className="text-4xl font-bold tracking-tight">Algo correu mal</h1>
      <p className="mt-2 text-lg">Ocorreu um erro inesperado.</p>
      <p className="mt-1 max-w-prose text-sm text-muted-foreground">
        Tenta novamente — se o problema persistir, contacta o suporte.
      </p>
      <button
        type="button"
        onClick={reset}
        className="mt-6 rounded-md border px-4 py-2 text-sm font-medium hover:bg-muted"
      >
        Tentar novamente
      </button>
    </main>
  );
}
