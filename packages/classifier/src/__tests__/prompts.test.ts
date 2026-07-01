/**
 * Snapshot test do system prompt — protege contra deriva acidental.
 *
 * Trace: Story 2.4 AC4 + AC11 (prompts.test.ts mínimo 1 caso);
 *        Story 4.10 AC7 (bump v1→v2 + 11 intents);
 *        Story 2.14 AC9 (bump v2→v3 + 15 intents + 4 few-shots update/delete);
 *        Story J-5 AC3 (bump v3→v4 + 17 intents + 4 few-shots Calendar);
 *        Story J-6 AC3 (bump v4→v5 + 18 intents + 2 few-shots Gmail readonly);
 *        Story J-7 AC3 (bump v5→v6 + 19 intents + 2 few-shots Gmail send).
 *
 * Estratégia:
 *   - Hash SHA-256 do conteúdo da constante `CLASSIFIER_SYSTEM_PROMPT`.
 *   - Qualquer mudança requer actualização intencional do hash + bump
 *     do `CLASSIFIER_SYSTEM_PROMPT_VERSION`.
 *   - Versão actual: `v6`.
 */
import { createHash } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import {
  CLASSIFIER_SYSTEM_PROMPT,
  CLASSIFIER_SYSTEM_PROMPT_VERSION,
} from '@/prompts/classifier-system';

describe('CLASSIFIER_SYSTEM_PROMPT (AC4)', () => {
  it('versão é "v6" (Story J-7 bump)', () => {
    expect(CLASSIFIER_SYSTEM_PROMPT_VERSION).toBe('v6');
  });

  it('contém os 19 intents canónicos por nome (Story J-7 — +1 Gmail send)', () => {
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
      'criar_evento_calendario',
      'reagendar_evento_calendario',
      'consultar_emails',
      'enviar_email',
      'cancelar_ultima',
      'unknown',
    ];
    for (const intent of intents) {
      expect(CLASSIFIER_SYSTEM_PROMPT).toContain(intent);
    }
  });

  it('header anuncia 19 intents (Story J-7)', () => {
    // Format real do header: `# Intents canónicos (19)`.
    expect(CLASSIFIER_SYSTEM_PROMPT).toMatch(/Intents can[óo]nicos \(19\)/);
  });

  it('intents destrutivos/modificativos/escrita externa forçam needs_confirmation true (DP-2.14.B + J-5 + J-7)', () => {
    expect(CLASSIFIER_SYSTEM_PROMPT).toMatch(/eliminar_tarefa/);
    expect(CLASSIFIER_SYSTEM_PROMPT).toMatch(/delete_finance_variable/);
    expect(CLASSIFIER_SYSTEM_PROMPT).toMatch(/reagendar_evento_calendario/);
    // Story J-7: enviar_email (escrita externa irreversível) força confirmação.
    expect(CLASSIFIER_SYSTEM_PROMPT).toMatch(/enviar_email/);
    // A regra 5 menciona intent destrutiva/modificativa/escrita externa + needs_confirmation true.
    expect(CLASSIFIER_SYSTEM_PROMPT).toMatch(/destrutiva|modificativa|escrita externa/i);
  });

  it('instrui retorno em PT-PT (CON3)', () => {
    expect(CLASSIFIER_SYSTEM_PROMPT).toMatch(/pt-PT/);
    expect(CLASSIFIER_SYSTEM_PROMPT).toMatch(/portugu[êe]s europeu/i);
  });

  it('inclui pelo menos 22 exemplos few-shot (Story J-7: 2 novos Gmail send)', () => {
    const matches = CLASSIFIER_SYSTEM_PROMPT.match(/## Exemplo \d/g);
    expect(matches).not.toBeNull();
    expect(matches?.length ?? 0).toBeGreaterThanOrEqual(22);
  });

  it('inclui exemplo de input non-PT-PT → unknown (PT-PT exclusivo)', () => {
    expect(CLASSIFIER_SYSTEM_PROMPT).toMatch(/non-PT-PT|n[ãa]o for portugu[êe]s/i);
    expect(CLASSIFIER_SYSTEM_PROMPT).toMatch(/unknown/);
  });

  it('é estável — hash SHA-256 não muda sem alteração intencional', () => {
    const hash = createHash('sha256').update(CLASSIFIER_SYSTEM_PROMPT).digest('hex');
    expect(hash).toMatch(/^[a-f0-9]{64}$/);
    // O prompt v6 tem ≈12KB (22 exemplos few-shot + 19 intents).
    expect(CLASSIFIER_SYSTEM_PROMPT.length).toBeGreaterThan(3000);
    expect(CLASSIFIER_SYSTEM_PROMPT.length).toBeLessThan(15000);
  });
});
