/**
 * Schema — Cérebro AI (agent_runs, intents, reverse ops, quotas).
 *
 * Trace: PRD FR1-FR6, NFR9 (audit), NFR20-21 (custo LLM),
 *        architecture §4 (pipeline) e §4.5 (undo).
 *
 * Notas críticas:
 *   - `agent_runs` é audit imutável (REVOKE UPDATE/DELETE em migration RLS).
 *   - `agent_reverse_ops.expires_at = now() + 30s` (FR6).
 *   - `prompt_text` é PII — REDACTED nos logs OTel; aqui é guardado mas com retenção
 *     limitada (purge job Inngest mensal).
 */
import { sql } from 'drizzle-orm';
import {
  pgEnum,
  pgTable,
  uuid,
  text,
  timestamp,
  integer,
  numeric,
  index,
  jsonb,
  boolean,
  unique,
  check,
} from 'drizzle-orm/pg-core';

import { authUsers } from './auth';
import { households, planTierEnum } from './tenancy';

// ─────────────────────────────────────────────────────────────────────────────
// Enums
// ─────────────────────────────────────────────────────────────────────────────

export const agentRunStatusEnum = pgEnum('agent_run_status', [
  'classifying',
  'pending_preview', // FR4 — confidence < 0.70
  'confirmed',
  'executing',
  'success',
  'failed',
  'reverted', // FR6 — utilizador fez undo
]);

export const agentIntentEnum = pgEnum('agent_intent', [
  'criar_tarefa',
  'criar_financa_variavel',
  'criar_financa_recorrente',
  'criar_cartao',
  'criar_parcelada',
  'consultar_dados',
  'cancelar_ultima',
  'unknown',
  // Story 3.8 — tools cérebro do domínio Tarefas (migration 0012).
  // `criar_tarefa` já existia desde 0000_initial_schema.sql:125 — os 3 abaixo
  // são genuinamente novos e correspondem a tools completar/listar/listar_atrasadas.
  'completar_tarefa',
  'listar_tarefas',
  'listar_atrasadas',
  // Story 2.14 — tools UPDATE/DELETE Tarefas e Finanças (migration 0026).
  'atualizar_tarefa',
  'eliminar_tarefa',
  'update_finance_variable',
  'delete_finance_variable',
  // Story J-5 — tools Calendar escrita (migration 0030). Sync com
  // `packages/classifier/src/schemas.ts` INTENT_VALUES (sanity-check Article IV).
  'criar_evento_calendario',
  'reagendar_evento_calendario',
  // Story J-6 — tool Gmail readonly. Sync com migration 0031.
  'consultar_emails',
  // Story J-7 — tool Gmail send (escrita externa irreversível). Sync com
  // migration 0032 + `packages/classifier/src/schemas.ts` INTENT_VALUES
  // (sanity-check Article IV).
  'enviar_email',
  // Story J-8 — tool Gmail reply (responder em thread, escrita externa
  // irreversível). Sync com migration 0033 + `packages/classifier/src/schemas.ts`
  // INTENT_VALUES (sanity-check Article IV).
  'responder_email',
  // Story M-1 — tool `memorizar` (captura de memória explícita, escrita INTERNA
  // reversível — mesmo perfil de `criar_tarefa`). Sync com migration 0034 +
  // `packages/classifier/src/schemas.ts` INTENT_VALUES (sanity-check Article IV).
  // NÃO adicionar a READ_ONLY_INTENTS — é escrita, não leitura.
  'memorizar',
  // Story M-4 — tool `esquecer` (apagar uma memória guardada, escrita INTERNA
  // destrutiva mas reversível — DELETE + reinsert_row para undo real). Sync com
  // migration 0035 + `packages/classifier/src/schemas.ts` INTENT_VALUES
  // (sanity-check Article IV). NÃO adicionar a READ_ONLY_INTENTS — é escrita
  // destrutiva, não leitura. FORÇA needs_confirmation (preview mostra o conteúdo
  // exacto da memória antes de apagar).
  'esquecer',
  // Story M-5 — tool sugerir_memoria (captura INFERIDA de memória com
  // confirmação SEMPRE obrigatória — o motor nota de passagem um facto/preferência
  // e PROPÕE guardar, nunca em silêncio). Escrita INTERNA reversível (INSERT em
  // jarvis_memories com source=inferred + delete_row para undo real, mesmo
  // perfil de memorizar). Sync com migration 0036 +
  // packages/classifier/src/schemas.ts INTENT_VALUES (sanity-check Article IV).
  // NÃO adicionar a READ_ONLY_INTENTS — é escrita, não leitura. FORÇA
  // needs_confirmation SEMPRE (R5 do brief — nunca captura sem consentimento).
  'sugerir_memoria',
]);

export const llmModelEnum = pgEnum('llm_model', [
  'gpt-4o-mini', // classifier
  'claude-sonnet-4-5', // executor (futuras versões adicionar aqui)
  'claude-opus-4-7',
  'claude-haiku-4-5', // executor default desde Story 2.12 (migration 0017)
]);

