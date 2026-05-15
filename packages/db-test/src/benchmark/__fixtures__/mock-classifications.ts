/**
 * Respostas mock determinísticas para o `Classifier` em modo benchmark mockable.
 *
 * Trace: Story 2.10 AC5 + AC11 (modo mock CI-safe sem LLM real).
 *
 * Estratégia: cada prompt em `BENCHMARK_FIXTURES` é mapeado para um
 * `ClassificationResult` que reproduz `expected_intents` com confidences
 * determinísticas. Isto permite testar:
 *   - Cálculo de `correct = expected_intents ⊆ actual_intents`
 *   - Cálculo de `accuracy_pct` (mock: tipicamente 100% porque o mock devolve
 *     o esperado — útil como sanity test do runner)
 *   - Comportamento `needs_confirmation` quando `expected_confidence_min < 0.70`
 *   - Cálculo de p50/p95 (mock: latência sintética determinística)
 *
 * Em CI: `RUN_BENCHMARK_REAL=false` activa este modo. Em prod: `RUN_BENCHMARK_REAL=true`
 * usa o `Classifier` real com `OpenAIProvider`.
 */
import type { ClassificationResult } from '@meu-jarvis/classifier';

import type { BenchmarkFixture } from '../prompts-pt-pt';

/**
 * Latência sintética padrão para o mock (ms). Valores realistas (~< 2s para
 * classifier, conforme Architecture §4.2). Suficientemente baixos para não
 * disparar o threshold p95 < 6000ms do runner.
 */
export const MOCK_DEFAULT_LATENCY_MS = 850;

/**
 * Tokens sintéticos típicos do classifier (Architecture §4.2: ~150 in / 50 out).
 */
export const MOCK_DEFAULT_TOKENS_INPUT = 150;
export const MOCK_DEFAULT_TOKENS_OUTPUT = 50;

/**
 * Custo sintético em EUR (correspondente a ~150in/50out GPT-4o-mini).
 * Pricing oficial GPT-4o-mini ~ $0.000150/1K input + $0.000600/1K output.
 * Conversão USD→EUR ~0.92. Cálculo: (150*0.00015 + 50*0.0006) / 1000 * 0.92
 * ≈ 0.0000228 EUR/prompt. Multiplica por ~200 prompts ≈ 0.00456 EUR total.
 */
export const MOCK_DEFAULT_COST_EUR = 0.0000228;

/**
 * Modo de "falha mock" — força o runner a devolver `correct: false` para
 * uma percentagem dos prompts, para validar testes que asseguram exit-code
 * quando `accuracy_pct < 90`.
 */
export interface MockFailureInjection {
  /** Percentagem de prompts a "falhar" — devolve intent `unknown` em vez do esperado. */
  readonly failurePct: number;
  /** Seed para reproducibilidade (default 42). */
  readonly seed?: number;
}

/**
 * Constrói o `ClassificationResult` esperado para uma fixture.
 *
 * Cada `expected_intent` ganha `confidence = expected_confidence_min` (lower
 * bound — garantia mínima). `raw_span` é uma fatia inicial do prompt (sub-string
 * literal — NFR12 garante que `raw_span` é só sub-string, não cleartext novo).
 *
 * `needs_confirmation = expected_confidence_min < 0.70` (FR4 threshold).
 */
export function buildExpectedClassification(fixture: BenchmarkFixture): ClassificationResult {
  const baseSpan = fixture.prompt.slice(0, Math.min(40, fixture.prompt.length));
  return {
    intents: fixture.expected_intents.map((intent) => ({
      intent,
      confidence: fixture.expected_confidence_min,
      raw_span: baseSpan,
    })),
    language: 'pt-PT',
    needs_confirmation: fixture.expected_confidence_min < 0.7,
    overall_confidence: fixture.expected_confidence_min,
  };
}

/**
 * Constrói o `ClassificationResult` "falhado" — devolve `[{intent: 'unknown'}]`
 * para que o runner registe `correct: false`. Usado em injecção de falhas
 * controlada para testar o threshold de accuracy.
 */
export function buildFailedClassification(fixture: BenchmarkFixture): ClassificationResult {
  const baseSpan = fixture.prompt.slice(0, Math.min(40, fixture.prompt.length));
  return {
    intents: [
      {
        intent: 'unknown',
        confidence: 0.5,
        raw_span: baseSpan,
      },
    ],
    language: 'pt-PT',
    needs_confirmation: true,
    overall_confidence: 0.5,
  };
}

/**
 * Gerador determinístico (Mulberry32) para decidir quais fixtures "falham" no
 * modo de injecção de falhas. Determinístico para reproducibilidade entre runs
 * de tests.
 */
function mulberry32(seedRaw: number): () => number {
  let seed = seedRaw >>> 0;
  return function next(): number {
    seed = (seed + 0x6d2b79f5) >>> 0;
    let t = seed;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Decide para cada fixture se ela deve "falhar" no mock, com base na
 * percentagem de falha + seed determinístico.
 *
 * Retorna um Set de IDs que falham — útil para o runner aplicar
 * `buildFailedClassification` apenas a estes.
 */
export function pickFailingFixtureIds(
  fixtures: readonly BenchmarkFixture[],
  injection: MockFailureInjection,
): ReadonlySet<number> {
  const failing = new Set<number>();
  if (injection.failurePct <= 0) return failing;

  const rand = mulberry32(injection.seed ?? 42);
  const targetCount = Math.round((fixtures.length * injection.failurePct) / 100);
  // Selecciona IDs determinísticos com base em scores aleatórios — ordena e
  // pega os `targetCount` primeiros.
  const scored = fixtures.map((f) => ({ id: f.id, score: rand() }));
  scored.sort((a, b) => a.score - b.score);
  for (let i = 0; i < targetCount && i < scored.length; i += 1) {
    const item = scored[i];
    if (item !== undefined) {
      failing.add(item.id);
    }
  }
  return failing;
}
