/**
 * Hierarquia tipada de erros do package `@meu-jarvis/tools`.
 *
 * Trace: Story 2.3 AC8 + AC10 (PII redaction) + Story 2.2 AC7 (pattern de
 *        hierarquia tipada com `userMessage` PT-PT, replicado aqui).
 *
 * Princípios:
 *   - Mensagens PT-PT em ambos `message` (técnico, para logs/Sentry) e
 *     `userMessage` (humano, para UI Story 2.6 endpoint).
 *   - NUNCA carregar tool input content no `message` (PII — NFR12).
 *   - `userMessage` é neutro de implementação — refere-se a "agente" ou
 *     "operação", nunca a nomes técnicos de tools, providers ou tabelas.
 *   - Distinção retryable vs non-retryable via flag `retryable`. A maioria dos
 *     erros desta camada NÃO é retryable porque a causa é determinística
 *     (input inválido, tool não registado, plano insuficiente). Apenas
 *     `ToolTransactionError` é retryable porque pode resultar de contention
 *     transitória do Postgres.
 *
 * Cobertura por AC:
 *   - AC8 — taxonomia de 6 subclasses + classe abstracta base
 *   - AC10 — `redactToolInputForLog` helper (exportado privado para `atomic.ts`
 *     e `registry.ts`)
 */

/**
 * Classe abstracta base para todos os erros emitidos pelo package tools.
 *
 * Estende `Error` standard mas adiciona:
 *   - `toolName?`: identificador da tool envolvida (ausente em erros que não
 *     têm tool concreta — ex: `DuplicateToolError` no register).
 *   - `userMessage`: PT-PT, neutro de implementação, mostrável ao utilizador
 *     final pela Story 2.6 endpoint `/api/agent/prompt`.
 *   - `retryable`: governa o comportamento de eventuais wrappers de retry
 *     na camada do Planner+Executor (Story 2.5).
 */
export abstract class ToolError extends Error {
  public readonly toolName: string | undefined;
  public readonly userMessage: string;
  public readonly retryable: boolean;

  protected constructor(
    message: string,
    toolName: string | undefined,
    userMessage: string,
    retryable: boolean,
  ) {
    super(message);
    this.name = new.target.name;
    this.toolName = toolName;
    this.userMessage = userMessage;
    this.retryable = retryable;
    // Preserva stack trace correctamente em V8.
    if (typeof Error.captureStackTrace === 'function') {
      Error.captureStackTrace(this, new.target);
    }
  }
}

/**
 * Input ou output de uma tool falha validação Zod (`inputSchema.parse`/
 * `outputSchema.parse`), ou um `ReverseOpPayload` é inválido.
 *
 * NÃO retryable — o mesmo input falhará novamente. O caller (Planner em
 * Story 2.5) deve devolver `userMessage` ao utilizador para reformulação.
 *
 * O `message` técnico inclui apenas `toolName` + `field` + descrição da regra
 * violada — NUNCA o valor que falhou (PII).
 */
export class ToolValidationError extends ToolError {
  public readonly field: string;

  constructor(toolName: string, field: string, detail: string) {
    super(
      `Tool '${toolName}' validation failed on field '${field}': ${detail}`,
      toolName,
      'Os dados fornecidos ao agente são inválidos. Tenta formular o pedido de forma diferente.',
      false,
    );
    this.field = field;
  }
}

/**
 * `tool.execute(input, ctx)` lançou uma excepção não-prevista (erro de
 * Postgres, falha de constraint, type mismatch interno).
 *
 * NÃO retryable — assume causa determinística do tool input. A excepção
 * original é guardada em `cause` mas redactada antes de qualquer log via
 * `redactToolInputForLog`.
 */
export class ToolExecutionError extends ToolError {
  public override readonly cause: unknown;

  constructor(toolName: string, cause: unknown) {
    const causeName = cause instanceof Error ? cause.name : 'Unknown';
    super(
      `Tool '${toolName}' execute() threw: ${causeName}`,
      toolName,
      'Ocorreu um erro ao executar a operação pedida. Tenta novamente daqui a pouco.',
      false,
    );
    this.cause = cause;
  }
}

/**
 * Falha da transacção Drizzle/Postgres durante `executeAtomic` (deadlock,
 * serialization failure, connection drop mid-transaction).
 *
 * RETRYABLE — o caller pode tentar de novo com a mesma input; a transacção
 * inteira já foi rolled back. Distinto de `ToolExecutionError` (input
 * inválido) e `ToolValidationError` (Zod schema fail).
 */
