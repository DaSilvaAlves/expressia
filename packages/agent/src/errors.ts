/**
 * Hierarquia tipada de erros do package `@meu-jarvis/agent`.
 *
 * Trace: Story 2.2 AC7 + AC9 (PII redaction).
 *
 * Princípios:
 *   - Mensagens PT-PT em ambos `message` (técnico, para logs/Sentry) e
 *     `userMessage` (humano, para UI Story 2.6 endpoint).
 *   - NUNCA carregar prompt content no `message` (PII).
 *   - Distinção retryable vs non-retryable via flag `retryable` (consumido
 *     por `withRetry` em `retry.ts`).
 *
 * Mapping SDK errors → ProviderError em `providers/anthropic.ts` e
 * `providers/openai.ts` via switch sobre `status`/`code`.
 */

/**
 * ID de provider — match com `ProviderInterface.id`.
 */
export type ProviderId = 'anthropic' | 'openai';

/**
 * Classe abstracta base para todos os erros emitidos pelo package agent.
 *
 * Extende `Error` standard mas adiciona:
 *   - `providerId`: para correlação multi-provider
 *   - `userMessage`: PT-PT, neutro de implementação, mostrável ao utilizador
 *   - `retryable`: governa o comportamento de `withRetry`
 */
export abstract class ProviderError extends Error {
  public readonly providerId: ProviderId;
  public readonly userMessage: string;
  public readonly retryable: boolean;

  protected constructor(
    message: string,
    providerId: ProviderId,
    userMessage: string,
    retryable: boolean,
  ) {
    super(message);
    this.name = new.target.name;
    this.providerId = providerId;
    this.userMessage = userMessage;
    this.retryable = retryable;
    // Preserva stack trace correctamente em V8.
    if (typeof Error.captureStackTrace === 'function') {
      Error.captureStackTrace(this, new.target);
    }
  }
}

/**
 * Provider devolveu HTTP 429 (rate limit).
 * Retryable com `Retry-After` honoured se presente.
 */
export class RateLimitError extends ProviderError {
  public readonly retryAfterMs: number | null;

  constructor(providerId: ProviderId, retryAfterMs: number | null = null) {
    super(
      `Provider ${providerId} returned 429 (rate limit). retryAfterMs=${retryAfterMs ?? 'unset'}`,
      providerId,
      'Demasiados pedidos ao serviço de IA. Tenta novamente em alguns segundos.',
      true,
    );
    this.retryAfterMs = retryAfterMs;
  }
}

/**
 * Timeout do client (controller abort) ou da própria SDK.
 */
export class TimeoutError extends ProviderError {
  public readonly timeoutMs: number;

  constructor(providerId: ProviderId, timeoutMs: number) {
    super(
      `Provider ${providerId} timed out after ${timeoutMs}ms`,
      providerId,
      'O serviço de IA demorou demasiado a responder. Tenta novamente.',
      true,
    );
    this.timeoutMs = timeoutMs;
  }
}

/**
 * Provider devolveu HTTP 5xx.
 * Retryable.
 */
export class ServerError extends ProviderError {
  public readonly httpStatus: number;

  constructor(providerId: ProviderId, httpStatus: number) {
    super(
      `Provider ${providerId} returned ${httpStatus} (server error)`,
      providerId,
      'O serviço de IA está temporariamente indisponível. Tenta novamente.',
      true,
    );
    this.httpStatus = httpStatus;
  }
}

/**
 * Erro de rede (DNS, connection reset, EAI_AGAIN, etc.).
 * Retryable.
 */
export class NetworkError extends ProviderError {
  public override readonly cause: unknown;

  constructor(providerId: ProviderId, cause: unknown) {
    super(
      `Provider ${providerId} network error: ${cause instanceof Error ? cause.name : String(cause)}`,
      providerId,
      'Não foi possível ligar ao serviço de IA. Verifica a tua ligação e tenta novamente.',
      true,
    );
    this.cause = cause;
  }
}