// ─────────────────────────────────────────────────────────────────────────────
// agent_runs — audit log imutável (NFR9)
// ─────────────────────────────────────────────────────────────────────────────

export const agentRuns = pgTable(
  'agent_runs',
  {
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    householdId: uuid('household_id')
      .notNull()
      .references(() => households.id, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => authUsers.id, { onDelete: 'restrict' }),
    /** Texto do prompt original (PII — purge mensal). */
    promptText: text('prompt_text').notNull(),
    /** SHA-256 do prompt+salt para correlation sem PII (NFR12). */
    promptHash: text('prompt_hash').notNull(),
    /** Idioma detectado — sempre 'pt-PT' no MVP (CON3). */
    language: text('language').notNull().default('pt-PT'),
    /** Resultado do classifier — array de {intent, confidence, raw_span}. */
    intentsDetected: jsonb('intents_detected').notNull(),
    /** Confidence agregada (mínimo das intents detectadas). */
    confidence: numeric('confidence', { precision: 4, scale: 3 }).notNull(),
    status: agentRunStatusEnum('status').notNull().default('classifying'),
    /** Resumo human-friendly do que foi feito ("Criada 1 tarefa, 1 transacção €78,70"). */
    responseSummary: text('response_summary'),
    /** Stream de tool calls executados (lista de {tool, input, output}). */
    toolCalls: jsonb('tool_calls'),
    latencyMs: integer('latency_ms'),
    classifierModel: llmModelEnum('classifier_model'),
    executorModel: llmModelEnum('executor_model'),
    tokensInput: integer('tokens_input').default(0),
    tokensOutput: integer('tokens_output').default(0),
    /** Custo total em EUR com 5 casas decimais (€0,00006 é típico). */
    costEur: numeric('cost_eur', { precision: 10, scale: 5 }).default('0'),
    /** Trace ID OTel para deep-link Grafana. */
    traceId: text('trace_id'),
    /** Erro estruturado quando status='failed'. */
    errorCode: text('error_code'),
    errorMessage: text('error_message'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    completedAt: timestamp('completed_at', { withTimezone: true }),
    revertedAt: timestamp('reverted_at', { withTimezone: true }),
    /**
     * Idempotency-Key header opcional (Story 2.6 D19) — janela 24h replay
     * determinístico de runs terminais. NULL = sem idempotency. Migration 0006.
     */
    idempotencyKey: text('idempotency_key'),
    /**
     * TTL da janela de confirmação preview-then-confirm (Story 2.6 D20 — 5min).
     * Apenas populado quando status='pending_preview' (FR4). Migration 0006.
     */
    confirmExpiresAt: timestamp('confirm_expires_at', { withTimezone: true }),
  },
  (t) => ({
    householdIdx: index('agent_runs_household_idx').on(t.householdId),
    userIdx: index('agent_runs_user_idx').on(t.userId),
    statusIdx: index('agent_runs_status_idx').on(t.status),
    createdAtIdx: index('agent_runs_created_at_idx').on(t.createdAt.desc()),
    /** Índice composto para query "próximo undo disponível para este user". */
    undoIdx: index('agent_runs_undo_idx').on(t.userId, t.createdAt.desc(), t.status),
    confidenceCheck: check(
      'agent_runs_confidence_range',
      sql`${t.confidence} >= 0 AND ${t.confidence} <= 1`,
    ),
    languageCheck: check('agent_runs_language_pt', sql`${t.language} = 'pt-PT'`),
  }),
);

export type AgentRun = typeof agentRuns.$inferSelect;
export type NewAgentRun = typeof agentRuns.$inferInsert;

// ─────────────────────────────────────────────────────────────────────────────
// intent_classifications — uma linha por intent detectada por agent_run
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Detalhe granular de cada intent (1 agent_run pode ter N intents — FR2 multi-intent).
 *
 * `target_entity_table` + `target_entity_id` permitem rastrear "esta intent criou
 * a transaction X". Útil para undo e para benchmarks.
 */
export const intentClassifications = pgTable(
  'intent_classifications',
  {
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    agentRunId: uuid('agent_run_id')
      .notNull()
      .references(() => agentRuns.id, { onDelete: 'cascade' }),
    householdId: uuid('household_id')
      .notNull()
      .references(() => households.id, { onDelete: 'cascade' }),
    intent: agentIntentEnum('intent').notNull(),
    confidence: numeric('confidence', { precision: 4, scale: 3 }).notNull(),
    /** Sub-string do prompt que originou esta intent. */
    rawSpan: text('raw_span'),
    /** Parâmetros extraídos pelo planner (input do tool call). */
    params: jsonb('params').notNull(),
    executed: boolean('executed').notNull().default(false),
    /** Tabela onde a entidade foi criada (ex: 'tasks', 'transactions'). */
    targetEntityTable: text('target_entity_table'),
    targetEntityId: uuid('target_entity_id'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    runIdx: index('intent_classifications_run_idx').on(t.agentRunId),
    householdIdx: index('intent_classifications_household_idx').on(t.householdId),
    intentIdx: index('intent_classifications_intent_idx').on(t.intent),
    confidenceCheck: check(
      'intent_classifications_confidence_range',
      sql`${t.confidence} >= 0 AND ${t.confidence} <= 1`,
    ),
  }),
);

export type IntentClassification = typeof intentClassifications.$inferSelect;
export type NewIntentClassification = typeof intentClassifications.$inferInsert;

// ─────────────────────────────────────────────────────────────────────────────
// agent_reverse_ops — undo declarativo 30s (FR6)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Cada tool execute() produz um reverse_op declarativo persistido aqui.
 *
 * Tipos JSONB:
 *   - { kind: 'delete_row', table, id }                       (insert reverte com delete)
 *   - { kind: 'restore_row', table, id, snapshot: {...} }     (update reverte com snapshot)
 *   - { kind: 'composite', ops: [...] }                       (lista de ops)
 *
 * Ver `types.ts` → `ReverseOpKind`.
 *
 * Job Inngest diário limpa registos com `expires_at < now() - interval '1 hour'`.
 */
export const agentReverseOps = pgTable(
  'agent_reverse_ops',
  {
    id: uuid('id').primaryKey().default(sql`gen_random_uuid()`),
    agentRunId: uuid('agent_run_id')
      .notNull()
      .references(() => agentRuns.id, { onDelete: 'cascade' }),
    householdId: uuid('household_id')
      .notNull()
      .references(() => households.id, { onDelete: 'cascade' }),
    /** Operação reversível em formato JSONB tipado (ver `ReverseOpKind`). */
    reverseOp: jsonb('reverse_op').notNull(),
    /** Janela de undo — sempre `now() + interval '30 seconds'` na criação. */
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    executedAt: timestamp('executed_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    runIdx: index('agent_reverse_ops_run_idx').on(t.agentRunId),
    householdIdx: index('agent_reverse_ops_household_idx').on(t.householdId),
    /** Query principal: "operações reverte-able do user X agora". */
    undoQueryIdx: index('agent_reverse_ops_undo_query_idx').on(
      t.householdId,
      t.expiresAt,
      t.executedAt,
    ),
  }),
);

export type AgentReverseOp = typeof agentReverseOps.$inferSelect;
export type NewAgentReverseOp = typeof agentReverseOps.$inferInsert;

// ─────────────────────────────────────────────────────────────────────────────
// agent_quotas — quotas mensais por household (NFR20)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Contadores rolling do mês corrente. Reset alinhado com `subscriptions.current_period_start`.
 *
 * Job Inngest diário verifica se mudou o período e zera contadores.
 * Hard-stop a 110% da quota — endpoint devolve 429 PT-PT.
 */
export const agentQuotas = pgTable(
  'agent_quotas',
  {
    householdId: uuid('household_id')
      .primaryKey()
      .references(() => households.id, { onDelete: 'cascade' }),
    /** Plano observado (denormalizado para evitar JOIN em hot path). */
    plan: planTierEnum('plan').notNull(),
    periodStart: timestamp('period_start', { withTimezone: true }).notNull(),
    periodEnd: timestamp('period_end', { withTimezone: true }).notNull(),
    promptsUsed: integer('prompts_used').notNull().default(0),
    tokensInputUsed: integer('tokens_input_used').notNull().default(0),
    tokensOutputUsed: integer('tokens_output_used').notNull().default(0),
    /** Custo acumulado € no período (rolling). */
    costEurAccumulated: numeric('cost_eur_accumulated', { precision: 10, scale: 5 })
      .notNull()
      .default('0'),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    periodIdx: index('agent_quotas_period_idx').on(t.periodStart, t.periodEnd),
  }),
);

