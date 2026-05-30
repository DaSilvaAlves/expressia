/**
 * Contratos públicos do package `@meu-jarvis/agent`.
 *
 * Trace: Story 2.2 AC2 + Architecture §4.2 + §4.3.
 *
 * Princípio Article IV (No Invention): os valores de `LLM_MODEL_VALUES` SÃO
 * os mesmos do enum `llm_model` exportado de `@meu-jarvis/db/schema/agent`
 * (linha 57-61). A duplicação aqui é deliberada — TypeScript não consegue
 * resolver os `paths` aliases internos do `@meu-jarvis/db` quando o agent
 * package faz typecheck cross-package. O test `contracts.test.ts` com
 * `LLM_MODEL_VALUES_SANITY_CHECK` valida em runtime que os arrays batem
 * exactamente — qualquer divergência parte o build (Article IV preservado
 * por test em vez de import directo).
 */
import { z } from 'zod';

// ─────────────────────────────────────────────────────────────────────────────
// LlmModel — alinhado com enum Postgres real
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Tuple readonly dos valores do enum `llm_model` em
 * `packages/db/src/schema/agent.ts:57-61`.
 *
 * Sanity-checked em runtime via test contra o enum real.
 */
export const LLM_MODEL_VALUES = [
  'gpt-4o-mini',
  'claude-sonnet-4-5',
  'claude-opus-4-7',
  'claude-haiku-4-5',
] as const;

/**
 * Schema Zod aceitando qualquer dos modelos LLM suportados pelo schema agent.
 */
export const LlmModelSchema = z.enum(LLM_MODEL_VALUES);

/**
 * Tipo TS derivado.
 */
export type LlmModel = z.infer<typeof LlmModelSchema>;

/**
 * Default Anthropic Sonnet — usado por `AnthropicProvider` quando explicitamente
 * pedido via `opts.model`. Já NÃO é o default global do Executor (ver
 * `CLAUDE_HAIKU_DEFAULT`); permanece válido como override.
 */
export const CLAUDE_SONNET_DEFAULT: LlmModel = 'claude-sonnet-4-5';

/**
 * Default Anthropic Haiku 4.5 — identificador completo da API Anthropic,
 * passado ao SDK na chamada `messages.create`.
 *
 * Story 2.12: é o NOVO default do Executor.
 *
 * NOTA (Article IV / coerência enum): este valor é o API ID full-form
 * (`-20251001`) e por isso NÃO é membro de `LlmModel` (o enum Postgres guarda
 * o short-form `'claude-haiku-4-5'`). O short-form correspondente para a coluna
 * DB `agent_runs.executor_model` e para `ProviderCompleteOutput.model` é
 * `CLAUDE_HAIKU_MODEL_ENUM`. A separação é deliberada — ver Dev Notes Story 2.12
 * AUTO-DECISION enum curto vs. API ID.
 */
export const CLAUDE_HAIKU_DEFAULT = 'claude-haiku-4-5-20251001' as const;

/**
 * Short-form do Haiku 4.5 — valor canónico do enum Postgres `llm_model`.
 * É o que se escreve na coluna `agent_runs.executor_model` e o que aparece em
 * `ProviderCompleteOutput.model`. O API ID full-form vive em `CLAUDE_HAIKU_DEFAULT`.
 */
export const CLAUDE_HAIKU_MODEL_ENUM = 'claude-haiku-4-5' as const;

/**
 * Default OpenAI GPT-4o-mini — usado por `OpenAIProvider`.
 */
export const OPENAI_GPT4O_MINI_DEFAULT: LlmModel = 'gpt-4o-mini';

// ─────────────────────────────────────────────────────────────────────────────
// ProviderCompleteInput — entrada padronizada de uma chamada LLM
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Subset mínimo de uma tool definition compatível com Anthropic + OpenAI.
 * Story 2.3 (Tool Registry) entregará a forma definitiva — esta é a forma
 * mínima viável para Story 2.2.
 */
export const MinimalToolDefinitionSchema = z.object({
  name: z.string().min(1),
  description: z.string().min(1),
  input_schema: z.record(z.unknown()),
});

export type MinimalToolDefinition = z.infer<typeof MinimalToolDefinitionSchema>;

/**
 * Mensagem da conversa — formato comum aos dois providers.
 */
export const ProviderMessageSchema = z.object({
  role: z.enum(['user', 'assistant', 'system']),
  content: z.string(),
});

export type ProviderMessage = z.infer<typeof ProviderMessageSchema>;

/**
 * Entrada de uma chamada `complete` ao provider.
 *
 * `cacheControl: 'ephemeral'` activa Anthropic prompt caching no system
 * prompt + tool definitions. OpenAI ignora silenciosamente este campo
 * (sem equivalente directo no MVP).
 *
 * `traceId` é o request id propagado para deep-link Grafana (Architecture §9.3).
 * `householdId` NUNCA é logado raw — passa por `hashForCorrelation` antes.
 */
export const ProviderCompleteInputSchema = z.object({
  system: z.string().min(1).describe('System prompt PT-PT'),
  messages: z.array(ProviderMessageSchema).min(1).describe('Histórico de mensagens'),
  tools: z.array(MinimalToolDefinitionSchema).optional().describe('Tools disponíveis (Story 2.3)'),
  cacheControl: z.enum(['ephemeral']).nullable().optional().describe('Anthropic prompt cache toggle'),
  temperature: z.number().min(0).max(2).optional().describe('Default 0 (determinismo)'),
  maxTokens: z.number().int().positive().optional().describe('Default 4096'),
  traceId: z.string().min(1).describe('Trace ID OTel para correlação Grafana'),
  householdId: z.string().uuid().describe('Household tenant id — usado apenas para hash log'),
});

export type ProviderCompleteInput = z.infer<typeof ProviderCompleteInputSchema>;

// ─────────────────────────────────────────────────────────────────────────────
// ProviderCompleteOutput — resposta padronizada
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Tool call gerada pelo modelo — formato unificado entre providers.
 */
export const ProviderToolCallSchema = z.object({
  name: z.string(),
  input: z.record(z.unknown()),
});

export type ProviderToolCall = z.infer<typeof ProviderToolCallSchema>;

/**
 * Razão pela qual o provider terminou a geração.
 */
export const FinishReasonSchema = z.enum(['stop', 'tool_use', 'length', 'error']);
export type FinishReason = z.infer<typeof FinishReasonSchema>;

/**
 * Output de uma chamada `complete`.
 *
 * Refinements:
 *   - tokens não-negativos
 *   - costEur não-negativo
 *   - latencyMs não-negativo
 */
export const ProviderCompleteOutputSchema = z.object({
  provider: z.enum(['anthropic', 'openai']),
  model: LlmModelSchema,
  content: z.string().nullable().describe('Texto da resposta, null se só houver tool_calls'),
  toolCalls: z.array(ProviderToolCallSchema),
  finishReason: FinishReasonSchema,
  tokensInput: z.number().int().nonnegative(),
  tokensOutput: z.number().int().nonnegative(),
  costEur: z.number().nonnegative(),
  latencyMs: z.number().nonnegative(),
  cacheHit: z.boolean(),
});

export type ProviderCompleteOutput = z.infer<typeof ProviderCompleteOutputSchema>;
