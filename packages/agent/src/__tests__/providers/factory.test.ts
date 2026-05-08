import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { CircuitBreaker } from '@/circuit-breaker';
import { MissingApiKeyError, ServerError } from '@/errors';
import { AnthropicProvider, OpenAIProvider, getProvider, isFallbackOpenAIEnabled, resetProviderCache } from '@/providers';

describe('getProvider factory', () => {
  beforeEach(() => {
    CircuitBreaker.resetAll();
    resetProviderCache();
    process.env.ANTHROPIC_API_KEY = 'sk-ant-test';
    process.env.OPENAI_API_KEY = 'sk-openai-test';
    delete process.env.AGENT_FALLBACK_OPENAI_ENABLED;
  });

  afterEach(() => {
    delete process.env.ANTHROPIC_API_KEY;
    delete process.env.OPENAI_API_KEY;
    delete process.env.AGENT_FALLBACK_OPENAI_ENABLED;
    CircuitBreaker.resetAll();
    resetProviderCache();
  });

  it('default → AnthropicProvider', () => {
    const p = getProvider();
    expect(p).toBeInstanceOf(AnthropicProvider);
    expect(p.id).toBe('anthropic');
  });

  it('preferredProvider="openai" → OpenAIProvider (caso Story 2.4 Classifier)', () => {
    const p = getProvider({ preferredProvider: 'openai' });
    expect(p).toBeInstanceOf(OpenAIProvider);
    expect(p.id).toBe('openai');
  });

  it('preferredProvider="anthropic" explícito → AnthropicProvider', () => {
    const p = getProvider({ preferredProvider: 'anthropic' });
    expect(p).toBeInstanceOf(AnthropicProvider);
  });

  it('flag fallback enabled + Anthropic CB closed → ainda Anthropic', () => {
    process.env.AGENT_FALLBACK_OPENAI_ENABLED = 'true';
    const p = getProvider();
    expect(p).toBeInstanceOf(AnthropicProvider);
  });

  it('flag fallback enabled + Anthropic CB OPEN → OpenAI fallback', async () => {
    process.env.AGENT_FALLBACK_OPENAI_ENABLED = 'true';
    // Força CB Anthropic open
    const cb = CircuitBreaker.getInstance('anthropic');
    const failingFn = async () => {
      throw new ServerError('anthropic', 503);
    };
    for (let i = 0; i < 5; i++) {
      await expect(cb.execute(failingFn)).rejects.toThrow();
    }
    expect(cb.isOpen()).toBe(true);

    const p = getProvider();
    expect(p).toBeInstanceOf(OpenAIProvider);
  });

  it('flag fallback DISABLED + CB open → ainda Anthropic (não fallback)', async () => {
    delete process.env.AGENT_FALLBACK_OPENAI_ENABLED;
    const cb = CircuitBreaker.getInstance('anthropic');
    const failingFn = async () => {
      throw new ServerError('anthropic', 503);
    };
    for (let i = 0; i < 5; i++) {
      await expect(cb.execute(failingFn)).rejects.toThrow();
    }
    expect(cb.isOpen()).toBe(true);
    const p = getProvider();
    expect(p).toBeInstanceOf(AnthropicProvider);
  });

  it('lança MissingApiKeyError se ANTHROPIC_API_KEY ausente', () => {
    delete process.env.ANTHROPIC_API_KEY;
    expect(() => getProvider()).toThrow(MissingApiKeyError);
  });

  it('lança MissingApiKeyError se OPENAI_API_KEY ausente e preferredProvider=openai', () => {
    delete process.env.OPENAI_API_KEY;
    expect(() => getProvider({ preferredProvider: 'openai' })).toThrow(MissingApiKeyError);
  });

  it('cache: chamadas consecutivas retornam mesma instância', () => {
    const a = getProvider();
    const b = getProvider();
    expect(a).toBe(b);
  });

  it('isFallbackOpenAIEnabled reflete env var', () => {
    delete process.env.AGENT_FALLBACK_OPENAI_ENABLED;
    expect(isFallbackOpenAIEnabled()).toBe(false);
    process.env.AGENT_FALLBACK_OPENAI_ENABLED = 'true';
    expect(isFallbackOpenAIEnabled()).toBe(true);
    process.env.AGENT_FALLBACK_OPENAI_ENABLED = 'false';
    expect(isFallbackOpenAIEnabled()).toBe(false);
  });
});
