'use client';

import { useEffect } from 'react';

export default function ErrorBoundary({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // TODO(Story 2.x): integrar com Sentry quando configurado.
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
