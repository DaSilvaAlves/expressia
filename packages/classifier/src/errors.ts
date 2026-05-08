/**
 * Hierarquia tipada de erros do package `@meu-jarvis/classifier`.
 *
 * Trace: Story 2.4 AC8 + AC10 (PII redaction) + Story 2.2 AC7 (pattern de
 *        hierarquia tipada com `userMessage` PT-PT) + Story 2.3 errors.ts
 *        (replicado aqui).
 *
 * Princípios:
 *   - PT-PT exclusivo em `userMessage` (CON3) — neutro de implementação
 *     (não menciona "OpenAI", "GPT", "JSON", "schema").
 *   - `message` técnico para logs/Sentry; NUNCA inclui o texto bruto do
 *     utilizador (NFR12 — AC10).
 *   - `retryable: false` para erros determinísticos (validação, language gate,
 *     confidence). `retryable: true` apenas para `ClassifierOutputError`
 *     (retry 1× com temperature=0 — alinhado com Architecture §4.2 e padrão
 *     de Story 2.2).
 *   - `ClassifierLLMError` envolve `ProviderError` da Story 2.2 e expõe `cause`
 *     para correlação OTel.
 *   - Sem `ClassifierConfidenceError` — confidence baixa não é erro, é
 *     sinalizada via `needs_confirmation: true` (FR4) [AUTO-DECISION D4 do
 *     @sm, validada por @po].
 *   - `severity` `'warn'` para `ClassifierLanguageError` (input non-PT-PT é
 *     comportamento esperado de gate, não anomalia de sistema) [AUTO-DECISION
 *     D7 do @sm, validada por @po].
 */

import { sanitizeHint, type ProviderError } from '@meu-jarvis/agent';

/**
 * Severity para correlação com OTel/log levels:
 *   - `'warn'`: comportamento esperado mas anómalo (ex: input non-PT-PT).
 *   - `'error'`: anomalia de sistema ou input que falha validação.
 */
export type ClassifierErrorSeverity = 'warn' | 'error';

/**
 * Classe abstracta base para todos os erros do classifier.
 *
 * Estende `Error` standard com:
 *   - `userMessage`: PT-PT, neutro de implementação, mostrável ao utilizador
 *     final pela Story 2.6 endpoint `/api/agent/prompt` (FR4 preview UI).
 *   - `retryable`: governa o comportamento de retry no `Classifier.classify()`
 *     e no Planner+Executor da Story 2.5.
 *   - `severity`: governa nível de logging/observability (NFR13).
 */
export abstract class ClassifierError extends Error {
  public readonly userMessage: string;
  public readonly retryable: boolean;
  public readonly severity: ClassifierErrorSeverity;

  protected constructor(
    message: string,
    userMessage: string,
    retryable: boolean,
    severity: ClassifierErrorSeverity,
  ) {
    super(message);
    this.name = new.target.name;
    this.userMessage = userMessage;
    this.retryable = retryable;
    this.severity = severity;
    if (typeof Error.captureStackTrace === 'function') {
      Error.captureStackTrace(this, new.target);
    }
  }
}

/**
 * Input do utilizador é inválido — vazio, só whitespace, ou excede
 * `maxInputLength` (default 1000 chars).
 *
 * NÃO retryable. NUNCA inclui o texto de input no `message` (PII).
 */
export class ClassifierValidationError extends ClassifierError {
  public readonly reason: 'empty' | 'too_long';
  public readonly inputLength: number;
  public readonly maxLength: number;

  constructor(reason: 'empty' | 'too_long', inputLength: number, maxLength: number) {
    const technicalDetail =
      reason === 'empty'
        ? 'Input rejected: empty or whitespace-only.'
        : `Input rejected: length ${inputLength} exceeds max ${maxLength}.`;
    const userDetail =
      reason === 'empty'
        ? 'O texto está vazio. Escreve um pedido para o agente processar.'
        : `O texto é demasiado longo. Limite: ${maxLength} caracteres.`;
    super(technicalDetail, userDetail, false, 'error');
    this.reason = reason;
    this.inputLength = inputLength;
    this.maxLength = maxLength;
  }
}

/**
 * Language gate detectou input que não parece PT-PT (PT-BR, EN, ES, ou outras
 * línguas). NÃO retryable. Severity `warn` — não é erro de sistema.
 *
 * NUNCA inclui o texto de input no `message` (NFR12).
 */
export class ClassifierLanguageError extends ClassifierError {
  public readonly detectedPatterns: ReadonlyArray<string>;

  constructor(detectedPatterns: ReadonlyArray<string>) {
    super(
      `Language gate rejected input — detected non-PT-PT patterns: [${detectedPatterns.join(', ')}].`,
      'O agente só aceita pedidos em português europeu (PT-PT). Reformula em PT-PT.',
      false,
      'warn',
    );
    this.detectedPatterns = detectedPatterns;
  }
}

/**
 * Wrapper de `ProviderError` da Story 2.2 — rate limit, network, timeout,
 * server error, auth error, content policy, etc.
 *
 * `retryable` herda de `ProviderError.retryable`. `cause` exposto para Sentry
 * extrair o erro original sem perder informação.
 *
 * `message` usa `sanitizeHint` para o hint técnico (importado de
 * `@meu-jarvis/agent` — Story 2.4 D10).
 */
export class ClassifierLLMError extends ClassifierError {
  public readonly providerCause: ProviderError;

  constructor(providerError: ProviderError) {
    const sanitizedHint = providerError.message
      ? sanitizeHint(providerError.message)
      : '(sem detalhe)';
    super(
      `Classifier LLM call failed (${providerError.constructor.name}): ${sanitizedHint}`,
      'Não foi possível classificar o pedido neste momento. Tenta de novo em alguns segundos.',
      providerError.retryable,
      'error',
    );
    this.providerCause = providerError;
    // Manter `cause` standard ECMA para tooling (Sentry, Node trace).
    (this as Error & { cause?: unknown }).cause = providerError;
  }
}

/**
 * LLM devolveu output que NÃO passa `ClassificationSchema.parse()`:
 *   - JSON malformado;
 *   - Intent fora dos 8 valores canónicos;
 *   - `intents` com 0 ou >5 entradas (viola guardrails AC3);
 *   - confidence fora de [0, 1];
 *   - `language` !== 'pt-PT'.
 *
 * Retryable: `true` — primeira tentativa pode ser retentada com temperature=0
 * (deterministic). Se falhar 2× consecutivas, o caller deve cair em
 * `unknown` (Architecture §4.2).
 *
 * NUNCA inclui o raw output no `message` (PII potential — o LLM pode ter
 * incluído tokens do prompt original).
 */
export class ClassifierOutputError extends ClassifierError {
  public readonly zodIssueCount: number;

  constructor(zodIssueCount: number) {
    super(
      `Classifier LLM output failed schema validation (${zodIssueCount} Zod issues).`,
      'O agente não conseguiu interpretar a resposta do classificador. Tenta reformular o pedido.',
      true,
      'error',
    );
    this.zodIssueCount = zodIssueCount;
  }
}
