/**
 * Entry-point público do package `@meu-jarvis/planner-executor`.
 *
 * Trace: Story 2.5 AC14.
 *
 * Exports públicos:
 *   - `Planner` (class) + `PlannerOpts`, defaults
 *   - `Executor` (class) + `ExecutorOpts`, `DbResolver`
 *   - Schemas Zod (`PlanResultSchema`, `PlanToolCallSchema`, `PlannerInputSchema`,
 *     `ExecutorInputSchema`) e tipos derivados
 *   - Constantes (`PLANNER_SYSTEM_PROMPT_VERSION`, defaults numéricos)
 *   - Hierarquia de erros (`PlannerError` + 5 subclasses + `ExecutorValidationError`)
 *   - Whitelist span attribute keys (para Story 2.11 dashboards Grafana)
 *   - Re-exports de `@meu-jarvis/tools` para conveniência (`AtomicResult`,
 *     `AtomicFailure`, `AtomicOutcome`, `ToolError` + 6 subclasses)
 *
 * NÃO exportados (privados ao package):
 *   - `PLANNER_SYSTEM_PROMPT` (texto bruto — apenas `PLANNER_SYSTEM_PROMPT_VERSION`)
 *   - `withPlannerSpan`, `withExecutorSpan`, `annotatePlannerMetrics`,
 *     `annotateExecutorMetrics` — internos
 *   - `TOOL_TO_INTENT_MAP`, `resolveIntentFromToolName` — internos
 *   - `__fixtures__/*` — APENAS para testes
 */

// Classes principais
//
// NOTA (Story 2.6 fix): imports relativos `./` em vez de `@/*` para que
// consumers cross-package (apps/web/typecheck) consigam resolver tipos sem
// depender de paths internos do package. Pattern alinhado com 2.2/2.3/2.4
// (D16 directive da 2.5 — "source files cross-package usar relativos `./`").
export { Planner, DEFAULT_PLANNER_MAX_TOKENS, DEFAULT_PLANNER_TEMPERATURE, DEFAULT_PLANNER_TIMEOUT_MS } from './planner';
export type { PlannerOpts } from './planner';

export { Executor } from './executor';
export type { ExecutorOpts, DbResolver } from './executor';

// Schemas e tipos
export {
  PlanToolCallSchema,
  PlanResultSchema,
  PlannerInputSchema,
  ExecutorInputSchema,
} from './schemas';
export type {
  PlanToolCall,
  PlanResult,
  PlannerInput,
  ExecutorInput,
} from './schemas';

// System prompt — apenas versão (texto raw NÃO exportado)
export { PLANNER_SYSTEM_PROMPT_VERSION } from './prompts/planner-system';

// Errors
export {
  PlannerError,
  PlannerValidationError,
  PlannerLLMError,
  PlannerToolNotFoundError,
  PlannerOutputError,
  PlannerEmptyPlanError,
  ExecutorValidationError,
} from './errors';
export type { PlannerErrorSeverity } from './errors';

// Tracing — apenas keys públicas (whitelist)
export {
  PLANNER_SPAN_ATTRIBUTE_KEYS,
  EXECUTOR_SPAN_ATTRIBUTE_KEYS,
} from './tracing';
export type {
  PlannerSpanAttributeKey,
  ExecutorSpanAttributeKey,
} from './tracing';

// Re-exports de @meu-jarvis/tools para conveniência (consumers do endpoint
// 2.6 não precisam de importar de 2 packages diferentes)
export type {
  AtomicResult,
  AtomicFailure,
  AtomicOutcome,
  AtomicToolResult,
} from '@meu-jarvis/tools';
export {
  ToolError,
  ToolValidationError,
  ToolExecutionError,
  ToolTransactionError,
  ToolNotFoundError,
  DuplicateToolError,
  ToolPlanGateError,
} from '@meu-jarvis/tools';
