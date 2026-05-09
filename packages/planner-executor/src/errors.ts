/**
 * Hierarquia tipada de erros do package `@meu-jarvis/planner-executor`.
 *
 * Trace: Story 2.5 AC10 + AC11 + Architecture §4.3 (error handling tool
 *        calling) + NFR12 (PII redaction).
 *
 * Princípio [AUTO-DECISION D13]: o Executor DELEGA `ToolError` da 2.3 (não
 * cria hierarquia paralela tipo ExecutorExecutionError). Razão: thin wrapper,
 * single source of truth na 2.3. Única excepção: `ExecutorValidationError`
 * para falha de `ExecutorInputSchema.parse(input)` ANTES de chegar a
 * `executeAtomic` — análogo a `PlannerValidationError`, agrupado neste
 * package por coesão.
 *
 * Princípio NFR12: nenhum `message` inclui conteúdo de input (raw spans,
 * planReasoning, tool inputs/outputs). Verificação dedicada em
 * `__tests__/errors.test.ts` cobre NIF PT (9 dígitos), email, IBAN PT
 * (PT50...), telefone PT (+351...).
 */
import { ProviderError, sanitizeHint } from '@meu-jarvis/agent';

// ─────────────────────────────────────────────────────────────────────────────
// PlannerError — base abstracta
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Severidade do erro — usada por callers para decidir log level.
 *
 * - `error` (default) — erro de sistema; logado como Pino `error`.
 * - `warn` — caso degenerado esperado (ex: PlannerEmptyPlanError); Pino `warn`.
 */
export type PlannerErrorSeverity = 'error' | 'warn';

/**
 * Base abstracta para todos os erros do Planner.
 *
 * Subclasses devem definir:
 *   - `userMessage`: texto PT-PT mostrável ao utilizador final via Story 2.6.
 *   - `retryable`: indica se um retry pode resolver (ex: rate limit retryable;
 *     hallucination não retryable).
 *
 * Stack trace é capturado automaticamente via `Error.captureStackTrace`.
 */
export abstract class PlannerError extends Error {
  public abstract readonly userMessage: string;
  public abstract readonly retryable: boolean;
  public readonly severity: PlannerErrorSeverity = 'error';

