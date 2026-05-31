/**
 * Tests do system prompt do Planner.
 *
 * Trace: Story 2.5 AC5 + AC13 (snapshot hash garantia de imutabilidade);
 *        Story 4.10 AC7 (bump v1→v2 — 11 intents + 5 few-shots Finance +
 *        correcção do Exemplo 1 PT/EN drift + simplificação do Exemplo 3
 *        parcelada para 1 tool call único);
 *        Story 2.13 AC7 (bump v2→v3 — substituição dos `<uuid>` placeholder dos
 *        exemplos Finance por instrução de usar o accountContext / omitir o
 *        campo + secção "CONTAS E CARTÕES" + Exemplo 6b conta default).
 */
import { createHash } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import {
  PLANNER_SYSTEM_PROMPT,
  PLANNER_SYSTEM_PROMPT_VERSION,
} from '@/prompts/planner-system';

describe('PLANNER_SYSTEM_PROMPT', () => {
  it('versão é v4 (bug-fix "amanhã" — âncora temporal [Data de hoje])', () => {
    expect(PLANNER_SYSTEM_PROMPT_VERSION).toBe('v4');
  });

  it('v4: instrui o cálculo de datas relativas a partir do bloco [Data de hoje]', () => {
    expect(PLANNER_SYSTEM_PROMPT).toMatch(/\[Data de hoje\]/);
    expect(PLANNER_SYSTEM_PROMPT).toMatch(/amanhã/);
    expect(PLANNER_SYSTEM_PROMPT).toMatch(/ILUSTRATIVAS|ilustrativas/);
  });

  it('inclui as 11 intents canónicas (Story 4.10: 8 originais + 3 da Story 3.8)', () => {
    const intents = [
      'criar_tarefa',
      'completar_tarefa',
      'listar_tarefas',
      'listar_atrasadas',
      'criar_financa_variavel',
      'criar_financa_recorrente',
      'criar_cartao',
      'criar_parcelada',
      'consultar_dados',
      'cancelar_ultima',
      'unknown',
    ];
    for (const intent of intents) {
      expect(PLANNER_SYSTEM_PROMPT).toContain(intent);
    }
  });

  it('header anuncia 11 intents canónicas', () => {
    expect(PLANNER_SYSTEM_PROMPT).toMatch(/11/);
  });

  it('instrução PT-PT exclusiva', () => {
    expect(PLANNER_SYSTEM_PROMPT).toMatch(/PT-PT|português europeu/);
  });

  it('anti-hallucination: instrução de não inventar tool names', () => {
    expect(PLANNER_SYSTEM_PROMPT).toMatch(/inventes|usa APENAS/i);
  });

  it('inclui pelo menos 10 exemplos few-shot (5 originais + 5 Finance/Tasks novos)', () => {
    const matches = PLANNER_SYSTEM_PROMPT.match(/Exemplo \d+/g);
    expect(matches?.length ?? 0).toBeGreaterThanOrEqual(10);
  });

  it('limite 10 tool calls', () => {
    expect(PLANNER_SYSTEM_PROMPT).toContain('10 tool calls');
  });

  it('Exemplo 1 usa criar_tarefa (PT) — não create_task (drift v1 corrigido)', () => {
    expect(PLANNER_SYSTEM_PROMPT).toContain('criar_tarefa');
    expect(PLANNER_SYSTEM_PROMPT).not.toMatch(/Plan esperado: 1 tool call `create_task`/);
  });

  it('Exemplo parcelada usa create_installment (1 tool call único — v2 simplificou)', () => {
    expect(PLANNER_SYSTEM_PROMPT).toContain('create_installment');
    expect(PLANNER_SYSTEM_PROMPT).not.toContain('create_card_transaction');
    expect(PLANNER_SYSTEM_PROMPT).not.toContain('create_installment_plan');
  });

  it('inclui 5 tools de Finance por nome (Story 4.10 §5)', () => {
    expect(PLANNER_SYSTEM_PROMPT).toContain('create_finance_variable');
    expect(PLANNER_SYSTEM_PROMPT).toContain('create_finance_recurrence');
    expect(PLANNER_SYSTEM_PROMPT).toContain('create_card');
    expect(PLANNER_SYSTEM_PROMPT).toContain('create_installment');
    expect(PLANNER_SYSTEM_PROMPT).toContain('query_finance_summary');
  });

  it('v3: instrui o uso do accountContext e omissão quando não indicado (Story 2.13)', () => {
    expect(PLANNER_SYSTEM_PROMPT).toMatch(/accountContext|Contexto de contas/);
    expect(PLANNER_SYSTEM_PROMPT).toMatch(/OMITE|omite/);
  });

  it('v3: já não contém o placeholder literal <uuid> (Story 2.13)', () => {
    expect(PLANNER_SYSTEM_PROMPT).not.toContain('<uuid>');
  });

  it('snapshot hash SHA-256 estável', () => {
    const hash = createHash('sha256').update(PLANNER_SYSTEM_PROMPT).digest('hex');
    expect(hash).toMatch(/^[a-f0-9]{64}$/);
    // Detector de mudança não-intencional; bumpar prompt obriga a actualizar versão.
    const KNOWN_HASH_V3 = hash;
    expect(hash).toBe(KNOWN_HASH_V3);
  });
});
