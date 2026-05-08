import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { calculateAnthropicCost, calculateOpenAICost, usdToEur } from '@/pricing';

describe('usdToEur', () => {
  const ORIGINAL = process.env.AGENT_USD_TO_EUR_RATE;

  beforeEach(() => {
    delete process.env.AGENT_USD_TO_EUR_RATE;
  });

  afterEach(() => {
    if (ORIGINAL === undefined) delete process.env.AGENT_USD_TO_EUR_RATE;
    else process.env.AGENT_USD_TO_EUR_RATE = ORIGINAL;
  });

  it('default rate 0.92 quando env vazia', () => {
    expect(usdToEur(1)).toBeCloseTo(0.92, 5);
  });

  it('rate via env', () => {
    process.env.AGENT_USD_TO_EUR_RATE = '0.95';
    expect(usdToEur(1)).toBeCloseTo(0.95, 5);
  });

  it('fallback para default em rate inválido', () => {
    process.env.AGENT_USD_TO_EUR_RATE = 'not-a-number';
    expect(usdToEur(1)).toBeCloseTo(0.92, 5);
  });

  it('fallback para default em rate negativo', () => {
    process.env.AGENT_USD_TO_EUR_RATE = '-0.5';
    expect(usdToEur(1)).toBeCloseTo(0.92, 5);
  });
});

describe('calculateAnthropicCost', () => {
  it('cost típico Sonnet — 1k input regular + 100 output', () => {
    const cost = calculateAnthropicCost(1000, 0, 0, 100);
    // 1000 × 3 / 1M = 0.003 USD input + 100 × 15 / 1M = 0.0015 USD output = 0.0045 USD total
    expect(cost.costUsd).toBeCloseTo(0.0045, 6);
    expect(cost.costEur).toBeCloseTo(0.0045 * 0.92, 6);
  });

  it('cache read poupa custo', () => {
    const noCache = calculateAnthropicCost(1000, 0, 0, 100);
    const withCache = calculateAnthropicCost(0, 1000, 0, 100); // mesmos tokens, mas via cache read
    expect(withCache.costUsd).toBeLessThan(noCache.costUsd);
    // 1000 × 0.30 / 1M = 0.0003 + 100 × 15 / 1M = 0.0015 = 0.0018 total
    expect(withCache.costUsd).toBeCloseTo(0.0018, 6);
  });

  it('cache write é 1.25× mais caro que input', () => {
    const cost = calculateAnthropicCost(0, 0, 1000, 0);
    expect(cost.costUsd).toBeCloseTo(0.00375, 6);
  });
});

describe('calculateOpenAICost', () => {
  it('cost típico GPT-4o-mini — 1k input + 100 output', () => {
    const cost = calculateOpenAICost(1000, 100);
    // 1000 × 0.15 / 1M = 0.00015 + 100 × 0.6 / 1M = 0.00006 = 0.00021 total
    expect(cost.costUsd).toBeCloseTo(0.00021, 6);
    expect(cost.costEur).toBeCloseTo(0.00021 * 0.92, 6);
  });

  it('zero tokens → zero cost', () => {
    const cost = calculateOpenAICost(0, 0);
    expect(cost.costUsd).toBe(0);
    expect(cost.costEur).toBe(0);
  });
});
