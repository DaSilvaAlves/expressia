'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';

/**
 * `<DeleteRowButton>` — acção de eliminar uma linha das listas de Finanças
 * (Story 4.7 AC5).
 *
 * Componente client parametrizado por `endpoint` — serve tanto a vista
 * "Variáveis" (DELETE hard de transacção) como "Recorrentes" (DELETE soft
 * `active=false`). A semântica hard/soft vive no backend (D-4.7.3); este
 * componente só dispara o pedido.
 *
 * Confirmação explícita obrigatória antes do `fetch` (R-4.7.1) — via
 * `window.confirm`. Em sucesso → `router.refresh()` (RSC re-fetch).
 *
 * Trace: Story 4.7 AC5, D-4.7.3, R-4.7.1.
 */
export interface DeleteRowButtonProps {
  /** Endpoint DELETE — ex: `/api/financas/transacoes/{id}`. */
  readonly endpoint: string;
  /** Mensagem de confirmação (copy distinta para variável vs recorrência). */
  readonly confirmMessage: string;
  /** Label acessível da acção. */
  readonly itemLabel: string;
}

export function DeleteRowButton({
  endpoint,
  confirmMessage,
  itemLabel,
}: DeleteRowButtonProps): React.ReactElement {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  async function handleDelete(): Promise<void> {
    if (!window.confirm(confirmMessage)) return;
    setError(null);
    try {
      const res = await fetch(endpoint, { method: 'DELETE' });
      if (!res.ok) {
        setError('Não foi possível eliminar. Tenta novamente.');
        return;
      }
      startTransition(() => router.refresh());
    } catch {
      setError('Erro de ligação. Tenta novamente.');
    }
  }

  return (
    <span className="inline-flex items-center gap-2">
      {error ? <span className="text-xs text-red-600 dark:text-red-400">{error}</span> : null}
      <button
        type="button"
        onClick={() => void handleDelete()}
        disabled={isPending}
        aria-label={`Eliminar ${itemLabel}`}
        title={`Eliminar ${itemLabel}`}
        className="rounded-md border border-black/15 px-2 py-1 text-xs font-medium text-red-700 hover:bg-red-50 disabled:opacity-50 dark:border-white/15 dark:text-red-300 dark:hover:bg-red-950/40"
      >
        Eliminar
      </button>
    </span>
  );
}
