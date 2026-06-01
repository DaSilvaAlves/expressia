'use client';

import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';

/**
 * Confirmação de aceitação de convite (Story 6.7 AC6).
 *
 * Client Component: botão "Aceitar convite" → POST a
 * `/api/conta/household/aceitar-convite` com o token. Em sucesso encaminha para
 * `/conta/household`. Em erro mostra a mensagem PT-PT devolvida pela API
 * (expirado / já aceite / outro email / limite atingido / ...).
 *
 * Trace: Story 6.7 AC6.
 */

interface AceitarConviteProps {
  readonly token: string;
}

type Estado = 'idle' | 'sucesso';

export function AceitarConvite({ token }: AceitarConviteProps): React.JSX.Element {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [estado, setEstado] = useState<Estado>('idle');
  const [error, setError] = useState<string | null>(null);

  function handleAceitar(): void {
    setError(null);
    startTransition(async () => {
      try {
        const res = await fetch('/api/conta/household/aceitar-convite', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ token }),
        });
        if (!res.ok) {
          const detail = (await res.json().catch(() => null)) as {
            error?: { message?: string };
          } | null;
          throw new Error(detail?.error?.message ?? `Falha ao aceitar (${res.status}).`);
        }
        setEstado('sucesso');
        router.refresh();
        // Pequeno encaminhamento para a página da família.
        router.push('/conta/household');
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Erro ao aceitar o convite.');
      }
    });
  }

  if (estado === 'sucesso') {
    return (
      <p className="text-sm text-primary" role="status">
        Convite aceite. A levar-te para a tua família…
      </p>
    );
  }

  return (
    <div className="space-y-3">
      <button
        type="button"
        onClick={handleAceitar}
        disabled={isPending}
        className="w-full rounded-md bg-primary px-3 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-60"
      >
        {isPending ? 'A aceitar…' : 'Aceitar convite'}
      </button>
      {error && (
        <p className="text-sm text-destructive" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
