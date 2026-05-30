/**
 * Schemas Zod do package `@meu-jarvis/planner-executor`.
 *
 * Trace: Story 2.5 AC2 + Architecture §4.3 (`tool_calls[]` array do Sonnet) +
 *        Story 2.4 AC3 D8 (`max(5)` intents — fonte real do cap) + FR2
 *        (atomicidade multi-intent) + FR4 (preview hooks) + Architecture §4.5
 *        (reverse_op delegado a `executeAtomic` da 2.3).
 *
 * Fronteira do package:
 *   - Recebe `ClassificationResult` da Story 2.4 (`@meu-jarvis/classifier`)
 *     como input do Planner.
 *   - Produz `PlanResult` que o Executor consome (delegando atomicidade a
 *     `executeAtomic` da Story 2.3 `@meu-jarvis/tools`).
 *   - `runId` é o UUID de `agent_runs.id` populado pelo endpoint (Story 2.6).
 *
 * Article IV (No Invention):
 *   - `ClassificationSchema` é importado literal de `@meu-jarvis/classifier`.
 *   - `IntentSchema` (8 intents canónicas alinhadas com `agent_intent` enum
 *     Postgres) idem.
 *   - `TOOL_TO_INTENT_MAP` (D6) é um mapping declarativo estático para
 *     enriquecer `PlanToolCall.intent` durante mapping pós-LLM. Cobre as 8
 *     intents do `IntentSchema` — qualquer divergência partida pelo test
 *     `contract.test.ts`.
 */
import { z } from 'zod';

import { ClassificationSchema, IntentSchema, type Intent } from '@meu-jarvis/classifier';

// ─────────────────────────────────────────────────────────────────────────────
// PlanToolCall — uma tool call individual produzida pelo Sonnet
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Tool call individual dentro de um `PlanResult`.
 *
 * `intent` é enriquecida pelo Planner via `TOOL_TO_INTENT_MAP` após receber
 * o output do Sonnet — facilita debug/telemetria sem custo LLM extra (D6).
 *
 * `rawCallId` é o `tool_use_id` devolvido pelo Anthropic SDK (preservado
 * para correlação em audit log da Story 2.6).
 */
export const PlanToolCallSchema = z.object({
  toolName: z.string().min(1),
  input: z.record(z.string(), z.unknown()),
  intent: IntentSchema,
  rawCallId: z.string().optional(),
});

export type PlanToolCall = z.infer<typeof PlanToolCallSchema>;

// ─────────────────────────────────────────────────────────────────────────────
// PlanResult — output completo do Planner
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Resultado de uma chamada `Planner.plan(input)`.
 *
 * - `toolCalls.min(0)`: o LLM pode legitimamente devolver array vazio se
 *   `classification.intents` for `[{intent: 'unknown'}]` (degradação graceful
 *   sem tools = nada a executar). Caso permitido — não é erro.
 * - `toolCalls.max(10)` é guardrail anti-hallucination [AUTO-DECISION D5]
 *   análogo a Story 2.4 AC3 D8 (`max(5)` intents). Ver razão em story.
 * - `planReasoning` é texto livre que o Sonnet eventualmente produz entre
 *   `tool_use` blocks (preservado para debug/audit; não exibido ao utilizador).
 * - `cacheHit` propagado de `ProviderCompleteOutput.cacheHit` da 2.2.
 * - `costEur` propagado (em produção depende de `AGENT_USD_TO_EUR_RATE`).
 */
export const PlanResultSchema = z.object({
  toolCalls: z.array(PlanToolCallSchema).min(0).max(10),
  planReasoning: z.string().nullable(),
  latencyMs: z.number().int().nonnegative(),
  tokensInput: z.number().int().nonnegative(),
  tokensOutput: z.number().int().nonnegative(),
  costEur: z.number().nonnegative(),
  cacheHit: z.boolean(),
});

export type PlanResult = z.infer<typeof PlanResultSchema>;

// ─────────────────────────────────────────────────────────────────────────────
// PlannerInput — entrada de Planner.plan()
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Input do Planner — vindo do orquestrador (endpoint Story 2.6 ou benchmark
 * Story 2.10).
 *
 * `runId` é o UUID de `agent_runs.id` — o endpoint faz INSERT inicial (status
 * `classifying`) e UPDATE final (status `success/failed`). Esta story NÃO
 * persiste `agent_runs` directamente (delegado a Story 2.6).
 *
 * `traceId` propaga para deep-link Grafana. `householdId` e `userId` NUNCA
 * aparecem em logs raw — `hashForCorrelation` aplica-se em span attributes.
 *
 * `accountContext` (Story 2.13 AC6 — ponte Finanças ↔ Cérebro, ADR-002 §9.4):
 * contexto opcional de contas/cartões do household que o endpoint (`apps/web`)
 * monta via SELECT RLS-scoped e o Planner injecta como **prefixo da user
 * message** (NUNCA no `system`/`tools` — preserva o cache Anthropic). São DUAS
 * listas distintas porque cartões NÃO têm `account_type`. `type` é `z.string()`
 * (NÃO importa `accountTypeEnum` de `@meu-jarvis/db` — mantém o package
 * agnóstico de DDL; o endpoint faz o mapeamento da row para a string).
 */
