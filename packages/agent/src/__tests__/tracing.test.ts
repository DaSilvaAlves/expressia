import { describe, expect, it, vi } from 'vitest';

import { PROVIDER_SPAN_ATTRIBUTE_KEYS, annotateProviderMetrics, withProviderSpan } from '@/tracing';

vi.mock('@meu-jarvis/observability', () => {
  return {
    withSpan: vi.fn(async (name: string, attrs: unknown, fn: (span: unknown) => unknown) => {
      // Mock span: regista as chamadas a setAttribute / setAttributes.
      const setCalls: Array<{ key: string; value: unknown }> = [];
      const mockSpan = {
        setAttribute: vi.fn((key: string, value: unknown) => {
          setCalls.push({ key, value });
        }),
        setAttributes: vi.fn((kv: Record<string, unknown>) => {
          for (const [k, v] of Object.entries(kv)) setCalls.push({ key: k, value: v });
        }),
        end: vi.fn(),
        recordException: vi.fn(),
        setStatus: vi.fn(),
      };
      // Expose tracking for tests
      (mockSpan as unknown as { __setCalls: typeof setCalls }).__setCalls = setCalls;
      const result = await fn(mockSpan);
      // Persist initial attrs from the wrapper
      (result as { __initialAttrs?: unknown }).__initialAttrs = attrs;
      (result as { __span?: unknown }).__span = mockSpan;
      return result;
    }),
  };
});

describe('withProviderSpan', () => {
  it('cria span com initial attrs provider + model', async () => {
    interface Result {
      __initialAttrs?: { extra: Record<string, unknown> };
      __span?: { __setCalls: Array<{ key: string; value: unknown }> };
    }
    const result = (await withProviderSpan('anthropic', 'claude-sonnet-4-5', async (span) => {
      annotateProviderMetrics(span, {
        tokensInput: 100,
        tokensOutput: 50,
        costEur: 0.0042,
        latencyMs: 450,
        cacheHit: true,
        retryCount: 0,
        fallbackUsed: false,
        traceId: 'req_abc',
      });
      return { content: 'ok' } as Result;
    })) as Result;

    expect(result.__initialAttrs?.extra).toEqual({
      'agent.provider': 'anthropic',
      'agent.model': 'claude-sonnet-4-5',
    });

    const setCalls = result.__span?.__setCalls ?? [];
    const keys = setCalls.map((c) => c.key);

    // Todos os keys aplicados estão na whitelist
    for (const key of keys) {
      expect(PROVIDER_SPAN_ATTRIBUTE_KEYS).toContain(key);
    }

    // Sem PII keys
    expect(keys).not.toContain('agent.prompt');
    expect(keys).not.toContain('agent.system');
    expect(keys).not.toContain('agent.messages');
    expect(keys).not.toContain('agent.tools');
    expect(keys).not.toContain('agent.content');
  });

  it('annotateProviderMetrics aplica todos os 8 attributes', async () => {
    interface Result {
      __span?: { __setCalls: Array<{ key: string; value: unknown }> };
    }
    const result = (await withProviderSpan('openai', 'gpt-4o-mini', async (span) => {
      annotateProviderMetrics(span, {
        tokensInput: 50,
        tokensOutput: 20,
        costEur: 0.00005,
        latencyMs: 250,
        cacheHit: false,
        retryCount: 1,
        fallbackUsed: true,
        traceId: 'req_xyz',
      });
      return {} as Result;
    })) as Result;

    const setCalls = result.__span?.__setCalls ?? [];
    const keys = setCalls.map((c) => c.key);

    expect(keys).toContain('agent.tokens_input');
    expect(keys).toContain('agent.tokens_output');
    expect(keys).toContain('agent.cost_eur');
    expect(keys).toContain('agent.latency_ms');
    expect(keys).toContain('agent.cache_hit');
    expect(keys).toContain('agent.retry_count');
    expect(keys).toContain('agent.fallback_used');
    expect(keys).toContain('agent.trace_id');

    const costEntry = setCalls.find((c) => c.key === 'agent.cost_eur');
    expect(costEntry?.value).toBeCloseTo(0.00005, 6);
    const fallbackEntry = setCalls.find((c) => c.key === 'agent.fallback_used');
    expect(fallbackEntry?.value).toBe(true);
  });

  it('PROVIDER_SPAN_ATTRIBUTE_KEYS contém exactamente 10 keys', () => {
    expect(PROVIDER_SPAN_ATTRIBUTE_KEYS.length).toBe(10);
  });
});
