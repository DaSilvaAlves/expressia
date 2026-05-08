/**
 * Helper de tracing para chamadas LLM — wrappa `withSpan` de
 * `@meu-jarvis/observability` com convenções específicas do agent.
 *
 * Trace: Story 2.2 AC8 + Story 1.7 (`@meu-jarvis/observability` deliverables)
 *        + Architecture §9.2-9.3 + EPIC-2-EXECUTION ED3.
 *
 * **PII guardrail**: NUNCA incluir prompt content, messages array ou tools
 * input_schema como span attributes — apenas metadados quantitativos
 * (provider, model, tokens, cost, latency, cache_hit, retry_count, fallback_used).
 */
import type { Span } from '@opentelemetry/api';

import { withSpan } from '@meu-jarvis/observability';

import type { LlmModel } from './contracts';
import type { ProviderId } from './errors';

/**
 * Nome canónico do span — corresponde à convenção da Architecture §9.2.
 */
export const PROVIDER_SPAN_NAME = 'agent.provider.call';

/**
 * Lista canónica de attribute keys que esta camada pode emitir.
 * Usada por testes para validar exclusão de PII.
 */
export const PROVIDER_SPAN_ATTRIBUTE_KEYS: ReadonlyArray<string> = [
  'agent.provider',
  'agent.model',
  'agent.tokens_input',
  'agent.tokens_output',
  'agent.cost_eur',
  'agent.latency_ms',
  'agent.cache_hit',
  'agent.retry_count',
  'agent.fallback_used',
  'agent.trace_id',
] as const;

/**
 * Atributos quantitativos finalizados após a call — aplicados ao span no
 * sucesso via `span.setAttributes`.
 */
export interface ProviderCallMetrics {
  readonly tokensInput: number;
  readonly tokensOutput: number;
  readonly costEur: number;
  readonly latencyMs: number;
  readonly cacheHit: boolean;
  readonly retryCount: number;
  readonly fallbackUsed: boolean;
  readonly traceId: string;
}

/**
 * Cria um span `agent.provider.call` com attributes iniciais (provider, model)
 * e executa `fn`. Após retorno, aplica métricas finais via callback opcional.
 *
 * Em caso de erro, o `withSpan` underlying chama `recordSpanError` automaticamente.
 *
 * @example
 *   return withProviderSpan('anthropic', 'claude-sonnet-4-5', async (span) => {
 *     const start = Date.now();
 *     const result = await client.messages.create({...});
 *     span.setAttributes({
 *       'agent.tokens_input': result.usage.input_tokens,
 *       'agent.tokens_output': result.usage.output_tokens,
 *       ...
 *     });
 *     return result;
 *   });
 */
export async function withProviderSpan<T>(
  providerId: ProviderId,
  model: LlmModel,
  fn: (span: Span) => Promise<T>,
): Promise<T> {
  return withSpan(
    PROVIDER_SPAN_NAME,
    {
      extra: {
        'agent.provider': providerId,
        'agent.model': model,
      },
    },
    fn,
  );
}

/**
 * Aplica métricas finalizadas a um span (helper para uso dentro do callback
 * de `withProviderSpan`). Garante que apenas keys whitelisted são emitidas.
 */
export function annotateProviderMetrics(span: Span, metrics: ProviderCallMetrics): void {
  span.setAttribute('agent.tokens_input', metrics.tokensInput);
  span.setAttribute('agent.tokens_output', metrics.tokensOutput);
  span.setAttribute('agent.cost_eur', metrics.costEur);
  span.setAttribute('agent.latency_ms', metrics.latencyMs);
  span.setAttribute('agent.cache_hit', metrics.cacheHit);
  span.setAttribute('agent.retry_count', metrics.retryCount);
  span.setAttribute('agent.fallback_used', metrics.fallbackUsed);
  span.setAttribute('agent.trace_id', metrics.traceId);
}
