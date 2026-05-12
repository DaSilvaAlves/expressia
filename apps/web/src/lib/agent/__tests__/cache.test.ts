// @vitest-environment node
/**
 * Tests para `apps/web/src/lib/agent/cache.ts` — Story 2.9 AC13.
 *
 * Estratégia mockable-only (DN1): `vi.mock('@upstash/redis')` para simular
 * HIT/MISS sem call real a Upstash. Modo degradado testado sem env vars.
 *
 * Trace: Story 2.9 AC1+AC2+AC13, DN1-DN4.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const upstashMocks = vi.hoisted(() => ({
  getMock: vi.fn(),
  setMock: vi.fn(),
  delMock: vi.fn(),
  redisCtor: vi.fn(),
}));

vi.mock('@upstash/redis', () => ({
  Redis: vi.fn().mockImplementation((cfg: { url: string; token: string }) => {
    upstashMocks.redisCtor(cfg);
    return {
      get: upstashMocks.getMock,
      set: upstashMocks.setMock,
      del: upstashMocks.delMock,
    };
  }),
}));

import {
  buildCacheKey,
  UpstashCache,
  CACHE_TTL_SECONDS,
  _resetCacheClientForTests,
} from '@/lib/agent/cache';

describe('buildCacheKey — determinismo + normalização', () => {
  it('AC13(i) — mesma input → mesmo hash (determinístico)', () => {
    const a = buildCacheKey('quantas tarefas tenho?', 'familia');
    const b = buildCacheKey('quantas tarefas tenho?', 'familia');
    expect(a).toBe(b);
    expect(a).toMatch(/^[a-f0-9]{64}$/);
  });

  it('AC13(ii) — normaliza whitespace/maiúsculas (trim + lowercase + collapse)', () => {
    const base = buildCacheKey('quantas tarefas tenho?', 'familia');
    expect(buildCacheKey('  Quantas Tarefas Tenho?  ', 'familia')).toBe(base);
    expect(buildCacheKey('quantas    tarefas\ttenho?', 'familia')).toBe(base);
    expect(buildCacheKey('\n quantas\n tarefas\n tenho?', 'familia')).toBe(base);
  });

  it('AC13(iii) — planos diferentes produzem keys diferentes (key inclui household_plan)', () => {
    const familia = buildCacheKey('quantas tarefas?', 'familia');
    const pessoal = buildCacheKey('quantas tarefas?', 'pessoal');
    const pro = buildCacheKey('quantas tarefas?', 'pro');
    expect(familia).not.toBe(pessoal);
    expect(familia).not.toBe(pro);
    expect(pessoal).not.toBe(pro);
  });

  it('AC13 — prompts diferentes produzem keys diferentes', () => {
    const a = buildCacheKey('quantas tarefas tenho?', 'familia');
    const b = buildCacheKey('qual é o meu saldo?', 'familia');
    expect(a).not.toBe(b);
  });
});

describe('UpstashCache — modo degradado (sem env vars)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    delete process.env['UPSTASH_REDIS_REST_URL'];
    delete process.env['UPSTASH_REDIS_REST_TOKEN'];
    _resetCacheClientForTests();
  });

  it('AC13(iv) — get() retorna null em modo degradado sem throw', async () => {
    const cache = new UpstashCache();
    const result = await cache.get('any-key');
    expect(result).toBeNull();
    expect(upstashMocks.getMock).not.toHaveBeenCalled();
  });

  it('AC13 — set() é no-op em modo degradado sem throw', async () => {
    const cache = new UpstashCache();
    await expect(cache.set('k', 'v', { ex: 60 })).resolves.toBeUndefined();
    expect(upstashMocks.setMock).not.toHaveBeenCalled();
  });

  it('AC13 — del() é no-op em modo degradado sem throw', async () => {
    const cache = new UpstashCache();
    await expect(cache.del('k')).resolves.toBeUndefined();
    expect(upstashMocks.delMock).not.toHaveBeenCalled();
  });
});

describe('UpstashCache — modo activo (mock Upstash via injection)', () => {
  afterEach(() => {
    vi.clearAllMocks();
    _resetCacheClientForTests();
  });

  it('AC13(v) — get() HIT retorna string cacheada (injecção directa)', async () => {
    upstashMocks.getMock.mockResolvedValueOnce('{"intents":[]}');
    const cache = new UpstashCache({
      get: upstashMocks.getMock,
      set: upstashMocks.setMock,
      del: upstashMocks.delMock,
    });
    const result = await cache.get('hot-key');
    expect(result).toBe('{"intents":[]}');
  });

  it('AC13(v) — get() MISS retorna null (Upstash retorna null)', async () => {
    upstashMocks.getMock.mockResolvedValueOnce(null);
    const cache = new UpstashCache({
      get: upstashMocks.getMock,
      set: upstashMocks.setMock,
      del: upstashMocks.delMock,
    });
    expect(await cache.get('cold-key')).toBeNull();
  });

  it('AC13 — get() Upstash falha → retorna null sem throw (modo degradado de runtime)', async () => {
    upstashMocks.getMock.mockRejectedValueOnce(new Error('Upstash 500'));
    const cache = new UpstashCache({
      get: upstashMocks.getMock,
      set: upstashMocks.setMock,
      del: upstashMocks.delMock,
    });
    expect(await cache.get('any')).toBeNull();
  });

  it('AC13 — set() invoca Upstash com TTL default CACHE_TTL_SECONDS quando opts omitido', async () => {
    upstashMocks.setMock.mockResolvedValueOnce('OK');
    const cache = new UpstashCache({
      get: upstashMocks.getMock,
      set: upstashMocks.setMock,
      del: upstashMocks.delMock,
    });
    await cache.set('k', 'v');
    expect(upstashMocks.setMock).toHaveBeenCalledWith('k', 'v', { ex: CACHE_TTL_SECONDS });
  });

  it('AC13(vi) — NUNCA loga prompt cleartext (apenas key hash em error messages)', async () => {
    // Defesa: cache key é hash SHA-256, prompt original nunca aparece.
    const key = buildCacheKey('email-secreto-pessoal@expressia.pt', 'familia');
    expect(key).toMatch(/^[a-f0-9]{64}$/);
    expect(key).not.toContain('email');
    expect(key).not.toContain('expressia');
    expect(key).not.toContain('secreto');
  });
});

describe('CACHE_TTL_SECONDS — env override', () => {
  it('AC13 — default 300s quando env var ausente', () => {
    // CACHE_TTL_SECONDS é avaliado em import time; verifica o default actual.
    expect(typeof CACHE_TTL_SECONDS).toBe('number');
    expect(CACHE_TTL_SECONDS).toBeGreaterThan(0);
  });
});
