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

describe('calculateAnthropicCost — Sonnet', () => {
  it('cost típico Sonnet — 1k input regular + 100 output', () => {
    const cost = calculateAnthropicCost('claude-sonnet-4-5', 1000, 0, 0, 100);
    // 1000 × 3 / 1M = 0.003 USD input + 100 × 15 / 1M = 0.0015 USD output = 0.0045 USD total
    expect(cost.costUsd).toBeCloseTo(0.0045, 6);
    expect(cost.costEur).toBeCloseTo(0.0045 * 0.92, 6);
  });

  it('cache read poupa custo (Sonnet)', () => {
    const noCache = calculateAnthropicCost('claude-sonnet-4-5', 1000, 0, 0, 100);
    const withCache = calculateAnthropicCost('claude-sonnet-4-5', 0, 1000, 0, 100); // mesmos tokens, via cache read
    expect(withCache.costUsd).toBeLessThan(noCache.costUsd);
    // 1000 × 0.30 / 1M = 0.0003 + 100 × 15 / 1M = 0.0015 = 0.0018 total
    expect(withCache.costUsd).toBeCloseTo(0.0018, 6);
  });

  it('cache write Sonnet é 1.25× mais caro que input', () => {
    const cost = calculateAnthropicCost('claude-sonnet-4-5', 0, 0, 1000, 0);
    expect(cost.costUsd).toBeCloseTo(0.00375, 6);
  });
});

describe('calculateAnthropicCost — Haiku 4.5 (Story 2.12)', () => {
  it('cost típico Haiku — 1k input regular + 100 output', () => {
    const cost = calculateAnthropicCost('claude-haiku-4-5', 1000, 0, 0, 100);
    // 1000 × 1 / 1M = 0.001 input + 100 × 5 / 1M = 0.0005 output = 0.0015 total
    expect(cost.costUsd).toBeCloseTo(0.0015, 6);
    expect(cost.costEur).toBeCloseTo(0.0015 * 0.92, 6);
  });

  it('cache read poupa custo (Haiku)', () => {
    const noCache = calculateAnthropicCost('claude-haiku-4-5', 1000, 0, 0, 100);
    const withCache = calculateAnthropicCost('claude-haiku-4-5', 0, 1000, 0, 100);
    expect(withCache.costUsd).toBeLessThan(noCache.costUsd);
    // 1000 × 0.10 / 1M = 0.0001 + 100 × 5 / 1M = 0.0005 = 0.0006 total
    expect(withCache.costUsd).toBeCloseTo(0.0006, 6);
  });

  it('cache write Haiku é 1.25× input ($1.25/MTok)', () => {
    const cost = calculateAnthropicCost('claude-haiku-4-5', 0, 0, 1000, 0);
    expect(cost.costUsd).toBeCloseTo(0.00125, 6);
  });

  it('custo Haiku < custo Sonnet para os mesmos tokens (prova dispatch por modelo)', () => {
    const haiku = calculateAnthropicCost('claude-haiku-4-5', 1000, 0, 0, 100);
    const sonnet = calculateAnthropicCost('claude-sonnet-4-5', 1000, 0, 0, 100);
    expect(haiku.costUsd).toBeLessThan(sonnet.costUsd);
    // Haiku é exactamente 1/3 do input e 1/3 do output de Sonnet → 0.0015 vs 0.0045
    expect(haiku.costUsd / sonnet.costUsd).toBeCloseTo(1 / 3, 6);
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
