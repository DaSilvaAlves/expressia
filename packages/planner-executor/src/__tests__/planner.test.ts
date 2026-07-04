/**
 * Tests do Planner.
 *
 * Trace: Story 2.5 AC4 + AC5 + AC9 + AC11 + AC12 + AC13 (≥14 cenários).
 *
 * Cobertura:
 *   - Happy path 1/2/3 tool calls
 *   - Classification puramente unknown → early-return sem LLM
 *   - Sonnet alucina tool name → PlannerToolNotFoundError
 *   - Sonnet retorna [] mas intents != [unknown] → PlannerEmptyPlanError
 *   - Provider erro RateLimit → PlannerLLMError retryable
 *   - Provider erro Timeout → PlannerLLMError
 *   - Output schema fail → PlannerOutputError + retry 1× temperature=0
 *   - cache_hit propagado
 *   - cost_eur propagado
 *   - Payload tem cache_control via cacheControl=ephemeral
 */
import { describe, expect, it } from 'vitest';

import { RateLimitError, ServerError, TimeoutError } from '@meu-jarvis/agent';

import {
  PlannerEmptyPlanError,
  PlannerLLMError,
  PlannerOutputError,
  PlannerToolNotFoundError,
  PlannerValidationError,
} from '@/errors';
import { Planner } from '@/planner';
import type { PlannerInput } from '@/schemas';
import {
  buildEmptyResponse,
  buildSdkError,
  buildToolUseResponse,
  createMockAnthropicClient,
} from '@/__fixtures__/mock-anthropic-client';
import { createMockRegistry } from '@/__fixtures__/mock-tool-registry';

const VALID_UUID_1 = '11111111-1111-1111-1111-111111111111';
const VALID_UUID_2 = '22222222-2222-2222-2222-222222222222';
const VALID_UUID_3 = '33333333-3333-3333-3333-333333333333';

function buildInput(overrides: Partial<PlannerInput> = {}): PlannerInput {
  return {
    classification: {
      intents: [{ intent: 'criar_tarefa', confidence: 0.92, raw_span: 'reunião amanhã' }],
      language: 'pt-PT',
      needs_confirmation: false,
      overall_confidence: 0.92,
    },
    householdId: VALID_UUID_1,
    userId: VALID_UUID_2,
    traceId: 'trace-test-001',
    runId: VALID_UUID_3,
    ...overrides,
  };
}

describe('Planner.plan() — happy path', () => {
  it('1 tool call (criar_tarefa) — propaga toolCalls + cache_hit + cost', async () => {
    const client = createMockAnthropicClient(() =>
      buildToolUseResponse(
        [{ name: 'create_task', input: { title: 'Reunião' } }],
        { cacheReadTokens: 450, inputTokens: 100, outputTokens: 30 },
      ),
    );
    const planner = new Planner({ client, registry: createMockRegistry() });
    const result = await planner.plan(buildInput());

    expect(result.toolCalls).toHaveLength(1);
    expect(result.toolCalls[0]?.toolName).toBe('create_task');
    expect(result.toolCalls[0]?.intent).toBe('criar_tarefa');
    expect(result.cacheHit).toBe(true);
    expect(result.tokensInput).toBeGreaterThan(0);
    expect(result.costEur).toBeGreaterThanOrEqual(0);
  });

  it('2 tool calls (multi-intent simples)', async () => {
    const client = createMockAnthropicClient(() =>
      buildToolUseResponse(
        [
          { name: 'create_task', input: { title: 'Reunião' } },
          { name: 'create_finance_variable', input: { description: 'Supermercado', amountEur: 78.7 } },
        ],
      ),
    );
    const planner = new Planner({ client, registry: createMockRegistry() });
    const result = await planner.plan(
      buildInput({
        classification: {
          intents: [
            { intent: 'criar_tarefa', confidence: 0.9, raw_span: 'reunião amanhã' },
            { intent: 'criar_financa_variavel', confidence: 0.91, raw_span: 'paguei €78,70' },
          ],
          language: 'pt-PT',
          needs_confirmation: false,
          overall_confidence: 0.9,
        },
      }),
    );

    expect(result.toolCalls).toHaveLength(2);
    expect(result.toolCalls.map((tc) => tc.intent)).toEqual(['criar_tarefa', 'criar_financa_variavel']);
  });

  it('3 tool calls (cenário complexo) sem cache hit', async () => {
    const client = createMockAnthropicClient(() =>
      buildToolUseResponse(
        [
          { name: 'create_task', input: { title: 'A' } },
          { name: 'create_task', input: { title: 'B' } },
          { name: 'query_tasks', input: { status: 'pending' } },
        ],
        { cacheReadTokens: 0, inputTokens: 200, outputTokens: 80 },
      ),
    );
    const planner = new Planner({ client, registry: createMockRegistry() });
    const result = await planner.plan(buildInput());

    expect(result.toolCalls).toHaveLength(3);
    expect(result.cacheHit).toBe(false);
  });
});

