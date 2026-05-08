import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { CircuitBreaker } from '@/circuit-breaker';
import { AuthError, MissingApiKeyError, RateLimitError, ServerError } from '@/errors';
import { OpenAIProvider } from '@/providers/openai';

const VALID_INPUT = {
  system: 'Tu és um classificador',
  messages: [{ role: 'user' as const, content: 'classifica isto' }],
  traceId: 'req_test',
  householdId: '550e8400-e29b-41d4-a716-446655440000',
};

interface MockOpenAIClient {
  chat: { completions: { create: ReturnType<typeof vi.fn> } };
}

function makeMockClient(impl: (params: Record<string, unknown>) => Promise<unknown>): MockOpenAIClient {
  return {
    chat: {
      completions: {
        create: vi.fn(impl),
      },
    },
  };
}

describe('OpenAIProvider', () => {
  beforeEach(() => {
    CircuitBreaker.resetAll();
  });

  afterEach(() => {
    delete process.env.OPENAI_API_KEY;
  });

  it('lança MissingApiKeyError sem OPENAI_API_KEY e sem clientOverride', () => {
    delete process.env.OPENAI_API_KEY;
    expect(() => new OpenAIProvider()).toThrow(MissingApiKeyError);
  });

  it('happy-path: mapeia response OpenAI para ProviderCompleteOutput', async () => {
    const client = makeMockClient(async () => ({
      choices: [
        {
          message: { content: 'Olá!', tool_calls: [] },
          finish_reason: 'stop',
        },
      ],
      usage: { prompt_tokens: 10, completion_tokens: 5 },
    }));
    const provider = new OpenAIProvider({ clientOverride: client });
    const result = await provider.complete(VALID_INPUT);

    expect(result.provider).toBe('openai');
    expect(result.model).toBe('gpt-4o-mini');
    expect(result.content).toBe('Olá!');
    expect(result.toolCalls).toEqual([]);
    expect(result.finishReason).toBe('stop');
    expect(result.tokensInput).toBe(10);
    expect(result.tokensOutput).toBe(5);
    expect(result.cacheHit).toBe(false);
  });

  it('cacheHit é SEMPRE false (OpenAI não suporta cache nesta abstracção)', async () => {
    const client = makeMockClient(async () => ({
      choices: [{ message: { content: 'x' }, finish_reason: 'stop' }],
      usage: { prompt_tokens: 10, completion_tokens: 5 },
    }));
    const provider = new OpenAIProvider({ clientOverride: client });
    const result = await provider.complete({ ...VALID_INPUT, cacheControl: 'ephemeral' });
    expect(result.cacheHit).toBe(false);
  });

  it('cacheControl ephemeral é silenciosamente IGNORADO (sem error)', async () => {
    const client = makeMockClient(async () => ({
      choices: [{ message: { content: 'x' }, finish_reason: 'stop' }],
      usage: { prompt_tokens: 10, completion_tokens: 5 },
    }));
    const provider = new OpenAIProvider({ clientOverride: client });
    await expect(provider.complete({ ...VALID_INPUT, cacheControl: 'ephemeral' })).resolves.toBeDefined();
  });

  it('translation tools: input_schema → parameters', async () => {
    let capturedParams: Record<string, unknown> | null = null;
    const client = makeMockClient(async (params) => {
      capturedParams = params;
      return {
        choices: [{ message: { content: 'ok' }, finish_reason: 'stop' }],
        usage: { prompt_tokens: 1, completion_tokens: 1 },
      };
    });
    const provider = new OpenAIProvider({ clientOverride: client });
    await provider.complete({
      ...VALID_INPUT,
      tools: [{ name: 'create_task', description: 'cria', input_schema: { type: 'object' } }],
    });
    const tools = (capturedParams as Record<string, unknown> | null)?.tools as Array<{ type: string; function: { parameters: unknown } }>;
    expect(tools[0]?.type).toBe('function');
    expect(tools[0]?.function.parameters).toEqual({ type: 'object' });
  });

  it('mapeia tool_calls do response (parsing JSON arguments)', async () => {
    const client = makeMockClient(async () => ({
      choices: [
        {
          message: {
            content: null,
            tool_calls: [
              {
                type: 'function',
                function: { name: 'create_task', arguments: '{"title":"Reunião"}' },
              },
            ],
          },
          finish_reason: 'tool_calls',
        },
      ],
      usage: { prompt_tokens: 10, completion_tokens: 5 },
    }));
    const provider = new OpenAIProvider({ clientOverride: client });
    const result = await provider.complete(VALID_INPUT);
    expect(result.finishReason).toBe('tool_use');
    expect(result.toolCalls).toEqual([{ name: 'create_task', input: { title: 'Reunião' } }]);
  });

  it('arguments mal-formados → input vazio (sem throw)', async () => {
    const client = makeMockClient(async () => ({
      choices: [
        {
          message: {
            content: null,
            tool_calls: [
              { type: 'function', function: { name: 'create_task', arguments: 'NOT_JSON{{{' } },
            ],
          },
          finish_reason: 'tool_calls',
        },
      ],
      usage: { prompt_tokens: 5, completion_tokens: 3 },
    }));
    const provider = new OpenAIProvider({ clientOverride: client });
    const result = await provider.complete(VALID_INPUT);
    expect(result.toolCalls[0]).toEqual({ name: 'create_task', input: {} });
  });

  it('mapeia 401 para AuthError', async () => {
    const client = makeMockClient(async () => {
      throw Object.assign(new Error('unauthorized'), { status: 401 });
    });
    const provider = new OpenAIProvider({ clientOverride: client, retryOpts: { maxAttempts: 1 } });
    await expect(provider.complete(VALID_INPUT)).rejects.toBeInstanceOf(AuthError);
  });

  it('mapeia 429 para RateLimitError', async () => {
    const client = makeMockClient(async () => {
      throw Object.assign(new Error('rate limit'), {
        status: 429,
        headers: { 'retry-after': '1' },
      });
    });
    const provider = new OpenAIProvider({ clientOverride: client, retryOpts: { maxAttempts: 1 } });
    await expect(provider.complete(VALID_INPUT)).rejects.toBeInstanceOf(RateLimitError);
  });

  it('mapeia 500 para ServerError', async () => {
    const client = makeMockClient(async () => {
      throw Object.assign(new Error('server error'), { status: 500 });
    });
    const provider = new OpenAIProvider({ clientOverride: client, retryOpts: { maxAttempts: 1 } });
    await expect(provider.complete(VALID_INPUT)).rejects.toBeInstanceOf(ServerError);
  });
});
