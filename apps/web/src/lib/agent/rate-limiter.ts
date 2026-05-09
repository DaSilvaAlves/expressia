/**
 * Rate limiting + quota helper — Story 2.6 AC9 + D17 + D18.
 *
 * MVP Postgres counter (D18) — 10 req/min burst per household
 * (Architecture §7.2 literal). Migração para Upstash Redis EU em Story 2.9
 * (EB3 desbloqueado).
 *
 * Quota mensal: derivada de `households.plan` + tier config (D18 PO_FIX) —
 * `agent_quotas.prompts_used` é o contador, hard-stop quando atinge limite
 * por plano (NFR20).
 *
 * Trace: Story 2.6 AC9 + D17 + D18, Architecture §4.6 + §7.2, NFR13 + NFR20.
 */
import { sql } from 'drizzle-orm';

/**
 * Type alias minimal — qualquer cliente Drizzle aceitando `execute(sql\`...\`)`.
 * Evita import cross-package de `@meu-jarvis/db/client`.
 */
type Database = {
  execute<T = unknown>(query: ReturnType<typeof sql>): Promise<T[]>;
};

/**
 * Limite hard-coded para MVP — Architecture §7.2 literal "10 req/min burst".
 * Ajustável em produção via env `AGENT_RATE_LIMIT_PER_MINUTE` (override).
 */
export const RATE_LIMIT_PER_MINUTE = (() => {
  const fromEnv = Number(process.env.AGENT_RATE_LIMIT_PER_MINUTE);
  return Number.isFinite(fromEnv) && fromEnv > 0 ? fromEnv : 10;
})();

/**
 * Quota mensal por plano (NFR20 / Architecture §4.6 — tier-derived).
 * Valores hard-coded para MVP; migração para tabela config em Story 2.9.
 *
 * Decisão D18 PO_FIX: `agent_quotas.quota_limit` NÃO existe — usar derivação
 * via `households.plan`.
 */
export const QUOTA_BY_PLAN: Record<string, number> = {
  free: 100,
  pessoal: 500,
  familia: 2000,
  pro: 10_000,
};

/**
 * Erro lançado quando o rate limit por minuto é excedido.
 * Mapeado para HTTP 429 + `RATE_LIMIT_EXCEEDED` no handler principal.
 */
export class RateLimitError extends Error {
  readonly retryAfterSeconds: number;
  readonly currentCount: number;
  readonly limit: number;

  constructor(currentCount: number, limit: number, retryAfterSeconds: number) {
    super(
      `Rate limit excedido: ${currentCount}/${limit} pedidos por minuto. Tenta novamente em ${retryAfterSeconds}s.`,
    );
    this.name = 'RateLimitError';
    this.retryAfterSeconds = retryAfterSeconds;
    this.currentCount = currentCount;
    this.limit = limit;
  }
}

/**
 * Erro lançado quando a quota mensal é excedida.
 * Mapeado para HTTP 429 + `QUOTA_EXCEEDED` no handler principal.
 */
export class QuotaExceededError extends Error {
  readonly plan: string;
  readonly used: number;
  readonly limit: number;

  constructor(plan: string, used: number, limit: number) {
    super(
      `Quota mensal excedida no plano "${plan}": ${used}/${limit} prompts utilizados este mês.`,
    );
    this.name = 'QuotaExceededError';
    this.plan = plan;
    this.used = used;
    this.limit = limit;
  }
}

/**
 * Verifica e incrementa atomicamente o rate limit counter para o household.
 *
 * Implementação via UPSERT Postgres com `date_trunc('minute', now())` —
 * atómico e race-free. Se exceder o limite, lança `RateLimitError` SEM
 * incrementar (decrement não é necessário porque o `INSERT...ON CONFLICT...
 * DO UPDATE` retorna o valor pós-increment via RETURNING).
 *
 * @throws {RateLimitError} se o counter excede `RATE_LIMIT_PER_MINUTE`
 */
export async function checkRateLimit(householdId: string, db: Database): Promise<void> {
  // UPSERT atómico — incrementa e retorna count actualizado.
  // window_start é truncado a 1-min boundary (date_trunc('minute', now())).
  const rows = await db.execute<{ count: number }>(sql`
    insert into agent_rate_limit_counters (household_id, window_start, count)
    values (${householdId}::uuid, date_trunc('minute', now()), 1)
    on conflict (household_id, window_start) do update
      set count = agent_rate_limit_counters.count + 1,
          updated_at = now()
    returning count
  `);

  const newCount = Number(rows[0]?.count ?? 0);
  if (newCount > RATE_LIMIT_PER_MINUTE) {
    // Calcular Retry-After até ao próximo minuto inteiro.
    const now = new Date();
    const secondsToNextMinute = 60 - now.getSeconds();
    throw new RateLimitError(newCount, RATE_LIMIT_PER_MINUTE, secondsToNextMinute);
  }
}

/**
 * Verifica a quota mensal do household contra o plano actual.
 *
 * Lê `agent_quotas` (denormalizado com `plan`) e compara `prompts_used`
 * com o tier limit. Se atingiu/excedeu, lança `QuotaExceededError` ANTES
 * de invocar o pipeline (NFR20 hard-stop).
 *
 * NÃO incrementa — o incremento é feito pelo handler após sucesso da run
 * (`incrementQuota` em audit-log.ts).
 *
 * @throws {QuotaExceededError} se `prompts_used >= limit_for_plan`
 */
export async function checkQuota(householdId: string, db: Database): Promise<void> {
  const rows = await db.execute<{ plan: string; prompts_used: number }>(sql`
    select plan, prompts_used
    from agent_quotas
    where household_id = ${householdId}::uuid
    limit 1
  `);

  // Se não existe row (household novo), permitir — primeiro prompt cria a row
  // via `incrementQuota` no audit log. Defaults zero.
  if (rows.length === 0) {
    return;
  }

  const row = rows[0]!;
  const plan = row.plan;
  const used = Number(row.prompts_used ?? 0);
  const limit = QUOTA_BY_PLAN[plan] ?? QUOTA_BY_PLAN['free']!;

  if (used >= limit) {
    throw new QuotaExceededError(plan, used, limit);
  }
}
