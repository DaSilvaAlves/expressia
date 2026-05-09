/**
 * Audit log helpers — Story 2.6 AC10 + FR3.
 *
 * Persistência progressiva em `agent_runs`:
 *   - `insertAgentRun`        → INSERT inicial (status='classifying') no início do handler
 *   - `updateAfterClassifier` → intents_detected + confidence
 *   - `updateAfterPlanner`    → tool_calls + planner_model + tokens
 *   - `updateAfterExecutor`   → status terminal + completed_at + executor_model
 *   - `updatePreviewState`    → status='pending_preview' + confirm_expires_at
 *   - `incrementQuota`        → agent_quotas.prompts_used (NFR20)
 *
 * `getDb()` (role authenticated) para todos — mutação terminal é via trigger
 * imutabilidade da Story 2.1. Excepção: `markRunReverted` usa `getServiceDb()`
 * (justificada como NFR9 GDPR-purge-análoga em DN3 do handoff).
 *
 * Trace: Story 2.6 AC10 + FR3, NFR9, db-schema.md §4.4.
 */
import { sql } from 'drizzle-orm';

/**
 * Type alias minimal — qualquer cliente Drizzle aceitando `execute(sql\`...\`)`.
 * Evita import cross-package de `@meu-jarvis/db/client` que causa cascading
 * typecheck issues com `@/schema` interno do package db.
 */
type Database = {
  execute<T = unknown>(query: ReturnType<typeof sql>): Promise<T[]>;
};

/**
 * Input para INSERT inicial em `agent_runs` (status='classifying').
 *
 * `idempotency_key` é `null` se o header não foi fornecido. `prompt_text`
 * é guardado raw (purge mensal NFR12). `prompt_hash` permite correlação
 * sem PII.
 */
export interface InsertAgentRunInput {
  readonly householdId: string;
  readonly userId: string;
  readonly promptText: string;
  readonly promptHash: string;
  readonly traceId: string;
  readonly idempotencyKey: string | null;
}

/**
 * INSERT inicial em `agent_runs` — status='classifying'.
 *
 * Returns o `id` (UUID) gerado, usado como `runId` para todo o pipeline.
 * `intents_detected`/`tool_calls` ficam JSONB vazios — preenchidos depois.
 *
 * `confidence` arranca em `0` (NOT NULL no schema; CHECK >= 0 AND <= 1
 * permite zero como sentinel de "ainda não classificado").
 */
export async function insertAgentRun(
  input: InsertAgentRunInput,
  db: Database,
): Promise<{ runId: string; createdAt: Date }> {
  const rows = await db.execute<{ id: string; created_at: string }>(sql`
    insert into agent_runs (
      household_id, user_id, prompt_text, prompt_hash, language,
      intents_detected, confidence, status, trace_id, idempotency_key
    )
    values (
      ${input.householdId}::uuid, ${input.userId}::uuid,
      ${input.promptText}, ${input.promptHash}, 'pt-PT',
      '[]'::jsonb, 0, 'classifying',
      ${input.traceId}, ${input.idempotencyKey}
    )
    returning id, created_at
  `);

  const row = rows[0];
  if (!row) {
    throw new Error('insertAgentRun: INSERT returning vazio (DB inesperado)');
  }
  return { runId: row.id, createdAt: new Date(row.created_at) };
}

/**
 * UPDATE após Classifier — intents_detected + confidence agregada +
 * classifier_model.
 */
export async function updateAfterClassifier(
  runId: string,
  data: {
    readonly intentsDetected: unknown;
    readonly confidence: number;
    readonly classifierModel: string;
  },
  db: Database,
): Promise<void> {
  await db.execute(sql`
    update agent_runs
    set intents_detected = ${JSON.stringify(data.intentsDetected)}::jsonb,
        confidence = ${data.confidence},
        classifier_model = ${data.classifierModel}::llm_model
    where id = ${runId}::uuid
  `);
}

/**
 * UPDATE após Planner — tool_calls + executor_model + tokens.
 */
export async function updateAfterPlanner(
  runId: string,
  data: {
    readonly toolCalls: unknown;
    readonly executorModel: string;
    readonly tokensInput: number;
    readonly tokensOutput: number;
    readonly costEur: number;
  },
  db: Database,
): Promise<void> {
  await db.execute(sql`
    update agent_runs
    set tool_calls = ${JSON.stringify(data.toolCalls)}::jsonb,
        executor_model = ${data.executorModel}::llm_model,
        tokens_input = ${data.tokensInput},
        tokens_output = ${data.tokensOutput},
        cost_eur = ${data.costEur},
        status = 'executing'
    where id = ${runId}::uuid
  `);
}

/**
 * UPDATE terminal após Executor — status='success'|'failed' + completed_at +
 * latency_ms + response_summary + error_code/message.
 *
 * Trigger `trg_agent_runs_immutability` (Story 2.1) bloqueia mutação após
 * este UPDATE para roles `authenticated`/`anon` — service_role pode mutar
 * (purge job + revert).
 */
export async function updateAfterExecutor(
  runId: string,
  data: {
    readonly status: 'success' | 'failed';
    readonly latencyMs: number;
    readonly responseSummary: string | null;
    readonly errorCode: string | null;
    readonly errorMessage: string | null;
  },
  db: Database,
): Promise<void> {
  await db.execute(sql`
    update agent_runs
    set status = ${data.status},
        latency_ms = ${data.latencyMs},
        response_summary = ${data.responseSummary},
        error_code = ${data.errorCode},
        error_message = ${data.errorMessage},
        completed_at = now()
    where id = ${runId}::uuid
  `);
}

/**
 * UPDATE para preview mode (FR4 confidence < 0.70):
 *   status='classifying' → status='pending_preview' + confirm_expires_at.
 */
export async function updatePreviewState(
  runId: string,
  confirmExpiresAt: Date,
  db: Database,
): Promise<void> {
  await db.execute(sql`
    update agent_runs
    set status = 'pending_preview',
        confirm_expires_at = ${confirmExpiresAt.toISOString()}::timestamptz
    where id = ${runId}::uuid
  `);
}

/**
 * Incrementa `agent_quotas.prompts_used` após sucesso (NFR20).
 * UPSERT — cria row no primeiro prompt do mês.
 *
 * Não-fatal se falhar — logado mas não bloqueia o response (NFR20 hard-stop
 * é no `checkQuota` ANTES de executar).
 */
export async function incrementQuota(householdId: string, db: Database): Promise<void> {
  await db.execute(sql`
    insert into agent_quotas (
      household_id, plan, period_start, period_end, prompts_used
    )
    select h.id, h.plan,
           date_trunc('month', now()),
           date_trunc('month', now()) + interval '1 month',
           1
    from households h
    where h.id = ${householdId}::uuid
    on conflict (household_id) do update
      set prompts_used = agent_quotas.prompts_used + 1,
          updated_at = now()
  `);
}
