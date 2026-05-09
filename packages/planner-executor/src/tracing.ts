/**
 * OTel tracing helpers do package `@meu-jarvis/planner-executor`.
 *
 * Trace: Story 2.5 AC9 + Architecture §9.3 (whitelist attrs + zero PII) +
 *        NFR12 (PII redaction) + NFR13 (OTel obrigatório) + padrão Stories
 *        2.2 AC8, 2.3 AC9, 2.4 AC9.
 *
 * Spans:
 *   - `agent.planner.call` — wrap de `Planner.plan()`. 12 atributos whitelist.
 *   - `agent.executor.run` — wrap de `Executor.execute()`. 8 atributos
 *     whitelist. Parent de N spans `agent.tool.call` (criados internamente
 *     por `executeAtomic` da 2.3 via `withToolSpan`).
 *
 * Whitelist enforcement: callers usam apenas as keys das constantes
 * `PLANNER_SPAN_ATTRIBUTE_KEYS` e `EXECUTOR_SPAN_ATTRIBUTE_KEYS` —
 * verificável em `__tests__/tracing.test.ts`.
 *
 * Zero PII: `householdId` apenas via `hashForCorrelation` da observability;
 * tool inputs/outputs, planReasoning content, raw spans NUNCA aparecem.
 */
import type { Span } from '@opentelemetry/api';

import { hashForCorrelation, withSpan } from '@meu-jarvis/observability';

// ─────────────────────────────────────────────────────────────────────────────
// Whitelist de atributos do span do Planner (12 keys)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Keys permitidas em `agent.planner.call` span attributes.
 *
 * Imutável (`as const`) para garantir que callers usam apenas estes nomes.
 * O test `tracing.test.ts` verifica que nenhum span attribute escapa esta
 * whitelist.
 */
export const PLANNER_SPAN_ATTRIBUTE_KEYS = [
  'planner.model',
  'planner.intent_count',
  'planner.intent_unique_types',
  'planner.tool_call_count',
  'planner.cache_hit',
  'planner.duration_ms',
  'planner.tokens_input',
  'planner.tokens_output',
  'planner.cost_eur',
  'planner.success',
  'planner.error_class',
  'planner.household_hash',
] as const;

export type PlannerSpanAttributeKey = (typeof PLANNER_SPAN_ATTRIBUTE_KEYS)[number];

/**
 * Métricas anotadas no span do Planner pós-execução.
 *
 * `error` indica falha — `success` é derivado (`error === undefined`).
 */
export interface PlannerSpanMetrics {
  readonly model: string;
  readonly intentCount: number;
  readonly intentUniqueTypes: number;
  readonly toolCallCount: number;
  readonly cacheHit: boolean;
  readonly durationMs: number;
  readonly tokensInput: number;
  readonly tokensOutput: number;
  readonly costEur: number;
  readonly householdId: string;
  readonly errorClass?: string;
}

const PLANNER_SPAN_NAME = 'agent.planner.call';

/**
 * Wrap de uma chamada `Planner.plan()` com span OTel.
 *
 * @param fn - Callback que recebe o span activo.
 * @returns Resultado de `fn`.
 */
export async function withPlannerSpan<T>(fn: (span: Span) => Promise<T>): Promise<T> {
  return withSpan(PLANNER_SPAN_NAME, {}, fn);
}

/**
 * Anota métricas finais no span do Planner — chamado pelo Planner antes de
 * retornar.
 */
export function annotatePlannerMetrics(span: Span, metrics: PlannerSpanMetrics): void {
  span.setAttribute('planner.model', metrics.model);
  span.setAttribute('planner.intent_count', metrics.intentCount);
  span.setAttribute('planner.intent_unique_types', metrics.intentUniqueTypes);
  span.setAttribute('planner.tool_call_count', metrics.toolCallCount);
  span.setAttribute('planner.cache_hit', metrics.cacheHit);
  span.setAttribute('planner.duration_ms', metrics.durationMs);
  span.setAttribute('planner.tokens_input', metrics.tokensInput);
  span.setAttribute('planner.tokens_output', metrics.tokensOutput);
  span.setAttribute('planner.cost_eur', metrics.costEur);
  span.setAttribute('planner.success', metrics.errorClass === undefined);
  if (metrics.errorClass !== undefined) {
    span.setAttribute('planner.error_class', metrics.errorClass);
  }
  span.setAttribute('planner.household_hash', hashForCorrelation(metrics.householdId));
}

// ─────────────────────────────────────────────────────────────────────────────
// Whitelist de atributos do span do Executor (8 keys)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Keys permitidas em `agent.executor.run` span attributes.
 *
 * `executor.failed_tool_name` é tool name (metadata, não PII — é o
 * snake_case identifier registado em `toolRegistry`).
 */
export const EXECUTOR_SPAN_ATTRIBUTE_KEYS = [
  'executor.tool_count',
  'executor.duration_ms',
  'executor.success',
  'executor.rolled_back',
  'executor.failed_tool_name',
  'executor.reverse_op_count',
  'executor.run_id',
  'executor.household_hash',
] as const;

export type ExecutorSpanAttributeKey = (typeof EXECUTOR_SPAN_ATTRIBUTE_KEYS)[number];

/**
 * Métricas anotadas no span do Executor pós-execução.
 */
export interface ExecutorSpanMetrics {
  readonly toolCount: number;
  readonly durationMs: number;
  readonly success: boolean;
  readonly rolledBack: boolean;
  readonly failedToolName?: string;
  readonly reverseOpCount: number;
  readonly runId: string;
  readonly householdId: string;
}

const EXECUTOR_SPAN_NAME = 'agent.executor.run';

/**
 * Wrap de uma chamada `Executor.execute()` com span OTel.
 *
 * Este span é PARENT dos N spans `agent.tool.call` criados internamente por
 * `executeAtomic` da Story 2.3 — o caller não precisa de fazer nada explícito,
 * o context propagation OTel trata da relação parent-child.
 */
export async function withExecutorSpan<T>(fn: (span: Span) => Promise<T>): Promise<T> {
  return withSpan(EXECUTOR_SPAN_NAME, {}, fn);
}

/**
 * Anota métricas finais no span do Executor — chamado pelo Executor antes de
 * retornar.
 */
export function annotateExecutorMetrics(span: Span, metrics: ExecutorSpanMetrics): void {
  span.setAttribute('executor.tool_count', metrics.toolCount);
  span.setAttribute('executor.duration_ms', metrics.durationMs);
  span.setAttribute('executor.success', metrics.success);
  span.setAttribute('executor.rolled_back', metrics.rolledBack);
  if (metrics.failedToolName !== undefined) {
    span.setAttribute('executor.failed_tool_name', metrics.failedToolName);
  }
  span.setAttribute('executor.reverse_op_count', metrics.reverseOpCount);
  span.setAttribute('executor.run_id', metrics.runId);
  span.setAttribute('executor.household_hash', hashForCorrelation(metrics.householdId));
}