export class ToolTransactionError extends ToolError {
  public override readonly cause: unknown;

  constructor(cause: unknown) {
    const causeName = cause instanceof Error ? cause.name : 'Unknown';
    super(
      `Tool transaction failed: ${causeName}`,
      undefined,
      'A operação não foi concluída por um problema temporário. Tenta novamente.',
      true,
    );
    this.cause = cause;
  }
}

/**
 * `toolRegistry.get(name)` foi chamado com um nome não registado.
 *
 * NÃO retryable — a tool nunca aparecerá magicamente. Indica bug no caller
 * (Story 2.5 Planner pediu uma tool que não existe).
 */
export class ToolNotFoundError extends ToolError {
  constructor(name: string) {
    super(
      `Tool '${name}' is not registered in the registry`,
      name,
      'O agente tentou executar uma operação desconhecida. Contacta o suporte se persistir.',
      false,
    );
  }
}

/**
 * `toolRegistry.register(tool)` recebeu uma tool com nome que já está
 * registado por outra tool (referência diferente).
 *
 * NÃO retryable — falha de configuração / startup. O caller deve corrigir
 * o registry ou usar `clear()` em testes.
 *
 * NOTA: a registry é IDEMPOTENTE quando chamada com a MESMA referência de
 * tool — só lança este erro quando há colisão de `name` com objecto distinto.
 */
export class DuplicateToolError extends ToolError {
  public readonly domain: string;

  constructor(name: string, domain: string) {
    super(
      `Tool '${name}' (domain '${domain}') is already registered with a different definition`,
      name,
      'Erro de configuração interna do agente. Contacta o suporte.',
      false,
    );
    this.domain = domain;
  }
}

/**
 * O plano do household actual não permite usar esta tool.
 *
 * **Locus de invocação:** esta classe é DEFINIDA no package tools (parte da
 * taxonomia para callers usarem `instanceof`) mas é INVOCADA pela Story 2.5
 * (Planner+Executor) ANTES de chamar `executeAtomic`. O Planner verifica
 * `tool.requiredPlan` contra o plano do household no contexto e lança esta
 * excepção se o gate não passa.
 *
 * Story 2.3 NÃO contém lógica `assertPlanAllowed` — a story só fornece a
 * classe + teste de instanciação para que o Planner possa importar.
 *
 * NÃO retryable — o utilizador precisa de fazer upgrade.
 */
export class ToolPlanGateError extends ToolError {
  public readonly requiredPlan: string;
  public readonly actualPlan: string;

  constructor(toolName: string, requiredPlan: string, actualPlan: string) {
    super(
      `Tool '${toolName}' requires plan '${requiredPlan}' but household has '${actualPlan}'`,
      toolName,
      'Esta operação requer um plano superior. Faz upgrade para a utilizar.',
      false,
    );
    this.requiredPlan = requiredPlan;
    this.actualPlan = actualPlan;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// PII redaction helpers
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Output canónico de `redactToolInputForLog`.
 *
 * Trace: Story 2.3 AC10 + NFR12 (PII redaction).
 *
 * NUNCA inclui o input bruto — apenas metadados quantitativos.
 */
export interface RedactedToolLog {
  readonly toolName: string;
  readonly inputRedacted: true;
}

/**
 * Helper interno (re-exportado pelo barrel apenas para testes em
 * `__tests__/`) que produz uma representação SAFE de uma tool call para
 * logs Pino / Sentry.
 *
 * **Garantia**: o input original NUNCA é serializado nem reflectido no
 * objecto retornado. Apenas `toolName` e a flag `inputRedacted: true` saem.
 *
 * Razão: o input de tools como `criar_financa_variavel` contém montantes EUR,
 * descrições com PII (nome de comerciante, NIF, etc.). Logs em produção
 * podem ser exfiltrados — a redação é defesa em profundidade complementar
 * a `PII_REDACT_PATHS` do Pino logger.
 *
 * @example
 *   logger.debug(redactToolInputForLog('criar_tarefa', { titulo: 'comprar leite' }), 'tool dispatch');
 *   // Loga: { toolName: 'criar_tarefa', inputRedacted: true } — sem o título.
 */
export function redactToolInputForLog(
  toolName: string,
  _input: unknown,
): RedactedToolLog {
  return { toolName, inputRedacted: true };
}
