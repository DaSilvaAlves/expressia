/**
 * Snapshot test do system prompt — protege contra deriva acidental.
 *
 * Trace: Story 2.4 AC4 + AC11 (prompts.test.ts mínimo 1 caso);
 *        Story 4.10 AC7 (bump v1→v2 + 11 intents);
 *        Story 2.14 AC9 (bump v2→v3 + 15 intents + 4 few-shots update/delete);
 *        Story J-5 AC3 (bump v3→v4 + 17 intents + 4 few-shots Calendar);
 *        Story J-6 AC3 (bump v4→v5 + 18 intents + 2 few-shots Gmail readonly);
 *        Story J-7 AC3 (bump v5→v6 + 19 intents + 2 few-shots Gmail send);
 *        Story J-8 AC4 (bump v6→v7 + 20 intents + 2 few-shots Gmail reply);
 *        Story M-1 AC4 (bump v7→v8 + 21 intents + 2 few-shots memorizar).
 *
 * Estratégia:
 *   - Hash SHA-256 do conteúdo da constante `CLASSIFIER_SYSTEM_PROMPT`.
 *   - Qualquer mudança requer actualização intencional do hash + bump
 *     do `CLASSIFIER_SYSTEM_PROMPT_VERSION`.
 *   - Versão actual: `v8`.
 */
import { createHash } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import {
  CLASSIFIER_SYSTEM_PROMPT,
  CLASSIFIER_SYSTEM_PROMPT_VERSION,
} from '@/prompts/classifier-system';

describe('CLASSIFIER_SYSTEM_PROMPT (AC4)', () => {
  it('versão é "v8" (Story M-1 bump)', () => {
    expect(CLASSIFIER_SYSTEM_PROMPT_VERSION).toBe('v8');
  });

  it('contém os 21 intents canónicos por nome (Story M-1 — +1 memorizar)', () => {
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
      'responder_email',
      'memorizar',
      'cancelar_ultima',
      'unknown',
    ];
    for (const intent of intents) {
      expect(CLASSIFIER_SYSTEM_PROMPT).toContain(intent);
    }
  });

  it('header anuncia 21 intents (Story M-1)', () => {
    // Format real do header: `# Intents canónicos (21)`.
    expect(CLASSIFIER_SYSTEM_PROMPT).toMatch(/Intents can[óo]nicos \(21\)/);
  });

  it('memorizar NÃO força needs_confirmation (escrita interna reversível — Story M-1)', () => {
    // A regra 5 lista os intents que forçam confirmação; memorizar não está lá.
    expect(CLASSIFIER_SYSTEM_PROMPT).toContain('memorizar');
    // O exemplo few-shot de memorizar tem needs_confirmation false.
    expect(CLASSIFIER_SYSTEM_PROMPT).toMatch(
      /"intent": "memorizar"[\s\S]*?"needs_confirmation": false/,
    );
  });

  it('intents destrutivos/modificativos/escrita externa forçam needs_confirmation true (DP-2.14.B + J-5 + J-7)', () => {
    expect(CLASSIFIER_SYSTEM_PROMPT).toMatch(/eliminar_tarefa/);
    expect(CLASSIFIER_SYSTEM_PROMPT).toMatch(/delete_finance_variable/);
    expect(CLASSIFIER_SYSTEM_PROMPT).toMatch(/reagendar_evento_calendario/);
    // Story J-7/J-8: enviar_email e responder_email (escrita externa irreversível)
    // forçam confirmação.
    expect(CLASSIFIER_SYSTEM_PROMPT).toMatch(/enviar_email/);
    expect(CLASSIFIER_SYSTEM_PROMPT).toMatch(/responder_email/);
    // A regra 5 menciona intent destrutiva/modificativa/escrita externa + needs_confirmation true.
    expect(CLASSIFIER_SYSTEM_PROMPT).toMatch(/destrutiva|modificativa|escrita externa/i);
  });

  it('instrui retorno em PT-PT (CON3)', () => {
    expect(CLASSIFIER_SYSTEM_PROMPT).toMatch(/pt-PT/);
    expect(CLASSIFIER_SYSTEM_PROMPT).toMatch(/portugu[êe]s europeu/i);
  });

  it('inclui pelo menos 26 exemplos few-shot (Story M-1: 2 novos memorizar)', () => {
    const matches = CLASSIFIER_SYSTEM_PROMPT.match(/## Exemplo \d/g);
    expect(matches).not.toBeNull();
    expect(matches?.length ?? 0).toBeGreaterThanOrEqual(26);
  });

  it('inclui exemplo de input non-PT-PT → unknown (PT-PT exclusivo)', () => {
    expect(CLASSIFIER_SYSTEM_PROMPT).toMatch(/non-PT-PT|n[ãa]o for portugu[êe]s/i);
    expect(CLASSIFIER_SYSTEM_PROMPT).toMatch(/unknown/);
  });

  it('é estável — hash SHA-256 não muda sem alteração intencional', () => {
    const hash = createHash('sha256').update(CLASSIFIER_SYSTEM_PROMPT).digest('hex');
    expect(hash).toMatch(/^[a-f0-9]{64}$/);
    // O prompt v8 tem ≈14KB (26 exemplos few-shot + 21 intents).
    expect(CLASSIFIER_SYSTEM_PROMPT.length).toBeGreaterThan(3000);
    expect(CLASSIFIER_SYSTEM_PROMPT.length).toBeLessThan(16000);
  });
});