describe('Planner.plan() — classification unknown early-return', () => {
  it('classification puramente unknown não invoca LLM', async () => {
    let calls = 0;
    const client = createMockAnthropicClient(() => {
      calls += 1;
      return buildEmptyResponse();
    });
    const planner = new Planner({ client, registry: createMockRegistry() });
    const result = await planner.plan(
      buildInput({
        classification: {
          intents: [{ intent: 'unknown', confidence: 1.0, raw_span: '...' }],
          language: 'pt-PT',
          needs_confirmation: false,
          overall_confidence: 1.0,
        },
      }),
    );

    expect(calls).toBe(0); // LLM NÃO foi chamado
    expect(result.toolCalls).toHaveLength(0);
    expect(result.tokensInput).toBe(0);
    expect(result.costEur).toBe(0);
    expect(result.cacheHit).toBe(false);
  });
});

describe('Planner.plan() — input validation', () => {
  it('input com householdId não-UUID lança PlannerValidationError', async () => {
    const client = createMockAnthropicClient(() => buildEmptyResponse());
    const planner = new Planner({ client, registry: createMockRegistry() });
    await expect(
      planner.plan({
        ...buildInput(),
        householdId: 'not-a-uuid',
      }),
    ).rejects.toBeInstanceOf(PlannerValidationError);
  });
});

describe('Planner.plan() — Sonnet hallucination', () => {
  it('tool name fora do registry lança PlannerToolNotFoundError', async () => {
    const client = createMockAnthropicClient(() =>
      buildToolUseResponse([{ name: 'tool_que_nao_existe', input: {} }]),
    );
    const planner = new Planner({ client, registry: createMockRegistry() });
    await expect(planner.plan(buildInput())).rejects.toBeInstanceOf(PlannerToolNotFoundError);
  });
});

describe('Planner.plan() — empty plan degenerado', () => {
  it('Sonnet retorna [] mas intents != [unknown] lança PlannerEmptyPlanError', async () => {
    const client = createMockAnthropicClient(() => buildEmptyResponse('Não consigo construir o plano.'));
    const planner = new Planner({ client, registry: createMockRegistry() });
    await expect(planner.plan(buildInput())).rejects.toBeInstanceOf(PlannerEmptyPlanError);
  });
});

describe('Planner.plan() — provider errors', () => {
  it('RateLimitError do SDK Anthropic mapeia para PlannerLLMError retryable', async () => {
    // Sem retry-after header — withRetry usa backoff exponencial padrão (200ms × 2^n + jitter)
    // Mas após 3 attempts esgota e propaga RateLimitError → PlannerLLMError.
    const client = createMockAnthropicClient(() =>
      buildSdkError({ status: 429, message: 'rate limited' }),
    );
    const planner = new Planner({ client, registry: createMockRegistry() });
    try {
      await planner.plan(buildInput());
      expect.fail('deveria ter lançado erro');
    } catch (err) {
      expect(err).toBeInstanceOf(PlannerLLMError);
      expect((err as PlannerLLMError).retryable).toBe(true);
      expect((err as PlannerLLMError).cause).toBeInstanceOf(RateLimitError);
    }
  }, 10_000); // 10s timeout — withRetry pode levar ~1s com backoff exponencial 3 attempts

  it('Timeout do SDK mapeia para PlannerLLMError', async () => {
    const client = createMockAnthropicClient(() =>
      buildSdkError({ name: 'AbortError', message: 'timeout' }),
    );
    const planner = new Planner({ client, registry: createMockRegistry() });
    try {
      await planner.plan(buildInput());
      expect.fail('deveria ter lançado erro');
    } catch (err) {
      expect(err).toBeInstanceOf(PlannerLLMError);
      expect((err as PlannerLLMError).cause).toBeInstanceOf(TimeoutError);
    }
  });

  it('ServerError 500 mapeia para PlannerLLMError retryable (com retry esgotado pelo provider)', async () => {
    const client = createMockAnthropicClient(() =>
      buildSdkError({ status: 500, message: 'internal server error' }),
    );
    const planner = new Planner({ client, registry: createMockRegistry() });
    try {
      await planner.plan(buildInput());
      expect.fail('deveria ter lançado erro');
    } catch (err) {
      expect(err).toBeInstanceOf(PlannerLLMError);
      expect((err as PlannerLLMError).cause).toBeInstanceOf(ServerError);
    }
  });
});

