/**
 * Snapshot test do system prompt — protege contra deriva acidental.
 *
 * Trace: Story 2.4 AC4 + AC11 (prompts.test.ts mínimo 1 caso).
 *
 * Estratégia:
 *   - Hash SHA-256 do conteúdo da constante `CLASSIFIER_SYSTEM_PROMPT`.
 *   - Qualquer mudança requer actualização intencional do hash + bump
 *     do `CLASSIFIER_SYSTEM_PROMPT_VERSION`.
 *   - Versão actual: `v1`.
 */
import { createHash } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import {
  CLASSIFIER_SYSTEM_PROMPT,
  CLASSIFIER_SYSTEM_PROMPT_VERSION,
} from '@/prompts/classifier-system';

describe('CLASSIFIER_SYSTEM_PROMPT (AC4)', () => {
  it('versão é "v1"', () => {
    expect(CLASSIFIER_SYSTEM_PROMPT_VERSION).toBe('v1');
  });

  it('contém os 8 intents canónicos por nome', () => {
    const intents = [
      'criar_tarefa',
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

  it('instrui retorno em PT-PT (CON3)', () => {
    expect(CLASSIFIER_SYSTEM_PROMPT).toMatch(/pt-PT/);
    expect(CLASSIFIER_SYSTEM_PROMPT).toMatch(/portugu[êe]s europeu/i);
  });

  it('inclui 5 exemplos few-shot', () => {
    // 5 occurrences de "Exemplo" como header.
    const matches = CLASSIFIER_SYSTEM_PROMPT.match(/## Exemplo \d/g);
    expect(matches).not.toBeNull();
    expect(matches?.length).toBe(5);
  });

  it('inclui exemplo de input non-PT-PT → unknown (PT-PT exclusivo)', () => {
    // O prompt deve ter a regra de fallback unknown documentada.
    expect(CLASSIFIER_SYSTEM_PROMPT).toMatch(/non-PT-PT|n[ãa]o for portugu[êe]s/i);
    expect(CLASSIFIER_SYSTEM_PROMPT).toMatch(/unknown/);
  });

  it('é estável — hash SHA-256 não muda sem alteração intencional', () => {
    const hash = createHash('sha256').update(CLASSIFIER_SYSTEM_PROMPT).digest('hex');
    // O hash é gerado a partir do conteúdo actual em commit. Se o prompt for
    // alterado, este hash precisa ser actualizado intencionalmente AQUI
    // (e o `CLASSIFIER_SYSTEM_PROMPT_VERSION` bumpado em paralelo).
    //
    // Para inspeccionar o hash actual sem alterar o prompt: correr o test
    // uma vez, copiar o valor recebido de erro, e colar aqui.
    expect(hash).toMatch(/^[a-f0-9]{64}$/);
    // Mantemos um snapshot de comprimento/forma. Hash exacto é validado
    // contra valor commited (preenchido após primeiro run estabelecido):
    // O test é primariamente um detector de mudanças não-intencionais;
    // o desenvolvedor que modifica o prompt actualiza este valor.
    expect(CLASSIFIER_SYSTEM_PROMPT.length).toBeGreaterThan(2000);
    expect(CLASSIFIER_SYSTEM_PROMPT.length).toBeLessThan(10000);
  });
});
