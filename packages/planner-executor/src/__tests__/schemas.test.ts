/**
 * Tests dos schemas Zod.
 *
 * Trace: Story 2.5 AC2 + AC13 (≥5 casos cobrindo schemas).
 */
import { describe, expect, it } from 'vitest';

import {
  ExecutorInputSchema,
  PlanResultSchema,
  PlanToolCallSchema,
  PlannerInputSchema,
} from '@/schemas';
import { TOOL_TO_INTENT_MAP, resolveIntentFromToolName } from '@/schemas';

const VALID_UUID = '11111111-1111-1111-1111-111111111111';

const MIN_CLASSIFICATION = {
  intents: [{ intent: 'criar_tarefa' as const, confidence: 0.9, raw_span: 'reunião amanhã' }],
  language: 'pt-PT' as const,
  needs_confirmation: false,
  overall_confidence: 0.9,
};

describe('PlanToolCallSchema', () => {
  it('valida tool call com intent IntentSchema válida', () => {
    const result = PlanToolCallSchema.safeParse({
      toolName: 'create_task',
      input: { title: 'Reunião' },
      intent: 'criar_tarefa',
    });
    expect(result.success).toBe(true);
  });
});

describe('PlanResultSchema', () => {
  it('aceita toolCalls vazio (degradação graceful unknown)', () => {
    const result = PlanResultSchema.safeParse({
      toolCalls: [],
      planReasoning: null,
      latencyMs: 0,
      tokensInput: 0,
      tokensOutput: 0,
      costEur: 0,
      cacheHit: false,
    });
    expect(result.success).toBe(true);
  });

  it('rejeita toolCalls com >10 itens (D5 anti-hallucination guardrail)', () => {
    const tooManyToolCalls = Array.from({ length: 11 }, (_, i) => ({
      toolName: `tool_${i}`,
      input: {},
      intent: 'unknown' as const,
    }));
    const result = PlanResultSchema.safeParse({
      toolCalls: tooManyToolCalls,
      planReasoning: null,
      latencyMs: 0,
      tokensInput: 0,
      tokensOutput: 0,
      costEur: 0,
      cacheHit: false,
    });
    expect(result.success).toBe(false);
  });

  it('rejeita tokens negativos', () => {
    const result = PlanResultSchema.safeParse({
      toolCalls: [],
      planReasoning: null,
      latencyMs: 0,
      tokensInput: -1,
      tokensOutput: 0,
      costEur: 0,
      cacheHit: false,
    });
    expect(result.success).toBe(false);
  });
});

describe('PlannerInputSchema', () => {
  it('rejeita householdId não-UUID', () => {
    const result = PlannerInputSchema.safeParse({
      classification: MIN_CLASSIFICATION,
      householdId: 'not-a-uuid',
      userId: VALID_UUID,
      traceId: 'trace-1',
      runId: VALID_UUID,
    });
    expect(result.success).toBe(false);
  });
});

describe('ExecutorInputSchema', () => {
  it('aceita plan vazio + UUIDs válidos', () => {
    const result = ExecutorInputSchema.safeParse({
      plan: {
        toolCalls: [],
        planReasoning: null,
        latencyMs: 0,
        tokensInput: 0,
        tokensOutput: 0,
        costEur: 0,
        cacheHit: false,
      },
      householdId: VALID_UUID,
      userId: VALID_UUID,
      traceId: 'trace-1',
      runId: VALID_UUID,
    });
    expect(result.success).toBe(true);
  });
});

describe('TOOL_TO_INTENT_MAP + resolveIntentFromToolName (D6)', () => {
  it('resolve tool name conhecido para intent correcta', () => {
    expect(resolveIntentFromToolName('create_task')).toBe('criar_tarefa');
    expect(resolveIntentFromToolName('query_tasks')).toBe('consultar_dados');
  });

  it('fallback unknown para tool name não mapeada', () => {
    expect(resolveIntentFromToolName('foo_bar_unknown')).toBe('unknown');
  });

  it('mapa cobre as 15 intents canónicas (D6 contract — 8 baseline + 3 Story 3.8 + 4 Story 2.14)', () => {
    const intents = new Set(Object.values(TOOL_TO_INTENT_MAP));
    expect(intents).toContain('criar_tarefa');
    expect(intents).toContain('criar_financa_variavel');
    expect(intents).toContain('criar_financa_recorrente');
    expect(intents).toContain('criar_cartao');
    expect(intents).toContain('criar_parcelada');
    expect(intents).toContain('consultar_dados');
    expect(intents).toContain('cancelar_ultima');
    expect(intents).toContain('unknown');
    // Story 3.8 — tools cérebro do domínio Tarefas
    expect(intents).toContain('completar_tarefa');
    expect(intents).toContain('listar_tarefas');
    expect(intents).toContain('listar_atrasadas');
    // Story 2.14 — tools UPDATE/DELETE Tarefas e Finanças
    expect(intents).toContain('atualizar_tarefa');
    expect(intents).toContain('eliminar_tarefa');
    expect(intents).toContain('update_finance_variable');
    expect(intents).toContain('delete_finance_variable');
  });
});
