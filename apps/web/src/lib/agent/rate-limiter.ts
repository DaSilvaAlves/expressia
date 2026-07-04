/**
 * Rate limiting + quota helper — Story 2.6 AC9 + D17 + D18, Story 2.9 D48+D49.
 *
 * MVP Postgres counter (D18) — 10 req/min burst per household
 * (Architecture §7.2 literal). Migração para Upstash Redis EU em Story 2.9
 * (EB3 desbloqueado — runbook docs/runbooks/upstash-setup.md).
 *
 * Quota mensal: derivada de `households.plan` + tier config (D18 PO_FIX) —
 * `agent_quotas.prompts_used` é o contador, hard-stop a 110% quando atinge
 * `Math.floor(limit * 1.1)` por plano (NFR20 + Architecture §4.6).
 *
 * Story 2.9 fixes:
 *   - D48 — QUOTA_BY_PLAN alinhado com Architecture §4.6 (free:50, pessoal:1500,
 *           familia:3000, pro:10000) — valores anteriores divergiam.
 *   - D49 — Hard-stop a 110% (`Math.floor(limit * 1.1)`) — anteriormente bloqueava a 100%.
 *   - DN12 — `checkQuota` agora lê também `period_end` para mensagem
 *            "Próxima janela em N min." (PT-PT estrito).
 *   - C2 — Trial=Família documentação inline (`'trialing'` está em
 *          `subscriptions.status`, NÃO em `plan_tier`; households em trial têm
 *          `agent_quotas.plan = 'familia'` per DP7 Architecture §6.4).
 *
 * Trace: Story 2.6 AC9 + D17 + D18, Story 2.9 AC7+AC8+AC10+AC12 + D48+D49,
 *        Architecture §4.6 + §6.4 DP7 + §7.2, NFR13 + NFR20.
 */
import { sql } from 'drizzle-orm';

import type { DbExecutor } from '@/lib/agent/db-shim';

/** @see DbExecutor em db-shim.ts — tipo canónico para esta assinatura minimal. */
type Database = DbExecutor;

/**
 * Limite hard-coded para MVP — Architecture §7.2 literal "10 req/min burst".
 * Ajustável em produção via env `AGENT_RATE_LIMIT_PER_MINUTE` (override).
 */
export const RATE_LIMIT_PER_MINUTE = (() => {
  const fromEnv = Number(process.env.AGENT_RATE_LIMIT_PER_MINUTE);
  return Number.isFinite(fromEnv) && fromEnv > 0 ? fromEnv : 10;
})();

/**
 * Quota mensal por plano (NFR20 + Architecture §4.6 tabela "Quotas por plano").
 *
 * **Trial=Família mapping (C2 + DP7 Architecture §6.4):**
 *   `agent_quotas.plan` é sempre um valor base do `plan_tier` enum
 *   (`'free'`/`'pessoal'`/`'familia'`/`'pro'`). O estado `'trialing'` vive em
 *   `subscriptions.status` (NÃO em `plan_tier`). Households em trial têm
 *   `households.plan = 'familia'` desde o primeiro dia (DP7) — recebem a
 *   quota de Família durante o trial. Zero código adicional necessário.
 *
 * Story 2.9 D48 — valores corrigidos vs Architecture §4.6.
 */
export const QUOTA_BY_PLAN: Record<string, number> = {
  free: 50,
  pessoal: 1500,
  familia: 3000,
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
 * Erro lançado quando a quota mensal é excedida (hard-stop 110%).
 * Mapeado para HTTP 429 + `QUOTA_EXCEEDED` no handler principal com headers
 * `X-Quota-Reset` (ISO-8601) + `Retry-After` (segundos).
 *
 * Story 2.9 — mensagem PT-PT estrita "Limite de prompts atingido. Próxima
 * janela em N min." + campo `periodEnd` para o handler computar headers.
 */
export class QuotaExceededError extends Error {
  readonly plan: string;
  readonly used: number;
  readonly limit: number;
  readonly periodEnd: Date;

  constructor(plan: string, used: number, limit: number, periodEnd: Date) {
    const minutesUntilReset = Math.max(
      1,
      Math.ceil((periodEnd.getTime() - Date.now()) / 60000),
    );
    super(
      `Limite de prompts atingido. Próxima janela em ${minutesUntilReset} min.`,
    );
    this.name = 'QuotaExceededError';
    this.plan = plan;
    this.used = used;
    this.limit = limit;
    this.periodEnd = periodEnd;
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
 * Lê `agent_quotas` (denormalizado com `plan` e `period_end`) e compara
 * `prompts_used` com `Math.floor(limit * 1.1)` (hard-stop 110% per Architecture
 * §4.6). Se atingiu/excedeu, lança `QuotaExceededError` ANTES de invocar o
 * pipeline (NFR20 hard-stop).
 *
 * NÃO incrementa — o incremento é feito pelo handler após sucesso da run
 * (`incrementQuota` em audit-log.ts, que usa `getServiceDb()` por causa de RLS).
 *
 * Story 2.9 DN7+DN12:
 *   - Hard-stop a 110% — `used >= Math.floor(limit * 1.1)` (D49)
 *   - Lê `period_end` para computar "Próxima janela em N min." (DN12)
 *
 * @throws {QuotaExceededError} se `prompts_used >= Math.floor(limit_for_plan * 1.1)`
 */
export async function checkQuota(householdId: string, db: Database): Promise<void> {
  const rows = await db.execute<{
    plan: string;
    prompts_used: number;
    period_end: string;
  }>(sql`
    select plan, prompts_used, period_end
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
  const hardStop = Math.floor(limit * 1.1);

  if (used >= hardStop) {
    // Fallback defensivo se `period_end` for null/inválido: fim do mês actual.
    let periodEnd: Date;
    try {
      periodEnd = new Date(row.period_end);
      if (isNaN(periodEnd.getTime())) throw new Error('invalid');
    } catch {
      const now = new Date();
      periodEnd = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));
    }
    throw new QuotaExceededError(plan, used, limit, periodEnd);
  }
}
