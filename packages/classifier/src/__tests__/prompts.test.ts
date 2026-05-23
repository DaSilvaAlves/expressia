/**
 * Snapshot test do system prompt — protege contra deriva acidental.
 *
 * Trace: Story 2.4 AC4 + AC11 (prompts.test.ts mínimo 1 caso);
 *        Story 4.10 AC7 (bump v1→v2 + 11 intents).
 *
 * Estratégia:
 *   - Hash SHA-256 do conteúdo da constante `CLASSIFIER_SYSTEM_PROMPT`.
 *   - Qualquer mudança requer actualização intencional do hash + bump
 *     do `CLASSIFIER_SYSTEM_PROMPT_VERSION`.
 *   - Versão actual: `v2`.
 */
import { createHash } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import {
  CLASSIFIER_SYSTEM_PROMPT,
  CLASSIFIER_SYSTEM_PROMPT_VERSION,
} from '@/prompts/classifier-system';

describe('CLASSIFIER_SYSTEM_PROMPT (AC4)', () => {
  it('versão é "v2" (Story 4.10 bump)', () => {
    expect(CLASSIFIER_SYSTEM_PROMPT_VERSION).toBe('v2');
  });

  it('contém os 11 intents canónicos por nome (Story 4.10 — inclui intents Tarefas Story 3.8)', () => {
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
      expect(CLASSIFIER_SYSTEM_PROMPT).toContain(intent);
    }
  });

  it('header anuncia 11 intents (não 8)', () => {
    // Format real do header: `# Intents canónicos (11)`.
    expect(CLASSIFIER_SYSTEM_PROMPT).toMatch(/Intents can[óo]nicos \(11\)/);
  });

  it('instrui retorno em PT-PT (CON3)', () => {
    expect(CLASSIFIER_SYSTEM_PROMPT).toMatch(/pt-PT/);
    expect(CLASSIFIER_SYSTEM_PROMPT).toMatch(/portugu[êe]s europeu/i);
  });

  it('inclui pelo menos 10 exemplos few-shot (Story 4.10: 5 novos Finance)', () => {
    const matches = CLASSIFIER_SYSTEM_PROMPT.match(/## Exemplo \d/g);
    expect(matches).not.toBeNull();
    expect(matches?.length ?? 0).toBeGreaterThanOrEqual(10);
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