export const AccountContextSchema = z.object({
  accounts: z.array(
    z.object({
      id: z.string().uuid(),
      name: z.string(),
      type: z.string(),
    }),
  ),
  cards: z.array(
    z.object({
      id: z.string().uuid(),
      name: z.string(),
    }),
  ),
});

export type AccountContext = z.infer<typeof AccountContextSchema>;

export const PlannerInputSchema = z.object({
  classification: ClassificationSchema,
  householdId: z.string().uuid(),
  userId: z.string().uuid(),
  traceId: z.string().min(1),
  runId: z.string().uuid(),
  accountContext: AccountContextSchema.optional(),
});

export type PlannerInput = z.infer<typeof PlannerInputSchema>;

// ─────────────────────────────────────────────────────────────────────────────
// ExecutorInput — entrada de Executor.execute()
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Input do Executor — composto pelo `PlanResult` do Planner mais o contexto
 * de execução (mesma estrutura que `PlannerInput` excepto `classification`).
 *
 * O Executor delega `executeAtomic` da Story 2.3 — `runId` é propagado para
 * `agent_reverse_ops.agent_run_id` (FK).
 */
export const ExecutorInputSchema = z.object({
  plan: PlanResultSchema,
  householdId: z.string().uuid(),
  userId: z.string().uuid(),
  traceId: z.string().min(1),
  runId: z.string().uuid(),
});

export type ExecutorInput = z.infer<typeof ExecutorInputSchema>;

// ─────────────────────────────────────────────────────────────────────────────
// TOOL_TO_INTENT_MAP — mapping declarativo (D6)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Mapping estático tool name → intent originária.
 *
 * [AUTO-DECISION D6] Razão: (1) determinístico e testável; (2) evita custo
 * LLM extra (alternativa: pedir ao LLM para anotar intent no input da tool);
 * (3) tools são single source of truth da Story 2.3 e não mudam entre runs;
 * (4) tool name fora do MAP → fallback `'unknown'` (graceful degradation).
 *
 * **Cobertura obrigatória:** as 11 intents do `IntentSchema` (Story 2.4 AC2
 * baseline 8 + Story 3.8 tools cérebro Tarefas +3) têm pelo menos 1 tool name
 * mapeado. Validável em `__tests__/contract.test.ts`.
 *
 * Nomenclatura tools snake_case lowercase (alinhada com Architecture §4.3
 * `create_task`, `query_finance_summary`, etc.).
 *
 * Tools concretas serão implementadas nas Stories 2.6 (Tarefas), 2.7 (Finanças),
 * 2.8 (Consultas/Sistema). Esta story usa apenas mocks em testes.
 *
 * Story 3.8 introduziu tools `criar_tarefa`/`completar_tarefa`/`listar_tarefas`/
 * `listar_atrasadas` em `@meu-jarvis/tools/tasks/` — o tool name JÁ coincide
 * com o intent name PT-PT (pattern intencional para LLM ergonomics PT-PT).
 */
export const TOOL_TO_INTENT_MAP: Record<string, Intent> = {
  // criar_tarefa — Story 3.8 tool name PT-PT
  create_task: 'criar_tarefa',
  criar_tarefa: 'criar_tarefa',
  // criar_financa_variavel
  create_finance_variable: 'criar_financa_variavel',
  // criar_financa_recorrente
  create_finance_recurrence: 'criar_financa_recorrente',
  // criar_cartao
  create_card: 'criar_cartao',
  // criar_parcelada — pode expandir-se em múltiplas tool calls
  create_installment: 'criar_parcelada',
  create_card_transaction: 'criar_parcelada',
  create_installment_plan: 'criar_parcelada',
  // consultar_dados
  query_finance_summary: 'consultar_dados',
  query_tasks: 'consultar_dados',
  query_overdue: 'consultar_dados',
  // cancelar_ultima
  cancel_last_run: 'cancelar_ultima',
  // unknown — fallback intencional
  noop: 'unknown',
  // Story 3.8 — tools cérebro do domínio Tarefas (tool name === intent name PT-PT)
  completar_tarefa: 'completar_tarefa',
  listar_tarefas: 'listar_tarefas',
  listar_atrasadas: 'listar_atrasadas',
};

/**
 * Resolve a intent associada a um tool name. Fallback `'unknown'` se ausente.
 *
 * @param toolName - Nome da tool (ex: 'create_task').
 * @returns Intent associada (ou 'unknown' se tool name fora do MAP).
 */
export function resolveIntentFromToolName(toolName: string): Intent {
  return TOOL_TO_INTENT_MAP[toolName] ?? 'unknown';
}
