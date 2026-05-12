// @vitest-environment node
/**
 * Tests para `apps/web/src/lib/agent/rate-limiter.ts` — Story 2.9 AC15.
 *
 * Cobre os fixes Story 2.9 (D48 QUOTA_BY_PLAN + D49 hard-stop 110% + DN12 period_end).
 *
 * Trace: Story 2.9 AC7+AC8+AC15, D48+D49+DN7+DN12+DN13.
 */
import { describe, expect, it, vi } from 'vitest';

import {
  QUOTA_BY_PLAN,
  RATE_LIMIT_PER_MINUTE,
  RateLimitError,
  QuotaExceededError,
  checkQuota,
  checkRateLimit,
} from '@/lib/agent/rate-limiter';

describe('QUOTA_BY_PLAN — Story 2.9 D48 alignment com Architecture §4.6', () => {
  it('AC15(iii) — free=50 (corrigido de 100)', () => {
    expect(QUOTA_BY_PLAN['free']).toBe(50);
  });

  it('AC15(iii) — pessoal=1500 (corrigido de 500)', () => {
    expect(QUOTA_BY_PLAN['pessoal']).toBe(1500);
  });

  it('AC15(iii) — familia=3000 (corrigido de 2000)', () => {
    expect(QUOTA_BY_PLAN['familia']).toBe(3000);
  });

  it('AC15(iii) — pro=10000 (mantido)', () => {
    expect(QUOTA_BY_PLAN['pro']).toBe(10_000);
  });
});

describe('checkQuota — Story 2.9 D49 hard-stop 110%', () => {
  const TEST_HOUSEHOLD = '00000000-0000-0000-0000-000000000001';
  const FUTURE_PERIOD_END = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();

  it('AC15(i) — familia: bloqueia quando used >= 3300 (110% de 3000)', async () => {
    const db = {
      execute: vi.fn().mockResolvedValue([
        { plan: 'familia', prompts_used: 3300, period_end: FUTURE_PERIOD_END },
      ]),
    };
    await expect(checkQuota(TEST_HOUSEHOLD, db)).rejects.toThrow(QuotaExceededError);
  });

  it('AC15(ii) — familia: passa quando used = 3299 (abaixo de 110%)', async () => {
    const db = {
      execute: vi.fn().mockResolvedValue([
        { plan: 'familia', prompts_used: 3299, period_end: FUTURE_PERIOD_END },
      ]),
    };
    await expect(checkQuota(TEST_HOUSEHOLD, db)).resolves.toBeUndefined();
  });

  it('AC15 — pessoal: bloqueia em 1650 (floor(1500*1.1))', async () => {
    const db = {
      execute: vi.fn().mockResolvedValue([
        { plan: 'pessoal', prompts_used: 1650, period_end: FUTURE_PERIOD_END },
      ]),
    };
    await expect(checkQuota(TEST_HOUSEHOLD, db)).rejects.toThrow(QuotaExceededError);
  });

  it('AC15 — free: bloqueia em 55 (floor(50*1.1))', async () => {
    const db = {
      execute: vi.fn().mockResolvedValue([
        { plan: 'free', prompts_used: 55, period_end: FUTURE_PERIOD_END },
      ]),
    };
    await expect(checkQuota(TEST_HOUSEHOLD, db)).rejects.toThrow(QuotaExceededError);
  });

  it('AC15 — household novo (sem row) → permite', async () => {
    const db = { execute: vi.fn().mockResolvedValue([]) };
    await expect(checkQuota(TEST_HOUSEHOLD, db)).resolves.toBeUndefined();
  });

  it('AC15(iv) — mensagem PT-PT correcta com "Próxima janela em"', async () => {
    const db = {
      execute: vi.fn().mockResolvedValue([
        { plan: 'familia', prompts_used: 3300, period_end: FUTURE_PERIOD_END },
      ]),
    };
    try {
      await checkQuota(TEST_HOUSEHOLD, db);
      expect.fail('should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(QuotaExceededError);
      const qe = err as QuotaExceededError;
      expect(qe.message).toContain('Limite de prompts atingido');
      expect(qe.message).toContain('Próxima janela em');
      expect(qe.message).toContain('min');
      expect(qe.periodEnd).toBeInstanceOf(Date);
    }
  });

  it('AC15 — QuotaExceededError expõe plan, used, limit, periodEnd', async () => {
    const db = {
      execute: vi.fn().mockResolvedValue([
        { plan: 'pro', prompts_used: 11000, period_end: FUTURE_PERIOD_END },
      ]),
    };
    try {
      await checkQuota(TEST_HOUSEHOLD, db);
      expect.fail('should have thrown');
    } catch (err) {
      const qe = err as QuotaExceededError;
      expect(qe.plan).toBe('pro');
      expect(qe.used).toBe(11000);
      expect(qe.limit).toBe(10_000);
      expect(qe.periodEnd).toBeInstanceOf(Date);
    }
  });
});

describe('checkRateLimit — Story 2.6 regression', () => {
  it('AC15 — lança RateLimitError quando count > limit', async () => {
    const db = {
      execute: vi.fn().mockResolvedValue([{ count: RATE_LIMIT_PER_MINUTE + 1 }]),
    };
    await expect(checkRateLimit('hh-1', db)).rejects.toThrow(RateLimitError);
  });

  it('AC15 — passa quando count <= limit', async () => {
    const db = { execute: vi.fn().mockResolvedValue([{ count: 1 }]) };
    await expect(checkRateLimit('hh-1', db)).resolves.toBeUndefined();
  });
});