/**
 * Provider devolveu HTTP 401 ou 403 — credencial inválida ou sem permissões.
 * NÃO retryable (retry com a mesma key falhará igualmente).
 */
export class AuthError extends ProviderError {
  public readonly httpStatus: number;

  constructor(providerId: ProviderId, httpStatus: number) {
    super(
      `Provider ${providerId} returned ${httpStatus} (authentication failed)`,
      providerId,
      'Credenciais do serviço de IA inválidas. Contacta o suporte.',
      false,
    );
    this.httpStatus = httpStatus;
  }
}

/**
 * Provider devolveu HTTP 400 ou 422 — payload mal formado.
 * NÃO retryable (mesmo payload falhará).
 *
 * `message` NÃO inclui o payload original (PII).
 */
export class BadRequestError extends ProviderError {
  public readonly httpStatus: number;
  public readonly providerHint: string;

  constructor(providerId: ProviderId, httpStatus: number, providerHint: string) {
    super(
      `Provider ${providerId} returned ${httpStatus} (bad request): ${providerHint}`,
      providerId,
      'O pedido ao serviço de IA é inválido. Reformula a tua pergunta.',
      false,
    );
    this.httpStatus = httpStatus;
    this.providerHint = providerHint;
  }
}

/**
 * Provider rejeitou o conteúdo por política (e.g. content policy violation).
 * NÃO retryable.
 */
export class ContentPolicyError extends ProviderError {
  public readonly reason: string;

  constructor(providerId: ProviderId, reason: string) {
    super(
      `Provider ${providerId} rejected request (content policy): ${reason}`,
      providerId,
      'O conteúdo do pedido foi rejeitado pelo serviço de IA. Reformula a tua pergunta.',
      false,
    );
    this.reason = reason;
  }
}

/**
 * Env var de API key ausente ou vazia.
 * NÃO retryable — falha de configuração.
 */
export class MissingApiKeyError extends ProviderError {
  constructor(providerId: ProviderId) {
    super(
      `Provider ${providerId} API key is missing from environment`,
      providerId,
      'Serviço de IA não configurado. Contacta o suporte.',
      false,
    );
  }
}

/**
 * Circuit breaker está em estado `open` para este provider — fast-fail.
 * NÃO retryable nesta call (a janela de cooldown encarrega-se de testar).
 */
export class CircuitOpenError extends ProviderError {
  public readonly retryAfterMs: number;