export type AgentQuota = typeof agentQuotas.$inferSelect;
export type NewAgentQuota = typeof agentQuotas.$inferInsert;

// ─────────────────────────────────────────────────────────────────────────────
// agent_rate_limit_counters — rate limit MVP Postgres (Story 2.6 D18)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Rate limit counter MVP per household — janela de 1 minuto.
 *
 * - Architecture §7.2 documenta literal "10 req/min burst" para `/api/agent/prompt`.
 * - PK composta `(household_id, window_start)` permite múltiplas janelas
 *   históricas (cleanup por job futuro Inngest — fora do scope MVP).
 * - Migração para Upstash Redis EU em Story 2.9 (EB3 desbloqueado).
 *
 * Migration 0006. RLS activa com 4 policies (NFR5).
 */
export const agentRateLimitCounters = pgTable(
  'agent_rate_limit_counters',
  {
    householdId: uuid('household_id')
      .notNull()
      .references(() => households.id, { onDelete: 'cascade' }),
    /** Início da janela de 1 minuto — truncado a `date_trunc('minute', now())`. */
    windowStart: timestamp('window_start', { withTimezone: true }).notNull(),
    count: integer('count').notNull().default(0),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    pk: unique('agent_rate_limit_counters_pkey').on(t.householdId, t.windowStart),
    windowIdx: index('agent_rate_limit_counters_window_idx').on(t.windowStart.desc()),
  }),
);

export type AgentRateLimitCounter = typeof agentRateLimitCounters.$inferSelect;
export type NewAgentRateLimitCounter = typeof agentRateLimitCounters.$inferInsert;
