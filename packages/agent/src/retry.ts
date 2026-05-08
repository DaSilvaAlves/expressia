/**
 * Retry helper com backoff exponencial + jitter.
 *
 * Trace: Story 2.2 AC5 + Risk R2 (latência p95).
 *
 * Política:
 *   - max attempts default 3
 *   - base delay 200ms × 2^attempt + jitter ±50ms
 *   - apenas erros `retryable === true` são retentados
 *   - `Retry-After` header (via `RateLimitError.retryAfterMs` ou
 *     `ServerError`) substitui o backoff exponencial quando presente
 */
import { ProviderError, RateLimitError } from './errors';

export interface RetryOpts {
  /** Default 3 attempts (1 inicial + 2 retries). */
  readonly maxAttempts?: number;
  /** Base delay em ms para backoff exponencial. Default 200. */
  readonly baseDelayMs?: number;
  /** Jitter ± em ms. Default 50. */
  readonly jitterMs?: number;
  /**
   * Hook chamado em cada retry com `(attempt, error, delayMs)`.
   * Usado por `AnthropicProvider`/`OpenAIProvider` para incrementar
   * o span attribute `agent.provider.retry_count`.
   */
  readonly onRetry?: (attempt: number, error: ProviderError, delayMs: number) => void;
  /**
   * Override de `Math.random` — usado em tests para tornar o jitter
   * determinístico.
   */
  readonly random?: () => number;
}

const DEFAULT_OPTS = {
  maxAttempts: 3,
  baseDelayMs: 200,
  jitterMs: 50,
} as const;

/**
 * Calcula o delay para um determinado attempt (1-indexed).
 *
 * - attempt=1 → primeira execução, sem delay (devolve 0)
 * - attempt=2 → baseDelayMs × 2^0 + jitter = ~200ms ± 50ms
 * - attempt=3 → baseDelayMs × 2^1 + jitter = ~400ms ± 50ms
 */
export function computeBackoffDelay(
  attempt: number,
  baseDelayMs: number,
  jitterMs: number,
  random: () => number = Math.random,
): number {
  if (attempt <= 1) return 0;
  const exp = baseDelayMs * Math.pow(2, attempt - 2);
  const jitter = (random() * 2 - 1) * jitterMs;
  return Math.max(0, Math.floor(exp + jitter));
}

/**
 * Sleep com `setTimeout` — extraído para overridable em tests via vi.spyOn.
 */
async function sleep(ms: number): Promise<void> {
  if (ms <= 0) return;
  await new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Executa `fn` com retry exponencial.
 *
 * Comportamento:
 *   1. Tenta `fn()`. Sucesso → retorna.
 *   2. Erro: se NÃO instância de `ProviderError` ou `retryable === false`,
 *      propaga imediatamente (sem retry).
 *   3. Se `RateLimitError.retryAfterMs` ou `(err as any).retryAfterMs`
 *      definido, espera esse tempo. Senão, computa backoff exponencial.
 *   4. Repete até `maxAttempts`. Último erro propaga.
 *
 * @example
 *   const result = await withRetry(() => provider.complete(input), { maxAttempts: 3 });
 */
export async function withRetry<T>(
  fn: () => Promise<T>,
  opts: RetryOpts = {},
): Promise<T> {
  const maxAttempts = opts.maxAttempts ?? DEFAULT_OPTS.maxAttempts;
  const baseDelayMs = opts.baseDelayMs ?? DEFAULT_OPTS.baseDelayMs;
  const jitterMs = opts.jitterMs ?? DEFAULT_OPTS.jitterMs;
  const random = opts.random ?? Math.random;

  let lastError: unknown;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastError = err;
      // Erros não-ProviderError (e.g. bug de código) propagam imediatamente.
      if (!(err instanceof ProviderError)) throw err;
      // Erros não-retryable propagam imediatamente.
      if (!err.retryable) throw err;
      // Se for o último attempt, propaga sem esperar.
      if (attempt >= maxAttempts) throw err;

      // Decidir delay: Retry-After tem precedência sobre backoff exponencial.
      let delay: number;
      if (err instanceof RateLimitError && err.retryAfterMs !== null) {
        delay = err.retryAfterMs;
      } else {
        delay = computeBackoffDelay(attempt + 1, baseDelayMs, jitterMs, random);
      }

      opts.onRetry?.(attempt, err, delay);
      await sleep(delay);
    }
  }

  // Inalcançável (loop ou retorna ou throw), mas TS exige.
  throw lastError;
}
