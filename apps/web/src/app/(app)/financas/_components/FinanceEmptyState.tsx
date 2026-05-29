'use client';

import { useRouter } from 'next/navigation';

import { EmptyState as SharedEmptyState } from '@meu-jarvis/ui';

/**
 * `<FinanceEmptyState>` — estados vazios das vistas de Finanças
 * (Story 4.6 AC6; variant `no-results` adicionado na Story 4.7 AC7).
 *
 * - `error`: o fetch RSC falhou. CTA tenta novamente (`router.refresh` — local).
 * - `no-movements`: o mês não tem transacções reais (vista "Este mês"). **Story
 *   5.9 AC7 — migrado** para o `<EmptyState>` de `@meu-jarvis/ui` (props
 *   explícitas preservam a copy + o mês; D-5.9.3).
 * - `no-results`: lista sem resultados (vistas "Variáveis"/"Recorrentes") —
 *   distingue "sem dados" de "sem resultados para os filtros" via `message`
 *   (local — shape de 1 linha sem equivalente directo no shared).
 *
 * Trace: Story 4.6 AC6, Story 4.7 AC7; Story 5.9 AC7.
 */
export interface FinanceEmptyStateProps {
  readonly variant: 'error' | 'no-movements' | 'no-results';
  /** Label do mês (variant `no-movements`). */
  readonly monthLabel?: string;
  /** Mensagem (variant `no-results`). */
  readonly message?: string;
}

export function FinanceEmptyState({
  variant,
  monthLabel,
  message,
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

  if (variant === 'no-results') {
    return (
      <div className="rounded-lg border border-black/10 bg-neutral-50 p-8 text-center dark:border-white/10 dark:bg-neutral-900/40">
        <p className="text-sm text-neutral-700 dark:text-neutral-300">
          {message ?? 'Sem resultados.'}
        </p>
      </div>
    );
  }

  // no-movements — Story 5.9 AC7: delega ao componente shared do design system
  // (props explícitas preservam a copy original + o mês — zero regressão de copy).
  return (
    <SharedEmptyState
      title={`Sem movimentos registados em ${monthLabel ?? 'este mês'}.`}
      body="Fala com o Jarvis ou regista uma transacção para a veres aqui."
    />
  );
}
