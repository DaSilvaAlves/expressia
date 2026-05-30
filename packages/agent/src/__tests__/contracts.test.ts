import { describe, expect, it } from 'vitest';

import {
  CLAUDE_HAIKU_DEFAULT,
  CLAUDE_HAIKU_MODEL_ENUM,
  CLAUDE_SONNET_DEFAULT,
  LLM_MODEL_VALUES,
  LlmModelSchema,
  OPENAI_GPT4O_MINI_DEFAULT,
  ProviderCompleteInputSchema,
  ProviderCompleteOutputSchema,
} from '@/contracts';

describe('Article IV — LLM_MODEL_VALUES alinhamento com schema agent', () => {
  it('LLM_MODEL_VALUES tem exactamente 4 entries (matching enum llm_model)', () => {
    // Source-of-truth: packages/db/src/schema/agent.ts:63-67 (Story 2.12 add claude-haiku-4-5).
    // Ver comentário em contracts.ts. Story 2.10 (benchmark) detectará divergência
    // em runtime via call real ao DB.
    expect(LLM_MODEL_VALUES).toHaveLength(4);
    expect(LLM_MODEL_VALUES).toContain('gpt-4o-mini');
    expect(LLM_MODEL_VALUES).toContain('claude-sonnet-4-5');
    expect(LLM_MODEL_VALUES).toContain('claude-opus-4-7');
    expect(LLM_MODEL_VALUES).toContain('claude-haiku-4-5');
  });
});

describe('LlmModelSchema (Article IV — derived from packages/db enum)', () => {
  it('aceita claude-sonnet-4-5', () => {
    expect(() => LlmModelSchema.parse('claude-sonnet-4-5')).not.toThrow();
  });

  it('aceita gpt-4o-mini', () => {
    expect(() => LlmModelSchema.parse('gpt-4o-mini')).not.toThrow();
  });

  it('aceita claude-opus-4-7', () => {
    expect(() => LlmModelSchema.parse('claude-opus-4-7')).not.toThrow();
  });

  it('aceita claude-haiku-4-5 (Story 2.12 — novo default Executor)', () => {
    expect(() => LlmModelSchema.parse('claude-haiku-4-5')).not.toThrow();
  });

  it('rejeita modelos inventados (Haiku 3.5 continua inválido)', () => {
    // Só o Haiku 4.5 foi adicionado ao enum; 3.5 permanece inválido.
    expect(() => LlmModelSchema.parse('claude-haiku-3.5')).toThrow();
    expect(() => LlmModelSchema.parse('gpt-5')).toThrow();
  });

  it('CLAUDE_SONNET_DEFAULT é "claude-sonnet-4-5" (mantido como override válido)', () => {
    expect(CLAUDE_SONNET_DEFAULT).toBe('claude-sonnet-4-5');
  });

  it('CLAUDE_HAIKU_DEFAULT é o API ID full-form "claude-haiku-4-5-20251001"', () => {
    expect(CLAUDE_HAIKU_DEFAULT).toBe('claude-haiku-4-5-20251001');
  });

  it('CLAUDE_HAIKU_MODEL_ENUM é o short-form "claude-haiku-4-5" (valor do enum)', () => {
    expect(CLAUDE_HAIKU_MODEL_ENUM).toBe('claude-haiku-4-5');
    expect(() => LlmModelSchema.parse(CLAUDE_HAIKU_MODEL_ENUM)).not.toThrow();
  });

  it('OPENAI_GPT4O_MINI_DEFAULT é "gpt-4o-mini"', () => {
    expect(OPENAI_GPT4O_MINI_DEFAULT).toBe('gpt-4o-mini');
  });
});

describe('ProviderCompleteInputSchema', () => {
  const VALID_INPUT = {
    system: 'Tu és um assistente PT-PT',
    messages: [{ role: 'user' as const, content: 'olá' }],
    traceId: 'req_123',
    householdId: '550e8400-e29b-41d4-a716-446655440000',
  };

  it('aceita input mínimo válido', () => {
    expect(() => ProviderCompleteInputSchema.parse(VALID_INPUT)).not.toThrow();
  });

  it('aceita cacheControl: ephemeral', () => {
    const input = { ...VALID_INPUT, cacheControl: 'ephemeral' as const };
    expect(() => ProviderCompleteInputSchema.parse(input)).not.toThrow();
  });

  it('rejeita system vazio', () => {
    expect(() => ProviderCompleteInputSchema.parse({ ...VALID_INPUT, system: '' })).toThrow();
  });

  it('rejeita messages vazias', () => {
    expect(() => ProviderCompleteInputSchema.parse({ ...VALID_INPUT, messages: [] })).toThrow();
  });

  it('rejeita householdId não-uuid', () => {
    expect(() => ProviderCompleteInputSchema.parse({ ...VALID_INPUT, householdId: 'not-uuid' })).toThrow();
  });

  it('aceita tools array', () => {
    const input = {
      ...VALID_INPUT,
      tools: [{ name: 'create_task', description: 'cria tarefa', input_schema: { type: 'object' } }],
    };
    expect(() => ProviderCompleteInputSchema.parse(input)).not.toThrow();
  });
});

describe('ProviderCompleteOutputSchema', () => {
  const VALID_OUTPUT = {
    provider: 'anthropic' as const,
    model: 'claude-sonnet-4-5',
    content: 'olá',
    toolCalls: [],
    finishReason: 'stop' as const,
    tokensInput: 10,
    tokensOutput: 5,
    costEur: 0.0001,
    latencyMs: 450,
    cacheHit: false,
  };

  it('aceita output válido', () => {
    expect(() => ProviderCompleteOutputSchema.parse(VALID_OUTPUT)).not.toThrow();
  });

  it('rejeita tokens negativos', () => {
    expect(() => ProviderCompleteOutputSchema.parse({ ...VALID_OUTPUT, tokensInput: -1 })).toThrow();
  });

  it('rejeita costEur negativo', () => {
    expect(() => ProviderCompleteOutputSchema.parse({ ...VALID_OUTPUT, costEur: -0.001 })).toThrow();
  });

  it('aceita content null (caso só tool_calls)', () => {
    expect(() => ProviderCompleteOutputSchema.parse({ ...VALID_OUTPUT, content: null })).not.toThrow();
  });
});