  constructor(message: string) {
    super(message);
    this.name = this.constructor.name;
    if (typeof Error.captureStackTrace === 'function') {
      Error.captureStackTrace(this, this.constructor);
    }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// PlannerValidationError — input parsing falhou
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Falha de `PlannerInputSchema.parse(input)` — input estruturalmente inválido
 * (UUID malformado, classification ausente, etc.).
 *
 * NÃO retryable — defeito estrutural não desaparece com retry.
 *
 * `message` NUNCA inclui `classification.intents[].raw_span` (PII potential).
 */
export class PlannerValidationError extends PlannerError {
  public readonly userMessage = 'Pedido inválido. Tenta de novo com outras palavras.';
  public readonly retryable = false;

  constructor(field: string, hint: string) {
    super(`PlannerInput inválido em campo ${field}: ${sanitizeHint(hint)}`);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// PlannerLLMError — wrapper de ProviderError da 2.2
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Wrapper de `ProviderError` de `@meu-jarvis/agent` (rate limit, timeout,
 * network, server, auth, content policy, missing key, circuit open).
 *
 * `retryable` herda de `ProviderError.retryable` — Planner não decide
 * retryability, delega ao provider (que tem mais contexto).
 *
 * `cause` exposto para logging/Sentry mas o `message` desta classe NÃO inclui
 * o prompt original (cumpre NFR12 — `sanitizeHint` aplicado).
 */
export class PlannerLLMError extends PlannerError {
  public readonly userMessage = 'O motor de IA não conseguiu responder agora. Tenta de novo em alguns segundos.';
  public readonly retryable: boolean;
  public override readonly cause: ProviderError;

  constructor(cause: ProviderError) {
    super(`Provider Anthropic erro: ${cause.name} — ${sanitizeHint(cause.message)}`);
    this.cause = cause;
    this.retryable = cause.retryable;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// PlannerToolNotFoundError — Sonnet alucinou tool name
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Sonnet retornou um `tool_use` com `name` que não existe em `toolRegistry`.
 *
 * NÃO retryable — modelo provavelmente persistiria no erro. Caller pode
 * cair em fallback `unknown` ou apresentar erro ao utilizador.
 *
 * `message` inclui apenas `toolName` (metadata, não PII).
 */
export class PlannerToolNotFoundError extends PlannerError {
  public readonly userMessage = 'O motor de IA tentou usar uma operação desconhecida. Reformula o pedido.';
  public readonly retryable = false;
  public readonly toolName: string;

  constructor(toolName: string) {
    super(`Sonnet alucinou tool name fora do registry: ${toolName}`);
    this.toolName = toolName;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// PlannerOutputError — output do Sonnet não passa schema
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Output do Sonnet não passa `PlanResultSchema` (incoerência estrutural —
 * ex: array com >10 tool calls, tipos inválidos).
 *
 * Retryable: o Planner faz 1 retry com `temperature=0` (determinismo) antes
 * de propagar — análogo ao retry da 2.4 AC8 ClassifierOutputError.
 *
 * `message` NÃO inclui o raw output do LLM (PII potential).
 */
export class PlannerOutputError extends PlannerError {
  public readonly userMessage = 'O motor de IA respondeu de forma inesperada. Tenta de novo.';
  public readonly retryable = true;

  constructor(hint: string) {
    super(`Sonnet output inválido contra PlanResultSchema: ${sanitizeHint(hint)}`);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// PlannerEmptyPlanError — caso degenerado warn
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Sonnet retornou `toolCalls=[]` mesmo com `intents != [unknown]` —
 * caso degenerado (modelo "preguiçoso" ou few-shot prompt insuficiente).
 *
 * NÃO retryable (retry do mesmo modelo provavelmente reproduz o resultado;
 * fix correcto é melhorar `PLANNER_SYSTEM_PROMPT` com mais exemplos).
 *
 * Severity `warn` — não é erro de sistema, é sinal de calibração de prompt.
 *
 * `message` inclui apenas `intentCount` numérico (não PII).
 */
export class PlannerEmptyPlanError extends PlannerError {
  public readonly userMessage = 'Não foi possível traduzir o teu pedido em acções concretas. Tenta reformular.';
  public readonly retryable = false;
  public override readonly severity: PlannerErrorSeverity = 'warn';
  public readonly intentCount: number;

  constructor(intentCount: number) {
    super(`Planner empty plan: classification tinha ${intentCount} intents não-unknown mas Sonnet devolveu toolCalls=[]`);
    this.intentCount = intentCount;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// ExecutorValidationError — única excepção do Executor (D13)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Falha de `ExecutorInputSchema.parse(input)` — input estruturalmente inválido
 * ANTES de chegar a `executeAtomic`.
 *
 * NÃO retryable — defeito estrutural.
 *
 * **Decisão D13:** o Executor delega `ToolError` da 2.3 para erros runtime
 * de execução de tools (ToolValidationError, ToolExecutionError,
 * ToolTransactionError, ToolNotFoundError, ToolPlanGateError). Esta
 * `ExecutorValidationError` é a ÚNICA excepção, agrupada neste package por
 * coesão (análoga a PlannerValidationError).
 *
 * Não-extends-PlannerError porque é semanticamente do Executor; mas partilha
 * estrutura. Se @architect preferir base unificada `PlannerExecutorError`,
 * defere para futura refactoring.
 */
export class ExecutorValidationError extends Error {
  public readonly userMessage = 'Pedido inválido. Tenta de novo com outras palavras.';
  public readonly retryable = false;
  public readonly severity: PlannerErrorSeverity = 'error';

  constructor(field: string, hint: string) {
    super(`ExecutorInput inválido em campo ${field}: ${sanitizeHint(hint)}`);
    this.name = 'ExecutorValidationError';
    if (typeof Error.captureStackTrace === 'function') {
      Error.captureStackTrace(this, ExecutorValidationError);
    }
  }
}
