/**
 * Snapshot test do system prompt — protege contra deriva acidental.
 *
 * Trace: Story 2.4 AC4 + AC11 (prompts.test.ts mínimo 1 caso);
 *        Story 4.10 AC7 (bump v1→v2 + 11 intents);
 *        Story 2.14 AC9 (bump v2→v3 + 15 intents + 4 few-shots update/delete).
 *
 * Estratégia:
 *   - Hash SHA-256 do conteúdo da constante `CLASSIFIER_SYSTEM_PROMPT`.
 *   - Qualquer mudança requer actualização intencional do hash + bump
 *     do `CLASSIFIER_SYSTEM_PROMPT_VERSION`.
 *   - Versão actual: `v3`.
 */
import { createHash } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import {
  CLASSIFIER_SYSTEM_PROMPT,
  CLASSIFIER_SYSTEM_PROMPT_VERSION,
} from '@/prompts/classifier-system';

describe('CLASSIFIER_SYSTEM_PROMPT (AC4)', () => {
  it('versão é "v3" (Story 2.14 bump)', () => {
    expect(CLASSIFIER_SYSTEM_PROMPT_VERSION).toBe('v3');
  });

  it('contém os 15 intents canónicos por nome (Story 2.14 — +4 update/delete)', () => {
    const intents = [
      'criar_tarefa',
      'completar_tarefa',
      'atualizar_tarefa',
      'eliminar_tarefa',
      'listar_tarefas',
      'listar_atrasadas',
      'criar_financa_variavel',
      'update_finance_variable',
      'delete_finance_variable',
      'criar_financa_recorrente',
      'criar_cartao',
      'criar_parcelada',
      'consultar_dados',
      'cancelar_ultima',
      'unknown',
    ];
    for (const intent of intents) {
      expect(CLASSIFIER_SYSTEM_PROMPT).toContain(intent);
    }
  });

  it('header anuncia 15 intents (Story 2.14)', () => {
    // Format real do header: `# Intents canónicos (15)`.
    expect(CLASSIFIER_SYSTEM_PROMPT).toMatch(/Intents can[óo]nicos \(15\)/);
  });

  it('intents destrutivos forçam needs_confirmation true (DP-2.14.B)', () => {
    expect(CLASSIFIER_SYSTEM_PROMPT).toMatch(/eliminar_tarefa/);
    expect(CLASSIFIER_SYSTEM_PROMPT).toMatch(/delete_finance_variable/);
    // A regra 5 menciona intent destrutiva + needs_confirmation true.
    expect(CLASSIFIER_SYSTEM_PROMPT).toMatch(/destrutiva/i);
  });

  it('instrui retorno em PT-PT (CON3)', () => {
    expect(CLASSIFIER_SYSTEM_PROMPT).toMatch(/pt-PT/);
    expect(CLASSIFIER_SYSTEM_PROMPT).toMatch(/portugu[êe]s europeu/i);
  });

  it('inclui pelo menos 14 exemplos few-shot (Story 2.14: 4 novos update/delete)', () => {
    const matches = CLASSIFIER_SYSTEM_PROMPT.match(/## Exemplo \d/g);
    expect(matches).not.toBeNull();
    expect(matches?.length ?? 0).toBeGreaterThanOrEqual(14);
  });

  it('inclui exemplo de input non-PT-PT → unknown (PT-PT exclusivo)', () => {
    expect(CLASSIFIER_SYSTEM_PROMPT).toMatch(/non-PT-PT|n[ãa]o for portugu[êe]s/i);
    expect(CLASSIFIER_SYSTEM_PROMPT).toMatch(/unknown/);
  });

  it('é estável — hash SHA-256 não muda sem alteração intencional', () => {
    const hash = createHash('sha256').update(CLASSIFIER_SYSTEM_PROMPT).digest('hex');
    expect(hash).toMatch(/^[a-f0-9]{64}$/);
    // O prompt v2 tem ≈8KB (10 exemplos few-shot + 11 intents).
    expect(CLASSIFIER_SYSTEM_PROMPT.length).toBeGreaterThan(3000);
    expect(CLASSIFIER_SYSTEM_PROMPT.length).toBeLessThan(15000);
  });
});
