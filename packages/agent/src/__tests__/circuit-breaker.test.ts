import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { CircuitBreaker } from '@/circuit-breaker';
import { CircuitOpenError, ServerError } from '@/errors';

describe('CircuitBreaker', () => {
  let now: number;
  const clock = () => now;

  beforeEach(() => {
    CircuitBreaker.resetAll();
    now = 1_000_000_000;
  });

  afterEach(() => {
    CircuitBreaker.resetAll();
  });

  it('estado inicial: closed', () => {
    const cb = new CircuitBreaker('anthropic', { now: clock });
    expect(cb.getState()).toBe('closed');
    expect(cb.isOpen()).toBe(false);
  });

  it('5 falhas consecutivas em <60s → state open', async () => {
    const cb = new CircuitBreaker('anthropic', { now: clock });
    const failingFn = async () => {
      throw new ServerError('anthropic', 503);
    };
    for (let i = 0; i < 5; i++) {
      await expect(cb.execute(failingFn)).rejects.toBeInstanceOf(ServerError);
      now += 1000; // 1s entre falhas, total 5s
    }
    expect(cb.getState()).toBe('open');
  });

  it('open state: chamadas levantam CircuitOpenError', async () => {
    const cb = new CircuitBreaker('anthropic', { now: clock });
    const failingFn = async () => {
      throw new ServerError('anthropic', 503);
    };
    for (let i = 0; i < 5; i++) {
      await expect(cb.execute(failingFn)).rejects.toThrow();
      now += 1000;
    }
    // Próxima chamada → CircuitOpenError sem invocar fn
    let called = false;
    const probe = async () => {
      called = true;
      return 'ok';
    };
    await expect(cb.execute(probe)).rejects.toBeInstanceOf(CircuitOpenError);
    expect(called).toBe(false);
  });

  it('half_open após 30s — sucesso → closed', async () => {
    const cb = new CircuitBreaker('anthropic', { now: clock, initialOpenCooldownMs: 30_000 });
    const failingFn = async () => {
      throw new ServerError('anthropic', 503);
    };
    for (let i = 0; i < 5; i++) {
      await expect(cb.execute(failingFn)).rejects.toThrow();
      now += 1000;
    }
    expect(cb.getState()).toBe('open');

    // Avança 30s — entra half_open
    now += 30_000;
    expect(cb.getState()).toBe('half_open');

    // Probe success → closed
    const result = await cb.execute(async () => 'recovered');
    expect(result).toBe('recovered');
    expect(cb.getState()).toBe('closed');
  });

  it('half_open fail → open com cooldown maior (60s)', async () => {
    const cb = new CircuitBreaker('anthropic', {
      now: clock,
      initialOpenCooldownMs: 30_000,
      halfOpenFailCooldownMs: 60_000,
    });
    const failingFn = async () => {
      throw new ServerError('anthropic', 503);
    };
    for (let i = 0; i < 5; i++) {
      await expect(cb.execute(failingFn)).rejects.toThrow();
      now += 1000;
    }
    expect(cb.getState()).toBe('open');

    // Avança 30s — half_open
    now += 30_000;
    expect(cb.getState()).toBe('half_open');

    // Probe falha → open de novo com cooldown 60s
    await expect(cb.execute(failingFn)).rejects.toBeInstanceOf(ServerError);
    expect(cb.getState()).toBe('open');

    // Após 30s ainda deve estar open (cooldown agora 60s)
    now += 30_000;
    expect(cb.getState()).toBe('open');

    // Após +30s adicionais (total 60s) entra half_open
    now += 30_000;
    expect(cb.getState()).toBe('half_open');
  });

  it('non-retryable errors NÃO contam para o threshold', async () => {
    const cb = new CircuitBreaker('anthropic', { now: clock });
    const authFail = async () => {
      const { AuthError } = await import('@/errors');
      throw new AuthError('anthropic', 401);
    };
    for (let i = 0; i < 10; i++) {
      await expect(cb.execute(authFail)).rejects.toThrow();
      now += 1000;
    }
    // 10 auth errors → ainda closed (não contam)
    expect(cb.getState()).toBe('closed');
    expect(cb.getFailureCount()).toBe(0);
  });

  it('singleton getInstance: mesma instância para mesmo providerId', () => {
    const a = CircuitBreaker.getInstance('anthropic');
    const b = CircuitBreaker.getInstance('anthropic');
    expect(a).toBe(b);
    const c = CircuitBreaker.getInstance('openai');
    expect(c).not.toBe(a);
  });
});
