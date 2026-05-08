import { describe, expect, it, vi } from 'vitest';

import { AuthError, RateLimitError, ServerError } from '@/errors';
import { computeBackoffDelay, withRetry } from '@/retry';

describe('computeBackoffDelay', () => {
  it('attempt=1 retorna 0 (sem delay no primeiro try)', () => {
    expect(computeBackoffDelay(1, 200, 50, () => 0.5)).toBe(0);
  });

  it('attempt=2 ≈ 200ms (jitter 0)', () => {
    expect(computeBackoffDelay(2, 200, 50, () => 0.5)).toBe(200);
  });

  it('attempt=3 ≈ 400ms (jitter 0)', () => {
    expect(computeBackoffDelay(3, 200, 50, () => 0.5)).toBe(400);
  });

  it('jitter no range esperado [-50, +50]', () => {
    const delays: number[] = [];
    for (let i = 0; i < 50; i++) delays.push(computeBackoffDelay(2, 200, 50));
    for (const d of delays) {
      expect(d).toBeGreaterThanOrEqual(150);
      expect(d).toBeLessThanOrEqual(250);
    }
  });

  it('nunca retorna negativo', () => {
    expect(computeBackoffDelay(2, 100, 200, () => 0)).toBeGreaterThanOrEqual(0);
  });
});

describe('withRetry', () => {
  it('happy-path: 1 attempt, sucesso imediato', async () => {
    const fn = vi.fn().mockResolvedValueOnce('ok');
    const result = await withRetry(fn);
    expect(result).toBe('ok');
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('1 falha retryable + 1 sucesso = 2 attempts', async () => {
    const fn = vi
      .fn()
      .mockRejectedValueOnce(new ServerError('anthropic', 503))
      .mockResolvedValueOnce('ok');
    const onRetry = vi.fn();
    const result = await withRetry(fn, { onRetry, baseDelayMs: 0, jitterMs: 0 });
    expect(result).toBe('ok');
    expect(fn).toHaveBeenCalledTimes(2);
    expect(onRetry).toHaveBeenCalledOnce();
  });

  it('3 falhas retryable em 3 attempts → throws último erro', async () => {
    const lastErr = new ServerError('anthropic', 503);
    const fn = vi.fn().mockRejectedValue(lastErr);
    await expect(withRetry(fn, { maxAttempts: 3, baseDelayMs: 0, jitterMs: 0 })).rejects.toBe(lastErr);
    expect(fn).toHaveBeenCalledTimes(3);
  });

  it('non-retryable erro propaga imediatamente sem retry', async () => {
    const fn = vi.fn().mockRejectedValueOnce(new AuthError('anthropic', 401));
    await expect(withRetry(fn)).rejects.toBeInstanceOf(AuthError);
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('Retry-After honoured via RateLimitError.retryAfterMs', async () => {
    const fn = vi
      .fn()
      .mockRejectedValueOnce(new RateLimitError('anthropic', 50))
      .mockResolvedValueOnce('ok');
    const onRetry = vi.fn();
    const start = Date.now();
    const result = await withRetry(fn, { onRetry });
    expect(result).toBe('ok');
    expect(onRetry).toHaveBeenCalledOnce();
    expect(onRetry.mock.calls[0]?.[2]).toBe(50);
    // Sanity: pelo menos 30ms passaram (margem para timer flake)
    expect(Date.now() - start).toBeGreaterThanOrEqual(30);
  });

  it('erro não-ProviderError propaga sem retry', async () => {
    const fn = vi.fn().mockRejectedValue(new Error('plain error'));
    await expect(withRetry(fn, { maxAttempts: 5 })).rejects.toThrow('plain error');
    expect(fn).toHaveBeenCalledTimes(1);
  });
});
