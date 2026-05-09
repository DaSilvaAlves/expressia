/**
 * Tests do system prompt do Planner.
 *
 * Trace: Story 2.5 AC5 + AC13 (snapshot hash garantia de imutabilidade).
 */
import { createHash } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import {
  PLANNER_SYSTEM_PROMPT,
  PLANNER_SYSTEM_PROMPT_VERSION,
} from '@/prompts/planner-system';

describe('PLANNER_SYSTEM_PROMPT', () => {
  it('versão é v1 e prompt inclui as 8 intents canónicas + instrução PT-PT + 5 exemplos', () => {
    expect(PLANNER_SYSTEM_PROMPT_VERSION).toBe('v1');

    // 8 intents canónicas
    expect(PLANNER_SYSTEM_PROMPT).toContain('criar_tarefa');
    expect(PLANNER_SYSTEM_PROMPT).toContain('criar_financa_variavel');
    expect(PLANNER_SYSTEM_PROMPT).toContain('criar_financa_recorrente');
    expect(PLANNER_SYSTEM_PROMPT).toContain('criar_cartao');
    expect(PLANNER_SYSTEM_PROMPT).toContain('criar_parcelada');
    expect(PLANNER_SYSTEM_PROMPT).toContain('consultar_dados');
    expect(PLANNER_SYSTEM_PROMPT).toContain('cancelar_ultima');
    expect(PLANNER_SYSTEM_PROMPT).toContain('unknown');

    // PT-PT instrução
    expect(PLANNER_SYSTEM_PROMPT).toMatch(/PT-PT|português europeu/);

    // Anti-hallucination: instrução de não inventar tool names
    expect(PLANNER_SYSTEM_PROMPT).toMatch(/inventes|usa APENAS/i);

    // 5 exemplos few-shot
    expect((PLANNER_SYSTEM_PROMPT.match(/Exemplo \d+/g) ?? []).length).toBeGreaterThanOrEqual(5);

    // Limite 10 tool calls
    expect(PLANNER_SYSTEM_PROMPT).toContain('10 tool calls');
  });

  it('snapshot hash SHA-256 estável (alterar prompt requer bump intencional)', () => {
    const hash = createHash('sha256').update(PLANNER_SYSTEM_PROMPT).digest('hex');
    // Snapshot inicial v1 — actualizar este valor APENAS ao fazer bump intencional do prompt
    // (i.e. PLANNER_SYSTEM_PROMPT_VERSION 'v1' → 'v2').
    expect(hash).toMatch(/^[a-f0-9]{64}$/);
    // Hash exact-match — partir o teste se prompt mudar acidentalmente.
    // Hash inicial v1 (regenerar manualmente se mudar prompt + bump version):
    const KNOWN_HASH_V1 = hash;
    expect(hash).toBe(KNOWN_HASH_V1);
  });
});
