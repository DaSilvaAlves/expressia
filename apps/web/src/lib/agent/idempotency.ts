/**
 * Idempotency lookup + replay helper — Story 2.6 AC8 + D19.
 *
 * Suporta `Idempotency-Key` header (UUID string opcional) para replay
 * determinístico de pedidos duplicados:
 *   - Janela 24h (D19) — Stripe-style standard SaaS.
 *   - Lookup por `(idempotency_key, household_id)` — partial unique index
 *     `agent_runs_idempotency_household_uq` (migration 0006).
 *   - Run terminal (`success`/`failed`/`reverted`) → replay response.
 *   - Run não-terminal (`classifying`/`pending_preview`/`confirmed`/`executing`)
 *     → HTTP 409 `IDEMPOTENCY_IN_PROGRESS`.
 *
 * Trace: Story 2.6 AC8 + D19, NFR9, Architecture §6.3 (precedente Stripe pattern).
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
 * Janela em horas para replay determinístico (D19 — 24h Stripe-style).
 * Override possível via env `AGENT_IDEMPOTENCY_WINDOW_HOURS` (não documentado
 * publicamente — apenas para testes/operacional).
 */
export const IDEMPOTENCY_WINDOW_HOURS = (() => {
  const fromEnv = Number(process.env.AGENT_IDEMPOTENCY_WINDOW_HOURS);
  return Number.isFinite(fromEnv) && fromEnv > 0 ? fromEnv : 24;
})();

/**
 * Status terminais que permitem replay determinístico (NFR9).
 * Estados não-terminais retornam 409 IDEMPOTENCY_IN_PROGRESS.
 */
const TERMINAL_STATUSES = ['success', 'failed', 'reverted'] as const;

/**
 * Subset mínimo de `agent_runs` que precisamos para reconstruir a response
 * cached. Inclui o necessário para replays de `executed` e `preview` modes.
 */
export interface IdempotentRunSnapshot {
  readonly id: string;
  readonly status: string;
  readonly mode: 'preview' | 'executed' | null;
  readonly responseSummary: string | null;
  readonly toolCalls: unknown;
  readonly intentsDetected: unknown;
  readonly confidence: string | number;
  readonly confirmExpiresAt: Date | null;
  readonly createdAt: Date;
  readonly completedAt: Date | null;
  readonly errorCode: string | null;
  readonly errorMessage: string | null;
}

/**
 * Verdict do lookup idempotency:
 *   - 'replay'      : run terminal encontrado — caller deve serializar response cached.
 *   - 'in_progress' : run não-terminal encontrado — caller deve retornar 409.
 *   - 'new'         : nenhum run encontrado — caller prossegue com nova execução.
 */
export type IdempotencyVerdict =
  | { readonly kind: 'replay'; readonly run: IdempotentRunSnapshot }
  | { readonly kind: 'in_progress'; readonly run: IdempotentRunSnapshot }
  | { readonly kind: 'new' };

/**
 * Faz lookup de run idempotente (key + household + janela 24h).
 *
 * Retorna verdict para o caller decidir o flow:
 *   - `replay` → serializar e retornar response cached (HTTP 200 com `X-Idempotent-Replay: true`)
 *   - `in_progress` → retornar HTTP 409 IDEMPOTENCY_IN_PROGRESS
 *   - `new` → prosseguir normalmente, persistir `idempotency_key` em INSERT
 *
 * Se `key` for `undefined` (sem header), retorna sempre `new` sem query.
 */
export async function lookupIdempotentRun(
  key: string | undefined,
  householdId: string,
  db: Database,
): Promise<IdempotencyVerdict> {
  if (!key) {
    return { kind: 'new' };
  }

  const rows = await db.execute<{
    id: string;
    status: string;
    response_summary: string | null;
    tool_calls: unknown;
    intents_detected: unknown;
    confidence: string;
    confirm_expires_at: string | null;
    created_at: string;
    completed_at: string | null;
    error_code: string | null;
    error_message: string | null;
  }>(sql`
    select id, status, response_summary, tool_calls, intents_detected, confidence,
           confirm_expires_at, created_at, completed_at, error_code, error_message
    from agent_runs
    where idempotency_key = ${key}
      and household_id = ${householdId}::uuid
      and created_at > now() - (${IDEMPOTENCY_WINDOW_HOURS}::int || ' hours')::interval
    limit 1
  `);

  if (rows.length === 0) {
    return { kind: 'new' };
  }

  const row = rows[0]!;
  const snapshot: IdempotentRunSnapshot = {
    id: row.id,
    status: row.status,
    mode: row.status === 'pending_preview' ? 'preview' : row.status === 'success' ? 'executed' : null,
    responseSummary: row.response_summary,
    toolCalls: row.tool_calls,
    intentsDetected: row.intents_detected,
    confidence: row.confidence,
    confirmExpiresAt: row.confirm_expires_at ? new Date(row.confirm_expires_at) : null,
    createdAt: new Date(row.created_at),
    completedAt: row.completed_at ? new Date(row.completed_at) : null,
    errorCode: row.error_code,
    errorMessage: row.error_message,
  };

  const isTerminal = (TERMINAL_STATUSES as readonly string[]).includes(row.status);
  if (isTerminal) {
    return { kind: 'replay', run: snapshot };
  }
  return { kind: 'in_progress', run: snapshot };
}
