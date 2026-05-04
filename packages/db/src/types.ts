/**
 * Tipos TypeScript partilhados — meu-jarvis (Expressia).
 *
 * Drizzle infere `InferSelectModel<typeof tasks>` etc. directamente das tabelas;
 * este ficheiro só contém os tipos auxiliares (unions, helpers) que não
 * vivem nas tabelas.
 */

/** Planos de subscrição. */
export type PlanTier = 'free' | 'pessoal' | 'familia' | 'pro';

/** Limite de membros por plano (FR27). */
export const PLAN_MEMBER_LIMITS: Record<PlanTier, number> = {
  free: 1,
  pessoal: 1,
  familia: 4,
  pro: 10,
};

/** Quotas LLM por plano (NFR20, architecture §4.6). */
export const PLAN_LLM_QUOTAS: Record<
  PlanTier,
  { promptsPerMonth: number; outputTokensPerMonth: number }
> = {
  free: { promptsPerMonth: 50, outputTokensPerMonth: 50_000 },
  pessoal: { promptsPerMonth: 1_500, outputTokensPerMonth: 1_500_000 },
  familia: { promptsPerMonth: 3_000, outputTokensPerMonth: 3_000_000 },
  pro: { promptsPerMonth: 10_000, outputTokensPerMonth: 10_000_000 },
};

/** Tipos de operação reversível para o agent_reverse_ops (FR6). */
export type ReverseOpKind =
  | { kind: 'delete_row'; table: string; id: string }
  | { kind: 'restore_row'; table: string; id: string; snapshot: Record<string, unknown> }
  | { kind: 'composite'; ops: ReverseOpKind[] };

/** Métodos de pagamento PT (FR36). */
export type PaymentMethodPt = 'card' | 'multibanco' | 'mb_way';

/**
 * Formatador EUR PT-PT canónico (€1.234,56).
 * Sempre que escrever moeda em UI: `formatEur(amount)` — nunca inline.
 */
export function formatEur(amountEur: number): string {
  return new Intl.NumberFormat('pt-PT', {
    style: 'currency',
    currency: 'EUR',
    minimumFractionDigits: 2,
  }).format(amountEur);
}

/**
 * Formatador de data PT-PT (DD/MM/YYYY).
 */
export function formatDatePt(date: Date | string): string {
  const d = typeof date === 'string' ? new Date(date) : date;
  return new Intl.DateTimeFormat('pt-PT', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  }).format(d);
}
