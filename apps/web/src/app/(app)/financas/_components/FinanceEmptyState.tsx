'use client';

import { useRouter } from 'next/navigation';

/**
 * `<FinanceEmptyState>` — estados vazios da vista de Finanças (Story 4.6 AC6).
 *
 * - `error`: o fetch RSC falhou. CTA tenta novamente (`router.refresh`).
 * - `no-movements`: o mês não tem transacções reais. Mensagem informativa,
 *   sem erro — usa `monthLabel` para contexto.
 *
 * Trace: Story 4.6 AC6; precedente `EmptyState` (Story 3.3).
 */
export interface FinanceEmptyStateProps {
  readonly variant: 'error' | 'no-movements';
  /** Label do mês (obrigatório para `no-movements`). */
  readonly monthLabel?: string;
}

export function FinanceEmptyState({
  variant,
  monthLabel,
}: FinanceEmptyStateProps): React.ReactElement {
  const router = useRouter();

  if (variant === 'error') {
    return (
      <div
        role="alert"
        className="rounded-lg border border-red-200 bg-red-50 p-6 text-center dark:border-red-900 dark:bg-red-950/30"
      >
        <p className="text-sm text-red-800 dark:text-red-200">
          Não foi possível carregar as finanças. Tenta novamente.
        </p>
        <button
          type="button"
          onClick={() => router.refresh()}
          className="mt-3 rounded-md border border-red-300 bg-white px-3 py-1.5 text-sm font-medium text-red-700 hover:bg-red-50 dark:border-red-700 dark:bg-red-950 dark:text-red-200"
        >
          Tentar novamente
        </button>
      </div>
    );
  }

  // no-movements
  return (
    <div className="rounded-lg border border-black/10 bg-neutral-50 p-8 text-center dark:border-white/10 dark:bg-neutral-900/40">
      <p className="text-sm text-neutral-700 dark:text-neutral-300">
        Sem movimentos registados em <span className="capitalize">{monthLabel ?? 'este mês'}</span>.
      </p>
      <p className="mt-1 text-xs text-neutral-500">
        Fala com o Jarvis ou regista uma transacção para a veres aqui.
      </p>
    </div>
  );
}
