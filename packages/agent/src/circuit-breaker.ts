/**
 * Circuit Breaker per-process in-memory por provider.
 *
 * Trace: Story 2.2 AC6 + Risk R2.
 *
 * Estados:
 *   - `closed`: chamadas normais; erros são contados em janela de 60s.
 *   - `open`: 5 falhas consecutivas em <60s → aberto durante 30s; calls
 *     levantam `CircuitOpenError` imediatamente (fast-fail).
 *   - `half_open`: após 30s, permite 1 probe call; sucesso → `closed`,
 *     falha → `open` por mais 60s.
 *
 * NOTA importante: `open` cooldown duration aumenta de 30s → 60s nas
 * subsequentes aberturas (após half_open fail) — proteção contra
 * thundering herd em outages prolongados.
 *
 * Esta implementação é per-process in-memory (cada Vercel function instance
 * tem o seu CB). Story 2.9 substituirá por versão distribuída via Upstash
 * Redis.
 */
import { CircuitOpenError, ProviderError, type ProviderId } from './errors';

export type CircuitState = 'closed' | 'open' | 'half_open';

export interface CircuitBreakerOpts {
  /** Falhas consecutivas para abrir o circuit. Default 5. */
  readonly failureThreshold?: number;
  /** Janela de contagem de falhas em ms. Default 60_000. */
  readonly failureWindowMs?: number;
  /** Cooldown inicial após abertura, em ms. Default 30_000. */
  readonly initialOpenCooldownMs?: number;
  /** Cooldown após half_open fail, em ms. Default 60_000. */
  readonly halfOpenFailCooldownMs?: number;
  /** Override de `Date.now` para tests determinísticos. */
  readonly now?: () => number;
}

const DEFAULTS = {
  failureThreshold: 5,
  failureWindowMs: 60_000,
  initialOpenCooldownMs: 30_000,
  halfOpenFailCooldownMs: 60_000,
} as const;

interface CircuitInternalState {
  state: CircuitState;
  failures: number[]; // timestamps das falhas dentro da janela
  openedAt: number | null;
  cooldownMs: number;
}

/**
 * Circuit breaker para um provider específico.
 *
 * Use `CircuitBreaker.getInstance(providerId)` para o singleton per-process,
 * ou instancia directamente em tests.
 */
export class CircuitBreaker {
  private static readonly instances = new Map<ProviderId, CircuitBreaker>();

  /**
   * Reset todas as instâncias singleton — usado em test setup para garantir
   * isolamento entre suites.
   */
  public static resetAll(): void {
    CircuitBreaker.instances.clear();
  }

  /**
   * Singleton per-process por providerId. Ideal para uso normal em runtime.
   */
  public static getInstance(providerId: ProviderId, opts?: CircuitBreakerOpts): CircuitBreaker {
    const existing = CircuitBreaker.instances.get(providerId);
    if (existing !== undefined) return existing;
    const created = new CircuitBreaker(providerId, opts);
    CircuitBreaker.instances.set(providerId, created);
    return created;
  }

  private readonly providerId: ProviderId;
  private readonly failureThreshold: number;
  private readonly failureWindowMs: number;
  private readonly initialOpenCooldownMs: number;
  private readonly halfOpenFailCooldownMs: number;
  private readonly now: () => number;
  private readonly internal: CircuitInternalState;

  constructor(providerId: ProviderId, opts: CircuitBreakerOpts = {}) {
    this.providerId = providerId;
    this.failureThreshold = opts.failureThreshold ?? DEFAULTS.failureThreshold;
    this.failureWindowMs = opts.failureWindowMs ?? DEFAULTS.failureWindowMs;
    this.initialOpenCooldownMs = opts.initialOpenCooldownMs ?? DEFAULTS.initialOpenCooldownMs;
    this.halfOpenFailCooldownMs = opts.halfOpenFailCooldownMs ?? DEFAULTS.halfOpenFailCooldownMs;
    this.now = opts.now ?? Date.now;
    this.internal = {
      state: 'closed',
      failures: [],
      openedAt: null,
      cooldownMs: this.initialOpenCooldownMs,
    };
  }

  public getState(): CircuitState {
    this.refreshState();
    return this.internal.state;
  }

  public isOpen(): boolean {
    return this.getState() === 'open';
  }

  /**
   * Executa `fn` através do circuit breaker.
   *
   * - Se state = `open` (após cooldown ainda activo), levanta `CircuitOpenError`.
   * - Se state = `half_open`, executa `fn` como probe; sucesso fecha, falha reabre.
   * - Se state = `closed`, executa normalmente; falhas contam para threshold.
   */
  public async execute<T>(fn: () => Promise<T>): Promise<T> {
    this.refreshState();

    if (this.internal.state === 'open') {
      const remaining = this.computeRemainingCooldown();
      throw new CircuitOpenError(this.providerId, remaining);
    }

    try {
      const result = await fn();
      this.recordSuccess();
      return result;
    } catch (err) {
      // Apenas erros retryable contam para o threshold.
      // Auth/BadRequest/ContentPolicy/MissingApiKey não devem abrir o circuit.
      if (err instanceof ProviderError && err.retryable) {
        this.recordFailure();
      } else if (!(err instanceof ProviderError)) {
        // Erros desconhecidos (não-ProviderError) também contam (defensivo).
        this.recordFailure();
      }
      throw err;
    }
  }

  /**
   * Retorna o número de falhas actualmente na janela (para debug/tests).
   */
  public getFailureCount(): number {
    this.cleanupOldFailures();
    return this.internal.failures.length;
  }

  // ───────────────────────────────────────────────────────────────────────────
  // Internals
  // ───────────────────────────────────────────────────────────────────────────

  /**
   * Avança o estado conforme tempo decorrido (open → half_open quando cooldown
   * expira).
   */
  private refreshState(): void {
    if (this.internal.state !== 'open') return;
    const remaining = this.computeRemainingCooldown();
    if (remaining <= 0) {
      this.internal.state = 'half_open';
    }
  }

  private computeRemainingCooldown(): number {
    if (this.internal.openedAt === null) return 0;
    const elapsed = this.now() - this.internal.openedAt;
    return Math.max(0, this.internal.cooldownMs - elapsed);
  }

  private cleanupOldFailures(): void {
    const cutoff = this.now() - this.failureWindowMs;
    this.internal.failures = this.internal.failures.filter((t) => t >= cutoff);
  }

  private recordFailure(): void {
    if (this.internal.state === 'half_open') {
      // Half-open probe falhou: reabrir com cooldown maior.
      this.openCircuit(this.halfOpenFailCooldownMs);
      return;
    }
    if (this.internal.state === 'closed') {
      this.cleanupOldFailures();
      this.internal.failures.push(this.now());
      if (this.internal.failures.length >= this.failureThreshold) {
        this.openCircuit(this.initialOpenCooldownMs);
      }
    }
    // state === 'open' não deveria chegar aqui (execute lança antes), mas é seguro ignorar.
  }

  private recordSuccess(): void {
    if (this.internal.state === 'half_open') {
      this.closeCircuit();
      return;
    }
    if (this.internal.state === 'closed') {
      // Sucesso em closed: reset gradual da contagem (limpa só falhas fora da janela).
      this.cleanupOldFailures();
    }
  }

  private openCircuit(cooldownMs: number): void {
    this.internal.state = 'open';
    this.internal.openedAt = this.now();
    this.internal.cooldownMs = cooldownMs;
  }

  private closeCircuit(): void {
    this.internal.state = 'closed';
    this.internal.openedAt = null;
    this.internal.failures = [];
    this.internal.cooldownMs = this.initialOpenCooldownMs;
  }
}
