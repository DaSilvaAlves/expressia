/**
 * Helpers de OTel tracing para tool execution — wrappam `withSpan` de
 * `@meu-jarvis/observability` com convenções específicas do tool registry.
 *
 * Trace: Story 2.3 AC9 + Story 1.7 (`@meu-jarvis/observability` deliverables)
 *        + Architecture §9.2-9.3 + NFR12.
 *
 * **PII guardrail (NFR12):** NUNCA incluir tool input, tool output, prompt
 * content, snapshot data de `restore_row` ou descrições human-readable como
 * span attributes. Apenas metadados quantitativos e identificadores hashed.
 *
 * Estes helpers são INTERNOS ao package — não exportados pelo barrel
 * `index.ts`. As tools concretas (Stories 2.6+) usam-nos via callbacks; os
 * consumidores do package (Story 2.5 Planner) só vêem `executeAtomic`, que
 * já está envolvido em `withAtomicSpan`.
 */
import type { Span } from '@opentelemetry/api';

import { hashForCorrelation, withSpan } from '@meu-jarvis/observability';

import type { ToolDomain } from './contracts';

/**
 * Nome canónico do span de uma tool individual.
 */
export const TOOL_SPAN_NAME = 'agent.tool.call';

/**
 * Nome canónico do span do `executeAtomic` completo.
 */
export const ATOMIC_SPAN_NAME = 'agent.tool.atomic';

/**
 * Lista canónica de attribute keys que estes wrappers podem emitir.
 *
 * Exposta publicamente (via `index.ts`) para que a Story 2.5 (Planner) e
 * configuração de Grafana dashboards (Story futura) possam validar inclusão
 * de PII em tempo de teste.
 */
export const TOOL_SPAN_ATTRIBUTE_KEYS: ReadonlyArray<string> = [
  // Span agent.tool.call
  'tool.name',
  'tool.domain',
  'tool.duration_ms',
  'tool.success',
  'tool.household_hash',
  'tool.trace_id',
  // Span agent.tool.atomic
  'tool.atomic.tool_count',
  'tool.atomic.run_id',
  'tool.atomic.success',
  'tool.atomic.rolled_back',
] as const;

/**
 * Atributos quantitativos finalizados após uma tool call individual.
 */
export interface ToolCallMetrics {
  readonly durationMs: number;
  readonly success: boolean;
  readonly householdId: string;
  readonly traceId: string;
}

/**
 * Atributos finalizados após `executeAtomic` completo.
 */
export interface AtomicMetrics {
  readonly success: boolean;
  readonly rolledBack: boolean;
}

/**
 * Cria um span `agent.tool.call` com attributes iniciais (`tool.name`,
 * `tool.domain`) e executa `fn`. O caller deve invocar `annotateToolMetrics`
 * antes de retornar para preencher `duration_ms`, `success`, `household_hash`,
 * `trace_id`.
 *
 * Em caso de erro, `withSpan` underlying chama `recordSpanError`
 * automaticamente e propaga a excepção.
 *
 * @param toolName - Identificador da tool (ex: 'criar_tarefa').
 * @param domain - Domínio funcional para correlação multi-tool.
 * @param fn - Callback async que recebe o span e devolve o resultado.
 * @returns Resultado de `fn`.
 *
 * @example
 *   return withToolSpan('criar_tarefa', 'tasks', async (span) => {
 *     const start = Date.now();
 *     const output = await tool.execute(input, ctx);
 *     annotateToolMetrics(span, {
 *       durationMs: Date.now() - start,
 *       success: true,
 *       householdId: ctx.householdId,
 *       traceId: ctx.traceId,
 *     });
 *     return output;
 *   });
 */
export async function withToolSpan<T>(
  toolName: string,
  domain: ToolDomain,
  fn: (span: Span) => Promise<T>,
): Promise<T> {
  return withSpan(
    TOOL_SPAN_NAME,
    {
      extra: {
        'tool.name': toolName,
        'tool.domain': domain,
      },
    },
    fn,
  );
}

/**
 * Aplica métricas finalizadas a um span de tool call.
 *
 * **Garante** apenas keys whitelisted são emitidas (compile-time via lista
 * literal abaixo, runtime via testes).
 *
 * @param span - Span criado por `withToolSpan`.
 * @param metrics - Métricas a aplicar.
 */
export function annotateToolMetrics(span: Span, metrics: ToolCallMetrics): void {
  span.setAttribute('tool.duration_ms', metrics.durationMs);
  span.setAttribute('tool.success', metrics.success);
  span.setAttribute('tool.household_hash', hashForCorrelation(metrics.householdId));
  span.setAttribute('tool.trace_id', metrics.traceId);
}

/**
 * Cria um span `agent.tool.atomic` com attributes iniciais (`tool_count`,
 * `run_id`) e executa `fn`. O caller deve invocar `annotateAtomicMetrics`
 * para preencher `success` e `rolled_back`.
 *
 * @param runId - UUID do `agent_runs.id` corrente.
 * @param toolCount - Número de tools que `executeAtomic` vai correr.
 * @param fn - Callback async.
 *
 * @example
 *   return withAtomicSpan(ctx.runId, tools.length, async (span) => {
 *     const result = await runTransaction();
 *     annotateAtomicMetrics(span, { success: result.success, rolledBack: !result.success });
 *     return result;
 *   });
 */
export async function withAtomicSpan<T>(
  runId: string,
  toolCount: number,
  fn: (span: Span) => Promise<T>,
): Promise<T> {
  return withSpan(
    ATOMIC_SPAN_NAME,
    {
      extra: {
        'tool.atomic.tool_count': toolCount,
        'tool.atomic.run_id': runId,
      },
    },
    fn,
  );
}

/**
 * Aplica métricas finalizadas a um span de atomic execution.
 *
 * @param span - Span criado por `withAtomicSpan`.
 * @param metrics - Métricas a aplicar.
 */
export function annotateAtomicMetrics(span: Span, metrics: AtomicMetrics): void {
  span.setAttribute('tool.atomic.success', metrics.success);
  span.setAttribute('tool.atomic.rolled_back', metrics.rolledBack);
}
