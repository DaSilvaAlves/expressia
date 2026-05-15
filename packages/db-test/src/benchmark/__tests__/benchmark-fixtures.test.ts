/**
 * Tests AC11(i-iv) — Validação estrutural dos 200 fixtures PT-PT.
 *
 * Trace: Story 2.10 AC11 + AC4 + NFR12 (PII redaction).
 */
import { describe, expect, it } from 'vitest';

import {
  BENCHMARK_FIXTURES,
  DISTRIBUTION_TOLERANCE,
  EXPECTED_DISTRIBUTION,
  EXPECTED_TOTAL,
} from '../prompts-pt-pt';
import { INTENT_VALUES } from '@meu-jarvis/classifier';

describe('BenchmarkFixtures — AC11(i-iv)', () => {
  // ───────────────────────────────────────────────────────────────────────
  // AC11(i) — todos os 200 prompts têm expected_intents não-vazio
  // ───────────────────────────────────────────────────────────────────────
  it('(i) todos os 200 prompts têm expected_intents não-vazio', () => {
    expect(BENCHMARK_FIXTURES.length).toBe(EXPECTED_TOTAL);
    for (const fixture of BENCHMARK_FIXTURES) {
      expect(fixture.expected_intents.length).toBeGreaterThan(0);
      expect(typeof fixture.prompt).toBe('string');
      expect(fixture.prompt.length).toBeGreaterThan(0);
    }
  });

  // ───────────────────────────────────────────────────────────────────────
  // AC11(ii) — distribuição por intent respeita AC4 (±5 por categoria)
  // ───────────────────────────────────────────────────────────────────────
  it('(ii) distribuição de intents respeita AC4 (±5 por categoria)', () => {
    const counts: Record<string, number> = {
      criar_tarefa: 0,
      criar_financa_variavel: 0,
      criar_financa_recorrente: 0,
      criar_parcelada: 0,
      criar_cartao: 0,
      consultar_dados: 0,
      cancelar_ultima: 0,
      multi_intent: 0,
      unknown: 0,
    };
    for (const fixture of BENCHMARK_FIXTURES) {
      if (fixture.expected_intents.length > 1) {
        counts.multi_intent = (counts.multi_intent ?? 0) + 1;
      } else {
        const intent = fixture.expected_intents[0];
        if (intent !== undefined) {
          counts[intent] = (counts[intent] ?? 0) + 1;
        }
      }
    }
    for (const [key, expected] of Object.entries(EXPECTED_DISTRIBUTION)) {
      const actual = counts[key] ?? 0;
      expect(actual, `categoria ${key}: actual ${String(actual)} vs expected ${String(expected)}`).toBeGreaterThanOrEqual(
        expected - DISTRIBUTION_TOLERANCE,
      );
      expect(actual, `categoria ${key}: actual ${String(actual)} vs expected ${String(expected)}`).toBeLessThanOrEqual(
        expected + DISTRIBUTION_TOLERANCE,
      );
    }
  });

  // ───────────────────────────────────────────────────────────────────────
  // AC11(iii) — nenhum prompt contém PII real (regex NIF/IBAN/email)
  // ───────────────────────────────────────────────────────────────────────
  it('(iii) nenhum prompt contém PII real (heurística simples)', () => {
    // Regex defensivas (false positives aceitáveis — flagam para revisão humana):
    //   - NIF PT: 9 dígitos consecutivos NÃO sendo o dummy '999999990'
    //   - IBAN PT: PT50 seguido de >0 dígitos NÃO sendo todo zeros (PT50...0000 é o dummy)
    //   - Email: padrão @\w+\.\w+
    const NIF_REGEX = /\b\d{9}\b/g;
    const IBAN_REGEX = /\bPT50\d{17,21}\b/g;
    const EMAIL_REGEX = /\b[\w.-]+@[\w.-]+\.[A-Za-z]{2,}\b/g;

    const NIF_DUMMY = '999999990';
    const IBAN_DUMMY_PREFIX = 'PT50';

    for (const fixture of BENCHMARK_FIXTURES) {
      const nifMatches = fixture.prompt.match(NIF_REGEX) ?? [];
      for (const match of nifMatches) {
        expect(match, `prompt #${String(fixture.id)} contém possível NIF real`).toBe(NIF_DUMMY);
      }
      const ibanMatches = fixture.prompt.match(IBAN_REGEX) ?? [];
      for (const match of ibanMatches) {
        // dummy: PT50 + apenas zeros
        expect(
          match.startsWith(IBAN_DUMMY_PREFIX) && /^PT500+$/.test(match),
          `prompt #${String(fixture.id)} contém possível IBAN real: ${match}`,
        ).toBe(true);
      }
      const emailMatches = fixture.prompt.match(EMAIL_REGEX) ?? [];
      expect(emailMatches.length, `prompt #${String(fixture.id)} contém email`).toBe(0);
    }
  });

  // ───────────────────────────────────────────────────────────────────────
  // AC11(iv) — todos os expected_intents são valores válidos de IntentSchema
  // ───────────────────────────────────────────────────────────────────────
  it('(iv) todos os expected_intents são valores válidos de IntentSchema', () => {
    const validIntents = new Set<string>(INTENT_VALUES);
    for (const fixture of BENCHMARK_FIXTURES) {
      for (const intent of fixture.expected_intents) {
        expect(
          validIntents.has(intent),
          `fixture #${String(fixture.id)}: intent '${intent}' não está em INTENT_VALUES`,
        ).toBe(true);
      }
    }
  });

  // ───────────────────────────────────────────────────────────────────────
  // Sanity adicional — IDs sequenciais 1..200
  // ───────────────────────────────────────────────────────────────────────
  it('IDs são sequenciais 1..200 (sanity check)', () => {
    for (let i = 0; i < BENCHMARK_FIXTURES.length; i += 1) {
      const fixture = BENCHMARK_FIXTURES[i];
      expect(fixture?.id).toBe(i + 1);
    }
  });

  // ───────────────────────────────────────────────────────────────────────
  // Sanity — confidence_min está em [0,1]
  // ───────────────────────────────────────────────────────────────────────
  it('expected_confidence_min está sempre em [0, 1]', () => {
    for (const fixture of BENCHMARK_FIXTURES) {
      expect(fixture.expected_confidence_min).toBeGreaterThanOrEqual(0);
      expect(fixture.expected_confidence_min).toBeLessThanOrEqual(1);
    }
  });
});
