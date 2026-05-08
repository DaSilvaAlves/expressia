/**
 * Tests do AnthropicProvider — usa `clientOverride` em vez de `vi.mock` para
 * evitar race conditions em hoisting. Pattern alternativo ao snippet do
 * Dev Notes da story (que usa vi.hoisted) — ambos são válidos; aqui
 * preferimos clientOverride por ser mais explícito.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { CircuitBreaker } from '@/circuit-breaker';
import { AuthError, ContentPolicyError, MissingApiKeyError, RateLimitError, ServerError } from '@/errors';
import { AnthropicProvider } from '@/providers/anthropic';

const VALID_INPUT = {
  system: 'Tu és um assistente',
  messages: [{ role: 'user' as const, content: 'olá' }],
  traceId: 'req_test',
  householdId: '550e8400-e29b-41d4-a716-446655440000',
};

interface MockAnthropicClient {
  messages: { create: ReturnType<typeof vi.fn> };
}

function makeMockClient(impl: (params: Record<string, unknown>) => Promise<unknown>): MockAnthropicClient {
  return {
    messages: {
      create: vi.fn(impl),
    },
  };
}

describe('AnthropicProvider', () => {
  beforeEach(() => {
    CircuitBreaker.resetAll();
  });

  afterEach(() => {
    delete process.env.ANTHROPIC_API_KEY;
  });

  it('lança MissingApiKeyError sem ANTHROPIC_API_KEY e sem clientOverride', () => {
    delete process.env.ANTHROPIC_API_KEY;
    expect(() => new AnthropicProvider()).toThrow(MissingApiKeyError);
  });

  it('happy-path: mapeia response Anthropic para ProviderCompleteOutput', async () => {
    const client = makeMockClient(async () => ({
      content: [{ type: 'text', text: 'Olá!' }],
      usage: { input_tokens: 10, output_tokens: 5, cache_read_input_tokens: 0 },
      stop_reason: 'end_turn',
    }));
    const provider = new AnthropicProvider({ clientOverride: client });
    const result = await provider.complete(VALID_INPUT);

    expect(result.provider).toBe('anthropic');
    expect(result.model).toBe('claude-sonnet-4-5');
    expect(result.content).toBe('Olá!');
    expect(result.toolCalls).toEqual([]);
    expect(result.finishReason).toBe('stop');
    expect(result.tokensInput).toBe(10);
    expect(result.tokensOutput).toBe(5);
    expect(result.cacheHit).toBe(false);
    expect(result.costEur).toBeGreaterThan(0);
    expect(result.latencyMs).toBeGreaterThanOrEqual(0);
  });

  it('cacheHit=true quando cache_read_input_tokens > 0', async () => {
    const client = makeMockClient(async () => ({
      content: [{ type: 'text', text: 'cached' }],
      usage: { input_tokens: 10, output_tokens: 5, cache_read_input_tokens: 100 },
      stop_reason: 'end_turn',
    }));
    const provider = new AnthropicProvider({ clientOverride: client });
    const result = await provider.complete(VALID_INPUT);
    expect(result.cacheHit).toBe(true);
  });

  it('aplica cache_control: ephemeral ao system prompt quando cacheControl=ephemeral', async () => {
    let capturedParams: Record<string, unknown> | null = null;
    const client = makeMockClient(async (params) => {
      capturedParams = params;
      return {
        content: [{ type: 'text', text: 'ok' }],
        usage: { input_tokens: 10, output_tokens: 5 },
        stop_reason: 'end_turn',
      };
    });
    const provider = new AnthropicProvider({ clientOverride: client });
    await provider.complete({ ...VALID_INPUT, cacheControl: 'ephemeral' });
    expect(capturedParams).not.toBeNull();
    const params = capturedParams as unknown as Record<string, unknown>;
    const systemBlocks = params.system as Array<{ cache_control?: unknown }>;
    expect(Array.isArray(systemBlocks)).toBe(true);
    expect(systemBlocks[0]?.cache_control).toEqual({ type: 'ephemeral' });
  });

  it('mapeia tool_use response correctamente', async () => {
    const client = makeMockClient(async () => ({
      content: [
        { type: 'text', text: 'A criar tarefa' },
        { type: 'tool_use', id: 'tool_1', name: 'create_task', input: { title: 'Reunião' } },
      ],
      usage: { input_tokens: 20, output_tokens: 10 },
      stop_reason: 'tool_use',
    }));
    const provider = new AnthropicProvider({ clientOverride: client });
    const result = await provider.complete(VALID_INPUT);
    expect(result.finishReason).toBe('tool_use');
    expect(result.toolCalls).toHaveLength(1);
    expect(result.toolCalls[0]).toEqual({ name: 'create_task', input: { title: 'Reunião' } });
  });

  it('mapeia status 401 para AuthError', async () => {
    const client = makeMockClient(async () => {
      throw Object.assign(new Error('unauthorized'), { status: 401 });
    });
    const provider = new AnthropicProvider({ clientOverride: client, retryOpts: { maxAttempts: 1 } });
    await expect(provider.complete(VALID_INPUT)).rejects.toBeInstanceOf(AuthError);
  });

  it('mapeia status 429 para RateLimitError', async () => {
    const client = makeMockClient(async () => {
      throw Object.assign(new Error('rate limit'), {
        status: 429,
        headers: { 'retry-after': '1' },
      });
    });
    const provider = new AnthropicProvider({ clientOverride: client, retryOpts: { maxAttempts: 1 } });
    await expect(provider.complete(VALID_INPUT)).rejects.toBeInstanceOf(RateLimitError);
  });

  it('mapeia 400 com keyword "policy" para ContentPolicyError', async () => {
    const client = makeMockClient(async () => {
      throw Object.assign(new Error('content policy violation'), { status: 400 });
    });
    const provider = new AnthropicProvider({ clientOverride: client, retryOpts: { maxAttempts: 1 } });
    await expect(provider.complete(VALID_INPUT)).rejects.toBeInstanceOf(ContentPolicyError);
  });

  it('mapeia 503 para ServerError (e não tenta retry quando maxAttempts=1)', async () => {
    const client = makeMockClient(async () => {
      throw Object.assign(new Error('server error'), { status: 503 });
    });
    const fnSpy = client.messages.create as ReturnType<typeof vi.fn>;
    const provider = new AnthropicProvider({ clientOverride: client, retryOpts: { maxAttempts: 1 } });
    await expect(provider.complete(VALID_INPUT)).rejects.toBeInstanceOf(ServerError);
    expect(fnSpy).toHaveBeenCalledOnce();
  });

  it('valida input via Zod — rejeita householdId não-uuid', async () => {
    const client = makeMockClient(async () => ({
      content: [{ type: 'text', text: 'unused' }],
      usage: { input_tokens: 0, output_tokens: 0 },
      stop_reason: 'end_turn',
    }));
    const provider = new AnthropicProvider({ clientOverride: client });
    await expect(provider.complete({ ...VALID_INPUT, householdId: 'not-uuid' })).rejects.toThrow();
  });
});
