/**
 * Tracing wrapper para o endpoint POST /api/agent/prompt.
 *
 * Story 2.6 AC12 + D23 — re-usa `withSpan`/`annotateSpan` de
 * `@meu-jarvis/observability` (Story 1.7), adicionando a camada de span de
 * topo `POST /api/agent/prompt` com attributes de negócio PII-safe.
 *
 * Sub-spans (`agent.classifier.classify`, `agent.planner.call`,
 * `agent.executor.run`) são emitidos pelos packages downstream
 * (`@meu-jarvis/classifier`, `@meu-jarvis/planner-executor`) — este wrapper
 * NÃO os duplica (D23: "não duplicar código de tracing").
 *
 * Whitelist de attributes (NFR12 — zero PII):
 *   - household_id  (UUID — não PII em si; identifica tenant)
 *   - intent_class  (enum value — primeira intent detectada)
 *   - confidence_min (float)
 *   - mode           ('preview' | 'executed')
 *   - tool_count     (integer)
 *   - duration_ms    (integer)
 *   - classifier_model + executor_model (enum values; AC12 PO_FIX)
 *   - cache_hit      (boolean)
 *
 * Trace: Story 2.6 AC12 + D23, NFR12, NFR17. Architecture §9.1-9.3.
 */
import type { Span } from '@opentelemetry/api';

import {
  annotateSpan,
  recordSpanError,
  withSpan,
  type DomainAttributes,
} from '@meu-jarvis/observability';

/**
 * Attributes públicos do span POST /api/agent/prompt — todos PII-safe e em
 * lowercase snake_case (convenção OTel + Architecture §9.1).
 */
export interface AgentPromptSpanAttributes {
  readonly household_id?: string;
  readonly intent_class?: string;
  readonly confidence_min?: number;
  readonly mode?: 'preview' | 'executed';
  readonly tool_count?: number;
  readonly duration_ms?: number;
  readonly classifier_model?: string;
  readonly executor_model?: string;
  readonly cache_hit?: boolean;
  readonly status_code?: number;
  /** Story 2.7 FR4 — `user_prefs.always_preview` activo para esta run. */
  readonly always_preview_active?: boolean;
}

/**
 * Wrapper sobre `withSpan` para o endpoint POST /api/agent/prompt.
 *
 * @param routeName - Nome do endpoint (ex: 'POST /api/agent/prompt').
 * @param attrs - Attributes iniciais (domain context).
 * @param fn - Handler a executar dentro do span.
 *
 * Uso:
 * ```ts
 * return withAgentPromptSpan('POST /api/agent/prompt', { method: 'POST', route: '/api/agent/prompt' }, async (span) => {
 *   annotateAgentPromptSpan(span, { household_id, mode: 'executed', tool_count: 3 });
 *   ...
 * });
 * ```
 */
export function withAgentPromptSpan<T>(
  routeName: string,
  attrs: DomainAttributes,
  fn: (span: Span) => Promise<T>,
): Promise<T> {
  return withSpan(routeName, attrs, fn);
}

/**
 * Annotate o span com attributes específicos do endpoint /api/agent/prompt.
 *
 * Apenas as keys da whitelist `AgentPromptSpanAttributes` são propagadas para
 * OTel — defesa em profundidade contra logging acidental de PII.
 */
export function annotateAgentPromptSpan(
  span: Span,
  attributes: AgentPromptSpanAttributes,
): void {
  const safe: Record<string, string | number | boolean> = {};
  if (attributes.household_id !== undefined) safe['household_id'] = attributes.household_id;
  if (attributes.intent_class !== undefined) safe['intent_class'] = attributes.intent_class;
  if (attributes.confidence_min !== undefined) safe['confidence_min'] = attributes.confidence_min;
  if (attributes.mode !== undefined) safe['mode'] = attributes.mode;
  if (attributes.tool_count !== undefined) safe['tool_count'] = attributes.tool_count;
  if (attributes.duration_ms !== undefined) safe['duration_ms'] = attributes.duration_ms;
  if (attributes.classifier_model !== undefined) safe['classifier_model'] = attributes.classifier_model;
  if (attributes.executor_model !== undefined) safe['executor_model'] = attributes.executor_model;
  if (attributes.cache_hit !== undefined) safe['cache_hit'] = attributes.cache_hit;
  if (attributes.status_code !== undefined) safe['status_code'] = attributes.status_code;
  if (attributes.always_preview_active !== undefined) safe['always_preview_active'] = attributes.always_preview_active;

  for (const [key, value] of Object.entries(safe)) {
    span.setAttribute(`agent.prompt.${key}`, value);
  }

  // Re-export annotation utility — mantém shape para callers preferirem o
  // padrão @meu-jarvis/observability quando útil.
  if (attributes.status_code !== undefined) {
    annotateSpan(span, { statusCode: attributes.status_code });
  }
  if (attributes.household_id !== undefined) {
    annotateSpan(span, { householdId: attributes.household_id });
  }
}

/**
 * Re-export para conveniência — handlers podem usar directamente sem importar
 * de `@meu-jarvis/observability`.
 */
export { recordSpanError };