describe('Planner.plan() — payload structure', () => {
  it('payload contém system + tools + cacheControl ephemeral por default (D11)', async () => {
    let capturedParams: Record<string, unknown> | undefined;
    const client = createMockAnthropicClient((params) => {
      capturedParams = params;
      return buildToolUseResponse([{ name: 'create_task', input: { title: 'A' } }]);
    });
    const planner = new Planner({ client, registry: createMockRegistry() });
    await planner.plan(buildInput());

    expect(capturedParams).toBeDefined();
    expect(capturedParams).toHaveProperty('system');
    expect(capturedParams).toHaveProperty('tools');
    expect(capturedParams).toHaveProperty('messages');

    // System é array com cache_control:ephemeral quando cacheControl='ephemeral'
    const system = capturedParams?.system;
    expect(Array.isArray(system)).toBe(true);
    if (Array.isArray(system)) {
      expect(system[0]).toHaveProperty('cache_control');
    }

    // Tools array tem 3 mock tools
    const tools = capturedParams?.tools;
    expect(Array.isArray(tools)).toBe(true);
    expect((tools as unknown[]).length).toBe(3);
  });

  it('accountContext (Story 2.13) é injectado no PREFIXO da user message — nunca no system/tools', async () => {
    let capturedParams: Record<string, unknown> | undefined;
    const client = createMockAnthropicClient((params) => {
      capturedParams = params;
      return buildToolUseResponse([{ name: 'create_finance_variable', input: { amountCents: 1870 } }]);
    });
    const planner = new Planner({ client, registry: createMockRegistry() });
    await planner.plan(
      buildInput({
        classification: {
          intents: [
            { intent: 'criar_financa_variavel', confidence: 0.95, raw_span: 'paguei no pingo doce' },
          ],
          language: 'pt-PT',
          needs_confirmation: false,
          overall_confidence: 0.95,
        },
        accountContext: {
          // Nome distintivo que NÃO aparece no system prompt estático (evita
          // colisão com os few-shots que mencionam "Millennium"/"Dinheiro").
          accounts: [{ id: VALID_UUID_1, name: 'ContaTesteXYZ', type: 'dinheiro' }],
          cards: [{ id: VALID_UUID_2, name: 'CartaoTesteXYZ' }],
        },
      }),
    );

    const messages = capturedParams?.messages as Array<{ role: string; content: string }>;
    const userContent = messages[0]?.content ?? '';
    // accountContext no prefixo da user message
    expect(userContent).toContain('Contexto de contas do household');
    expect(userContent).toContain('ContaTesteXYZ');
    expect(userContent).toContain('CartaoTesteXYZ');
    // NUNCA no system nem nos tools — os nomes de conta não devem lá aparecer
    const systemStr = JSON.stringify(capturedParams?.system ?? '');
    const toolsStr = JSON.stringify(capturedParams?.tools ?? '');
    expect(systemStr).not.toContain('ContaTesteXYZ');
    expect(toolsStr).not.toContain('CartaoTesteXYZ');
  });

  it('emailReplyContext (Story J-8) é injectado no PREFIXO da user message — nunca no system/tools', async () => {
    let capturedParams: Record<string, unknown> | undefined;
    const client = createMockAnthropicClient((params) => {
      capturedParams = params;
      return buildToolUseResponse([{ name: 'query_tasks', input: {} }]);
    });
    const planner = new Planner({ client, registry: createMockRegistry() });
    await planner.plan(
      buildInput({
        classification: {
          intents: [
            { intent: 'responder_email', confidence: 0.92, raw_span: 'responde ao Pedro' },
          ],
          language: 'pt-PT',
          needs_confirmation: true,
          overall_confidence: 0.92,
        },
        emailReplyContext: [
          {
            threadId: 'threadXYZ',
            messageId: '<msgidXYZ@mail>',
            from: 'Pedro <pedroXYZ@example.com>',
            fromEmail: 'pedroXYZ@example.com',
            subject: 'AssuntoReplyXYZ',
            receivedAt: 'Wed, 02 Jul 2026 10:00:00 +0100',
          },
        ],
      }),
    );

    const messages = capturedParams?.messages as Array<{ role: string; content: string }>;
    const userContent = messages[0]?.content ?? '';
    // Shortlist no prefixo da user message.
    expect(userContent).toContain('candidatos para responder');
    expect(userContent).toContain('threadXYZ');
    expect(userContent).toContain('pedroXYZ@example.com');
    // NUNCA no system nem nos tools (preserva prompt caching).
    const systemStr = JSON.stringify(capturedParams?.system ?? '');
    const toolsStr = JSON.stringify(capturedParams?.tools ?? '');
    expect(systemStr).not.toContain('threadXYZ');
    expect(toolsStr).not.toContain('threadXYZ');
  });

  it('emailReplyContext ausente → sem prefixo de resposta na user message', async () => {
    let capturedParams: Record<string, unknown> | undefined;
    const client = createMockAnthropicClient((params) => {
      capturedParams = params;
      return buildToolUseResponse([{ name: 'create_task', input: { title: 'A' } }]);
    });
    const planner = new Planner({ client, registry: createMockRegistry() });
    await planner.plan(buildInput());

    const messages = capturedParams?.messages as Array<{ role: string; content: string }>;
    expect(messages[0]?.content ?? '').not.toContain('candidatos para responder');
  });

  it('accountContext ausente → sem prefixo de contexto na user message', async () => {
    let capturedParams: Record<string, unknown> | undefined;
    const client = createMockAnthropicClient((params) => {
      capturedParams = params;
      return buildToolUseResponse([{ name: 'create_task', input: { title: 'A' } }]);
    });
    const planner = new Planner({ client, registry: createMockRegistry() });
    await planner.plan(buildInput());

    const messages = capturedParams?.messages as Array<{ role: string; content: string }>;
    expect(messages[0]?.content ?? '').not.toContain('Contexto de contas do household');
  });

  it('accountContext com ambas as listas vazias → sem prefixo (utilizador novo pré-backfill)', async () => {
    let capturedParams: Record<string, unknown> | undefined;
    const client = createMockAnthropicClient((params) => {
      capturedParams = params;
      return buildToolUseResponse([{ name: 'create_task', input: { title: 'A' } }]);
    });
    const planner = new Planner({ client, registry: createMockRegistry() });
    await planner.plan(buildInput({ accountContext: { accounts: [], cards: [] } }));

    const messages = capturedParams?.messages as Array<{ role: string; content: string }>;
    expect(messages[0]?.content ?? '').not.toContain('Contexto de contas do household');
  });

  it('bug-fix "amanhã": injecta [Data de hoje] + amanhã calculado no prefixo da user message', async () => {
    let capturedParams: Record<string, unknown> | undefined;
    const client = createMockAnthropicClient((params) => {
      capturedParams = params;
      return buildToolUseResponse([{ name: 'create_task', input: { title: 'Reunião' } }]);
    });
    const planner = new Planner({ client, registry: createMockRegistry() });
    // currentDate determinística (domingo) — sem isto o helper derivaria a data
    // corrente no fuso Europe/Lisbon (não-determinístico em teste).
    await planner.plan(buildInput({ currentDate: '2026-05-31' }));

    const messages = capturedParams?.messages as Array<{ role: string; content: string }>;
    const userContent = messages[0]?.content ?? '';
    expect(userContent).toContain('[Data de hoje]');
    expect(userContent).toContain('2026-05-31'); // hoje
    expect(userContent).toContain('2026-06-01'); // amanhã calculado (rollover de mês)
    expect(userContent).toContain('domingo'); // dia da semana PT-PT
    // A âncora de data vem ANTES da classificação (é o contexto temporal base)
    expect(userContent.indexOf('[Data de hoje]')).toBeLessThan(
      userContent.indexOf('Classificação validada'),
    );
  });

  it('cacheControl=null desliga cache (system é string raw)', async () => {
    let capturedParams: Record<string, unknown> | undefined;
    const client = createMockAnthropicClient((params) => {
      capturedParams = params;
      return buildToolUseResponse([{ name: 'create_task', input: { title: 'A' } }]);
    });
    const planner = new Planner({ client, registry: createMockRegistry(), cacheControl: null });
    await planner.plan(buildInput());

    expect(typeof capturedParams?.system).toBe('string');
  });
});

describe('Planner.plan() — retry temperature=0 para PlannerOutputError', () => {
  it('output Schema fail no primeiro attempt, sucesso após retry temperature=0', async () => {
    let attemptCount = 0;
    const client = createMockAnthropicClient((params) => {
      attemptCount += 1;
      // Primeiro: response com 11 tool calls (excede max 10) → PlanResultSchema falha
      if (attemptCount === 1) {
        return buildToolUseResponse(
          Array.from({ length: 11 }, (_, i) => ({ name: 'create_task', input: { title: `T${i}` } })),
        );
      }
      // Segundo (retry temperature=0): response válida com 1 tool call
      expect(params.temperature).toBe(0);
      return buildToolUseResponse([{ name: 'create_task', input: { title: 'OK' } }]);
    });
    const planner = new Planner({ client, registry: createMockRegistry() });
    const result = await planner.plan(buildInput());

    expect(attemptCount).toBe(2);
    expect(result.toolCalls).toHaveLength(1);
  });
});
