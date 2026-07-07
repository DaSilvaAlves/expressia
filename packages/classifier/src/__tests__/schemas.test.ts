/**
 * Testes dos schemas Zod do classifier.
 *
 * Trace: Story 2.4 AC2 + AC3 + AC5 + AC11 (schemas.test.ts mínimo 6 casos).
 *
 * Sanity-check Article IV [AUTO-DECISION D11 do @dev]: TypeScript cross-package
 * não resolve `@/*` aliases internos do `@meu-jarvis/db` no nosso setup
 * (Bundler moduleResolution sem project references). Em vez de import directo
 * (que falha typecheck), lemos o ficheiro `agent.ts` em runtime via `fs.readFile`
 * e fazemos match regex contra `pgEnum('agent_intent', [...])`. Pattern análogo
 * à Story 2.2 `LLM_MODEL_VALUES_SANITY_CHECK`. O test FAILS se alguém alterar
 * o enum DB sem actualizar `INTENT_VALUES`.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  ALWAYS_CONFIRM_INTENTS,
  CLASSIFIER_CONFIDENCE_THRESHOLD,
  CLASSIFIER_MODEL,
  ClassificationSchema,
  ClassifiedIntentSchema,
  IntentSchema,
  INTENT_VALUES,
  READ_ONLY_INTENTS,
  isReadOnlyIntent,
} from '@/schemas';

const dirname = path.dirname(fileURLToPath(import.meta.url));
const DB_AGENT_SCHEMA_PATH = path.resolve(dirname, '../../../db/src/schema/agent.ts');

function extractAgentIntentEnumFromSource(): string[] {
  const source = readFileSync(DB_AGENT_SCHEMA_PATH, 'utf-8');
  const match = source.match(/agentIntentEnum\s*=\s*pgEnum\(\s*'agent_intent'\s*,\s*\[([^\]]+)\]/);
  if (!match || !match[1]) {
    throw new Error(
      `agentIntentEnum não encontrado em ${DB_AGENT_SCHEMA_PATH} — Article IV sanity-check inválido`,
    );
  }
  return Array.from(match[1].matchAll(/'([a-z_]+)'/g)).map((m) => m[1] as string);
}

describe('IntentSchema (AC2)', () => {
  it('aceita os 23 valores canónicos', () => {
    for (const value of INTENT_VALUES) {
      expect(IntentSchema.safeParse(value).success).toBe(true);
    }
  });

  it('rejeita valores fora dos 23 canónicos (Article IV)', () => {
    expect(IntentSchema.safeParse('inventado').success).toBe(false);
    expect(IntentSchema.safeParse('criar_evento').success).toBe(false);
    expect(IntentSchema.safeParse('').success).toBe(false);
  });

  it('aceita o novo intent de memória explícita (Story M-1)', () => {
    expect(IntentSchema.safeParse('memorizar').success).toBe(true);
  });

  it('memorizar NÃO é read-only (escrita interna — passa pelo limiar de confiança normal)', () => {
    expect(isReadOnlyIntent('memorizar')).toBe(false);
    expect(READ_ONLY_INTENTS.has('memorizar' as never)).toBe(false);
  });

  it('aceita o novo intent de esquecer memória (Story M-4)', () => {
    expect(IntentSchema.safeParse('esquecer').success).toBe(true);
  });

  it('esquecer NÃO é read-only (escrita destrutiva — passa por preview→confirm)', () => {
    expect(isReadOnlyIntent('esquecer')).toBe(false);
    expect(READ_ONLY_INTENTS.has('esquecer' as never)).toBe(false);
  });

  it('aceita o novo intent de captura inferida de memória (Story M-5)', () => {
    expect(IntentSchema.safeParse('sugerir_memoria').success).toBe(true);
  });

  it('sugerir_memoria NÃO é read-only (escrita interna — passa por preview→confirm)', () => {
    expect(isReadOnlyIntent('sugerir_memoria')).toBe(false);
    expect(READ_ONLY_INTENTS.has('sugerir_memoria' as never)).toBe(false);
  });

  it('[PO-MUST-FIX-1] sugerir_memoria está em ALWAYS_CONFIRM_INTENTS (força confirmação SEMPRE — R5)', () => {
    // A "lista de intents que forçam confirmação" existe agora em CÓDIGO, não só
    // como texto do prompt (que é descartado por applyConfidenceDerivation).
    expect(ALWAYS_CONFIRM_INTENTS.has('sugerir_memoria')).toBe(true);
    // Todos os valores são intents canónicos válidos (Article IV).
    for (const intent of ALWAYS_CONFIRM_INTENTS) {
      expect(IntentSchema.safeParse(intent).success).toBe(true);
    }
    // `memorizar` (escrita EXPLÍCITA, pedido deliberado) NÃO força confirmação —
    // segue o limiar normal de 0,70, ao contrário de `sugerir_memoria` (inferência).
    expect(ALWAYS_CONFIRM_INTENTS.has('memorizar' as never)).toBe(false);
  });

  it('aceita os 2 novos intents de Calendar (Story J-5)', () => {
    expect(IntentSchema.safeParse('criar_evento_calendario').success).toBe(true);
    expect(IntentSchema.safeParse('reagendar_evento_calendario').success).toBe(true);
  });

  it('aceita o novo intent de Gmail readonly (Story J-6)', () => {
    expect(IntentSchema.safeParse('consultar_emails').success).toBe(true);
  });

  it('aceita o novo intent de Gmail send (Story J-7)', () => {
    expect(IntentSchema.safeParse('enviar_email').success).toBe(true);
  });

  it('aceita o novo intent de Gmail reply (Story J-8)', () => {
    expect(IntentSchema.safeParse('responder_email').success).toBe(true);
  });

  it('enviar_email NÃO é read-only (escrita externa — passa por preview→confirm)', () => {
    expect(isReadOnlyIntent('enviar_email')).toBe(false);
    expect(READ_ONLY_INTENTS.has('enviar_email' as never)).toBe(false);
  });

  it('responder_email NÃO é read-only (escrita externa — passa por preview→confirm)', () => {
    expect(isReadOnlyIntent('responder_email')).toBe(false);
    expect(READ_ONLY_INTENTS.has('responder_email' as never)).toBe(false);
  });

  it('READ_ONLY_INTENTS contém só as 4 intents de leitura (Story J-6 follow-up)', () => {
    expect([...READ_ONLY_INTENTS].sort()).toEqual(
      ['consultar_dados', 'consultar_emails', 'listar_atrasadas', 'listar_tarefas'].sort(),
    );
    // Todos os valores são intents canónicos válidos (Article IV).
    for (const intent of READ_ONLY_INTENTS) {
      expect(IntentSchema.safeParse(intent).success).toBe(true);
    }
  });

  it('isReadOnlyIntent — leituras true, escritas/unknown false', () => {
    expect(isReadOnlyIntent('consultar_emails')).toBe(true);
    expect(isReadOnlyIntent('listar_tarefas')).toBe(true);
    expect(isReadOnlyIntent('consultar_dados')).toBe(true);
    // Escritas e `unknown` NÃO são read-only (não devem saltar preview→confirm).
    expect(isReadOnlyIntent('criar_tarefa')).toBe(false);
    expect(isReadOnlyIntent('eliminar_tarefa')).toBe(false);
    expect(isReadOnlyIntent('criar_evento_calendario')).toBe(false);
    expect(isReadOnlyIntent('unknown')).toBe(false);
    expect(isReadOnlyIntent('inventado')).toBe(false);
  });

  it('SANITY-CHECK Article IV — INTENT_VALUES bate EXACTAMENTE com enum DB agent_intent (lido directo do source)', () => {
    const dbValues = extractAgentIntentEnumFromSource().sort();
    const classifierValues = [...INTENT_VALUES].sort();
    expect(classifierValues).toEqual(dbValues);
    // 8 baseline (Story 2.1) + 3 Story 3.8 tools cérebro Tarefas (migration 0012)
    // + 4 Story 2.14 tools UPDATE/DELETE Tarefas e Finanças (migration 0026)
    // + 2 Story J-5 tools Calendar escrita (migration 0030)
    // + 1 Story J-6 tool Gmail readonly (migration 0031)
    // + 1 Story J-7 tool Gmail send (migration 0032)
    // + 1 Story J-8 tool Gmail reply (migration 0033)
    // + 1 Story M-1 tool `memorizar` (migration 0034)
    // + 1 Story M-4 tool `esquecer` (migration 0035)
    // + 1 Story M-5 tool `sugerir_memoria` (migration 0036).
    expect(dbValues.length).toBe(23);
  });
});

describe('ClassifiedIntentSchema (AC3)', () => {
  it('aceita confidence em [0, 1]', () => {
    expect(
      ClassifiedIntentSchema.safeParse({ intent: 'criar_tarefa', confidence: 0, raw_span: 'x' })
        .success,
    ).toBe(true);
    expect(
      ClassifiedIntentSchema.safeParse({ intent: 'criar_tarefa', confidence: 1, raw_span: 'x' })
        .success,
    ).toBe(true);
    expect(
      ClassifiedIntentSchema.safeParse({ intent: 'criar_tarefa', confidence: 0.5, raw_span: 'x' })
        .success,
    ).toBe(true);
  });

  it('rejeita confidence fora de [0, 1]', () => {
    expect(
      ClassifiedIntentSchema.safeParse({ intent: 'criar_tarefa', confidence: -0.1, raw_span: 'x' })
        .success,
    ).toBe(false);
    expect(
      ClassifiedIntentSchema.safeParse({ intent: 'criar_tarefa', confidence: 1.5, raw_span: 'x' })
        .success,
    ).toBe(false);
  });
});

describe('ClassificationSchema (AC3)', () => {
  const baseIntent = { intent: 'criar_tarefa' as const, confidence: 0.9, raw_span: 'x' };

  it('aceita intents.length em [1, 5]', () => {
    for (const n of [1, 2, 3, 4, 5]) {
      const intents = Array.from({ length: n }, () => ({ ...baseIntent }));
      const result = ClassificationSchema.safeParse({
        intents,
        language: 'pt-PT',
        needs_confirmation: false,
        overall_confidence: 0.9,
      });
      expect(result.success).toBe(true);
    }
  });

  it('rejeita intents.length === 0 (min 1)', () => {
    const result = ClassificationSchema.safeParse({
      intents: [],
      language: 'pt-PT',
      needs_confirmation: false,
      overall_confidence: 0.9,
    });
    expect(result.success).toBe(false);
  });

  it('rejeita intents.length > 5 (AUTO-DECISION D8 anti-hallucination guardrail)', () => {
    const intents = Array.from({ length: 6 }, () => ({ ...baseIntent }));
    const result = ClassificationSchema.safeParse({
      intents,
      language: 'pt-PT',
      needs_confirmation: false,
      overall_confidence: 0.9,
    });
    expect(result.success).toBe(false);
  });

  it('rejeita language != "pt-PT" (CON3)', () => {
    const result = ClassificationSchema.safeParse({
      intents: [baseIntent],
      language: 'pt-BR',
      needs_confirmation: false,
      overall_confidence: 0.9,
    });
    expect(result.success).toBe(false);
  });
});

describe('Constantes (AC5)', () => {
  it('CLASSIFIER_MODEL é "gpt-4o-mini"', () => {
    expect(CLASSIFIER_MODEL).toBe('gpt-4o-mini');
  });

  it('CLASSIFIER_CONFIDENCE_THRESHOLD é 0.7 (FR4)', () => {
    expect(CLASSIFIER_CONFIDENCE_THRESHOLD).toBe(0.7);
  });
});
