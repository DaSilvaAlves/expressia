/**
 * Entry-point público do package `@meu-jarvis/tools`.
 *
 * Trace: Story 2.3 AC1 + AC2 + AC3 + AC5 + AC8 + AC9.
 *
 * Exports públicos:
 *   - Contratos (`ToolDefinition`, `ToolExecutionContext`, `ReverseOpPayload`,
 *     `AtomicResult`, `AtomicFailure`, `ToolDomain`, `PlanTier`).
 *   - Helpers de serialização (`serializeReverseOp`, `deserializeReverseOp`).
 *   - Schemas Zod (`ReverseOpPayloadSchema`, `ToolDomainSchema`,
 *     `PlanTierSchema`) — úteis para tools concretas validarem inputs.
 *   - Constantes (`COMPOSITE_REVERSE_OP_MAX_OPS`, `TOOL_DOMAIN_VALUES`,
 *     `PLAN_TIER_VALUES`).
 *   - `ToolRegistry` class + `toolRegistry` singleton + `AnthropicToolDefinition`.
 *   - `executeAtomic` + tipos `AtomicToolInput`, `AtomicOutcome`.
 *   - Hierarquia de erros completa (`ToolError` + 6 subclasses).
 *   - `TOOL_SPAN_ATTRIBUTE_KEYS` (read-only — usado por testes e Story 2.5
 *     para configurar Grafana dashboards).
 *
 * NÃO exportados (intencionalmente privados ao package):
 *   - `withToolSpan`, `withAtomicSpan`, `annotateToolMetrics`,
 *     `annotateAtomicMetrics` — callbacks usados internamente por
 *     `executeAtomic`. Tools concretas não devem criar os seus próprios
 *     spans — o helper trata disso.
 *   - `redactToolInputForLog` — helper interno para logs do package.
 *   - `__fixtures__/mock-tools` — APENAS para testes; nunca exportado.
 *   - `ToolRegistry.clear()` é exposto na class mas marcado `@internal` — não
 *     usar em produção.
 */

// Contratos
export {
  ToolDomainSchema,
  TOOL_DOMAIN_VALUES,
  PlanTierSchema,
  PLAN_TIER_VALUES,
  ReverseOpPayloadSchema,
  ReverseOpDeleteRowSchema,
  ReverseOpRestoreRowSchema,
  COMPOSITE_REVERSE_OP_MAX_OPS,
  serializeReverseOp,
  deserializeReverseOp,
} from './contracts';
export type {
  ToolDomain,
  PlanTier,
  ToolExecutionContext,
  DrizzleDbClient,
  TxRunner,
  ReverseOpPayload,
  ToolDefinition,
  AtomicResult,
  AtomicFailure,
  AtomicToolResult,
} from './contracts';

// Registry
export { ToolRegistry, toolRegistry } from './registry';
export type { AnthropicToolDefinition } from './registry';

// Atomic execution
export { executeAtomic } from './atomic';
export type { AtomicToolInput, AtomicOutcome } from './atomic';

// Errors
export {
  ToolError,
  ToolValidationError,
  ToolExecutionError,
  ToolTransactionError,
  ToolNotFoundError,
  DuplicateToolError,
  ToolPlanGateError,
} from './errors';
export type { RedactedToolLog } from './errors';

// Tracing — APENAS as constantes públicas (whitelist keys).
// Os wrappers `withToolSpan`/`withAtomicSpan` são privados ao package.
export { TOOL_SPAN_ATTRIBUTE_KEYS } from './tracing';

// Tools concretas — domínio Tarefas (Story 3.8).
// Re-export + side-effect register no toolRegistry singleton.
export * from './tasks';

// Tools concretas — domínio Finanças (Story 4.10).
// Re-export + side-effect register no toolRegistry singleton.
export * from './finance';
