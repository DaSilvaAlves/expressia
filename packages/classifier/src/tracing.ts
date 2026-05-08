/**
 * Helpers OTel internos do classifier — wrappam `withSpan`/`annotateSpan`
 * de `@meu-jarvis/observability` com convenções específicas do classifier.
 *
 * Trace: Story 2.4 AC9 + NFR12 (NO PII em spans) + Architecture §9.3 OTel +
 *        Story 1.7 (`@meu-jarvis/observability` deliverables) + padrão de
 *        `packages/tools/src/tracing.ts` (Story 2.3).
 *
 * **PII guardrail (NFR12):** NUNCA incluir `input.text`, `raw_span` de
 * intents, `userId` raw, ou raw output do LLM. APENAS metadados quantitativos
 * e identificadores hashed. A lista canónica
 * `CLASSIFIER_SPAN_ATTRIBUTE_KEYS` é exportada (via `index.ts`) para que o
 * teste de whitelist em `__tests__/tracing.test.ts` valide ausência de PII.
 *
 * Estes helpers são INTERNOS — não exportados pelo barrel. O caller (a classe
 * `Classifier` em `classifier.ts`) usa-os internamente.
 */

import type { Span, Attributes } from '@opentelemetry/api';

import { annotateSpan, hashForCorrelation, withSpan } from '@meu-jarvis/observability';

/**
 * Nome canónico do span da chamada `Classifier.classify()`.
 */
export const CLASSIFIER_SPAN_NAME = 'agent.classifier.classify';

/**
 * Lista canónica de attribute keys que estes wrappers podem emitir.
 *
 * Exposta publicamente (via `index.ts`) para validação em testes
 * (`__tests__/tracing.test.ts`) e para configuração de Grafana dashboards
 * (Story 2.11 — Observability Agent Health).
 *
 * **NÃO acrescentar keys que possam conter PII** (input.text, raw_span,
 * user_id raw, raw output do LLM).
 *
 * `household.id` (do annotateSpan da observability) é UUID — explicitamente
 * documentado em `tracer.ts` como NÃO PII (apenas tenant identifier).
 * `user.id` é hashed automaticamente pelo `annotateSpan`.
 */
export const CLASSIFIER_SPAN_ATTRIBUTE_KEYS: ReadonlyArray<string> = [
  'classifier.model',
  'classifier.input_length',
  'classifier.intent_count',
  'classifier.overall_confidence',
  'classifier.language_detected',
  'classifier.duration_ms',
  'classifier.tokens_input',
  'classifier.tokens_output',
  'classifier.success',
  'classifier.error_class',
  'classifier.user_hash',
  'classifier.trace_id',
] as const;

/**
 * Atributos quantitativos finais a anotar no span após `Classifier.classify()`.
 *
 * `userId` é hashed via `hashForCorrelation` antes de ir para o span;
 * `householdId` propaga via `annotateSpan` (UUID — não PII per tracer doc).
 * `traceId` propagado directamente.
 *
 * NUNCA aceitar input.text ou raw_span aqui.
 */
export interface ClassifierSpanMetrics {
  readonly model: string;
  readonly inputLength: number;
  readonly intentCount: number;
  readonly overallConfidence: number;
  readonly languageDetected: 'pt-PT' | 'non-pt-pt';
  readonly durationMs: number;
  readonly tokensInput: number;
  readonly tokensOutput: number;
  readonly success: boolean;
  readonly errorClass: string | null;
  readonly userId: string;
  readonly householdId: string;
  readonly traceId: string;
}

/**
 * Cria um span `agent.classifier.classify` com `classifier.model` inicial em
 * `extra` e `householdId` propagado via `DomainAttributes`. Executa `fn`.
 * O caller deve invocar `annotateClassifierMetrics` antes de retornar para
 * preencher os restantes atributos.
 *
 * Em caso de erro, `withSpan` underlying chama `recordSpanError`
 * automaticamente e propaga a excepção.
 */
export async function withClassifierSpan<T>(
  model: string,
  householdId: string,
  fn: (span: Span) => Promise<T>,
): Promise<T> {
  return withSpan(
    CLASSIFIER_SPAN_NAME,
    {
      householdId,
      extra: { 'classifier.model': model },
    },
    fn,
  );
}

/**
 * Anota o span com as métricas finais. Aplica `hashForCorrelation` ao
 * `userId` e injecta as keys `classifier.*` via `extra`.
 *
 * **Whitelist enforcement:** todas as keys aqui devem aparecer em
 * `CLASSIFIER_SPAN_ATTRIBUTE_KEYS` — o test em `__tests__/tracing.test.ts`
 * valida esta invariante.
 */
export function annotateClassifierMetrics(span: Span, metrics: ClassifierSpanMetrics): void {
  const extra: Attributes = {
    'classifier.input_length': metrics.inputLength,
    'classifier.intent_count': metrics.intentCount,
    'classifier.overall_confidence': metrics.overallConfidence,
    'classifier.language_detected': metrics.languageDetected,
    'classifier.duration_ms': metrics.durationMs,
    'classifier.tokens_input': metrics.tokensInput,
    'classifier.tokens_output': metrics.tokensOutput,
    'classifier.success': metrics.success,
    'classifier.error_class': metrics.errorClass ?? '',
    'classifier.user_hash': hashForCorrelation(metrics.userId),
    'classifier.trace_id': metrics.traceId,
  };
  annotateSpan(span, { extra });
}