  constructor(providerId: ProviderId, retryAfterMs: number) {
    super(
      `Provider ${providerId} circuit breaker is open. retryAfterMs=${retryAfterMs}`,
      providerId,
      'O serviço de IA está temporariamente desactivado por instabilidade recente. Tenta novamente em breve.',
      false,
    );
    this.retryAfterMs = retryAfterMs;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Mapping helpers — SDK error → ProviderError
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Forma genérica que tanto Anthropic como OpenAI SDKs expõem em erros HTTP.
 * Não importamos os tipos directos para evitar coupling pesado.
 */
interface SdkErrorShape {
  readonly status?: number;
  readonly headers?: Record<string, string | undefined> | null;
  readonly message?: string;
  readonly name?: string;
  readonly code?: string;
  readonly type?: string;
}

/**
 * Extrai `Retry-After` (segundos ou data HTTP) e converte para milissegundos.
 * Retorna `null` se ausente ou inparseável.
 */
function parseRetryAfter(headers: Record<string, string | undefined> | null | undefined): number | null {
  if (!headers) return null;
  const raw = headers['retry-after'] ?? headers['Retry-After'];
  if (!raw) return null;
  const asNum = Number(raw);
  if (!Number.isNaN(asNum) && asNum >= 0) return asNum * 1000;
  // HTTP date format
  const asDate = Date.parse(raw);
  if (!Number.isNaN(asDate)) {
    const delta = asDate - Date.now();
    return delta > 0 ? delta : 0;
  }
  return null;
}

/**
 * Mapeia um erro do `@anthropic-ai/sdk` para a hierarquia `ProviderError`.
 *
 * Heurística:
 *   - `err.status === 401 || 403` → `AuthError`
 *   - `err.status === 429` → `RateLimitError` (com retry-after)
 *   - `err.status === 400 || 422` → `BadRequestError` ou `ContentPolicyError`
 *     se `type === 'invalid_request_error'` com `policy` no message
 *   - `err.status >= 500` → `ServerError`
 *   - `err.name === 'AbortError'` ou similar → `TimeoutError`
 *   - default → `NetworkError`
 */
export function mapAnthropicError(err: unknown, timeoutMsHint = 30000): ProviderError {
  const PROVIDER: ProviderId = 'anthropic';
  if (err instanceof ProviderError) return err;

  const e = (err ?? {}) as SdkErrorShape;
  const status = e.status;
  const message = e.message ?? '';
  const lcType = (e.type ?? '').toLowerCase();
  const lcMsg = message.toLowerCase();

  // Timeout / abort
  if (e.name === 'AbortError' || lcMsg.includes('aborted') || e.code === 'ETIMEDOUT') {
    return new TimeoutError(PROVIDER, timeoutMsHint);
  }

  if (typeof status === 'number') {
    if (status === 401 || status === 403) return new AuthError(PROVIDER, status);
    if (status === 429) return new RateLimitError(PROVIDER, parseRetryAfter(e.headers));
    if (status === 400 || status === 422) {
      if (lcType.includes('content') || lcMsg.includes('policy') || lcMsg.includes('safety')) {
        return new ContentPolicyError(PROVIDER, sanitizeHint(message));
      }
      return new BadRequestError(PROVIDER, status, sanitizeHint(message));
    }
    if (status >= 500 && status < 600) return new ServerError(PROVIDER, status);
  }

  // Default: tratar como erro de rede.
  return new NetworkError(PROVIDER, err);
}

/**
 * Mapeia um erro do `openai` SDK para a hierarquia `ProviderError`.
 * Comportamento análogo a `mapAnthropicError`.
 */
export function mapOpenAIError(err: unknown, timeoutMsHint = 30000): ProviderError {
  const PROVIDER: ProviderId = 'openai';
  if (err instanceof ProviderError) return err;

  const e = (err ?? {}) as SdkErrorShape;
  const status = e.status;
  const message = e.message ?? '';
  const lcCode = (e.code ?? '').toLowerCase();
  const lcMsg = message.toLowerCase();

  if (e.name === 'AbortError' || lcMsg.includes('aborted') || lcCode === 'etimedout' || lcCode === 'request_timeout') {
    return new TimeoutError(PROVIDER, timeoutMsHint);
  }

  if (typeof status === 'number') {
    if (status === 401 || status === 403) return new AuthError(PROVIDER, status);
    if (status === 429) return new RateLimitError(PROVIDER, parseRetryAfter(e.headers));
    if (status === 400 || status === 422) {
      if (lcCode.includes('content_policy') || lcMsg.includes('policy') || lcMsg.includes('moderation')) {
        return new ContentPolicyError(PROVIDER, sanitizeHint(message));
      }
      return new BadRequestError(PROVIDER, status, sanitizeHint(message));
    }
    if (status >= 500 && status < 600) return new ServerError(PROVIDER, status);
  }

  return new NetworkError(PROVIDER, err);
}

/**
 * Limita o tamanho do hint do provider e remove padrões que possam vazar PII.
 * Conservador: corta a 200 chars e elimina sequências longas de caracteres
 * alfanuméricos que possam ser tokens/IBAN/NIF.
 */
function sanitizeHint(raw: string): string {
  const trimmed = raw.replace(/\s+/g, ' ').trim().slice(0, 200);
  // Remove sequências longas (potenciais tokens/keys/IDs):
  //   - >= 10 chars alfanuméricos com símbolos (`_` / `-`) — captures most tokens
  //   - >= 9 dígitos puros — capta NIFs portugueses (9 dígitos), CPFs, etc.
  return trimmed
    .replace(/[A-Za-z0-9_-]{10,}/g, '[REDACTED]')
    .replace(/\d{9,}/g, '[REDACTED]');
}
