import { describe, expect, it } from 'vitest';

import { REDACTED_FIELD_NAMES, redactProviderPayload, redactToolNames } from '@/redaction';

describe('redactProviderPayload', () => {
  it('remove campos system, messages, tools', () => {
    const input = {
      system: 'Tu és um assistente PT-PT',
      messages: [{ role: 'user', content: 'paguei 78,70 supermercado' }],
      tools: [{ name: 'create_task', description: 'x', input_schema: {} }],
      model: 'claude-sonnet-4-5',
      maxTokens: 4096,
    };
    const safe = redactProviderPayload(input as unknown as Record<string, unknown>);
    expect(safe.system).toBeUndefined();
    expect(safe.messages).toBeUndefined();
    expect(safe.tools).toBeUndefined();
    expect(safe.model).toBe('claude-sonnet-4-5');
    expect(safe.maxTokens).toBe(4096);
  });

  it('é shallow copy — não modifica o input', () => {
    const input = { system: 'x', messages: [], model: 'gpt-4o-mini' };
    const safe = redactProviderPayload(input as unknown as Record<string, unknown>);
    expect(input.system).toBe('x'); // input intacto
    expect(safe).not.toBe(input); // novo object
  });

  it('REDACTED_FIELD_NAMES é a fonte de verdade', () => {
    expect(REDACTED_FIELD_NAMES).toContain('system');
    expect(REDACTED_FIELD_NAMES).toContain('messages');
    expect(REDACTED_FIELD_NAMES).toContain('tools');
  });
});

describe('redactToolNames', () => {
  it('extrai nomes de tools formato Anthropic', () => {
    const tools = [
      { name: 'create_task', description: 'x', input_schema: { foo: 'bar' } },
      { name: 'query_tasks', description: 'y', input_schema: {} },
    ];
    expect(redactToolNames(tools)).toEqual(['create_task', 'query_tasks']);
  });

  it('extrai nomes de tools formato OpenAI', () => {
    const tools = [
      { type: 'function', function: { name: 'create_task' } },
      { type: 'function', function: { name: 'query_tasks' } },
    ];
    expect(redactToolNames(tools)).toEqual(['create_task', 'query_tasks']);
  });

  it('returns empty array se não-array', () => {
    expect(redactToolNames(null)).toEqual([]);
    expect(redactToolNames(undefined)).toEqual([]);
    expect(redactToolNames('not array')).toEqual([]);
  });
});
