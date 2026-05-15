/**
 * Script de benchmark do Classifier — Story 2.10 AC5.
 *
 * Modos:
 *   - `RUN_BENCHMARK_REAL=true`: invoca `Classifier` real com `OpenAIProvider`
 *     (key real `OPENAI_API_KEY` necessária — T10 manual). NÃO corre em CI.
 *   - default (`RUN_BENCHMARK_REAL` ausente ou !== 'true'): modo mock
 *     determinístico via `buildExpectedClassification` — corre em CI sem keys.
 *
 * Métricas calculadas:
 *   - `accuracy_pct` global (correct/200 * 100)
 *   - `by_intent` (precisão por intent)
 *   - `latency_p50_ms`, `latency_p95_ms`
 *   - `cost_eur_total`
 *
 * Output:
 *   - Texto tabular para terminal (stdout)
 *   - JSON estruturado em `docs/qa/benchmark-results-{timestamp}.json`
 *
 * Pass/fail:
 *   - Exit code 0 se `accuracy_pct >= 90 && latency_p95_ms <= 6000`
 *   - Exit code 1 caso contrário (CI / pre-push usa este sinal)
 *
 * Trace: PRD OKR O2 KR2 (precisão ≥90%); NFR1 (latência p95 < 6s); NFR12 (prompt
 *        hash SHA256 — nunca cleartext em logs/JSON); Story 2.5 nota benchmark.
 */
import { createHash } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve as resolvePath } from 'node:path';

import type { Intent } from '@meu-jarvis/classifier';

import {
  buildExpectedClassification,
  buildFailedClassification,
  MOCK_DEFAULT_COST_EUR,
  MOCK_DEFAULT_LATENCY_MS,
  MOCK_DEFAULT_TOKENS_INPUT,
  MOCK_DEFAULT_TOKENS_OUTPUT,
  pickFailingFixtureIds,
} from './__fixtures__/mock-classifications';
import { BENCHMARK_FIXTURES, EXPECTED_TOTAL, type BenchmarkFixture } from './prompts-pt-pt';

// =============================================================================
// Thresholds canónicos (NFR1 + OKR O2 KR2 — Story 2.10 AC5)
// =============================================================================

export const ACCURACY_THRESHOLD_PCT = 90;
export const LATENCY_P95_THRESHOLD_MS = 6000;

// =============================================================================
// Tipos do resultado
// =============================================================================

export interface PromptResult {
  /** SHA256 do prompt — NFR12 zero PII em logs/output. */
  readonly prompt_hash: string;
  readonly expected_intents: readonly Intent[];
  readonly actual_intents: readonly Intent[];
  readonly actual_confidence: number;
  readonly latency_ms: number;
  readonly cost_eur: number;
  readonly correct: boolean;
  /** True se confidence < 0.70 — pipeline deve pedir confirmação (FR4). */
  readonly needs_confirmation: boolean;
}

export interface IntentBreakdown {
  readonly correct: number;
  readonly total: number;
  readonly accuracy_pct: number;
}

export interface BenchmarkReport {
  readonly run_at: string;
  readonly mode: 'real' | 'mock';
  readonly prompts_total: number;
  readonly correct: number;
  readonly accuracy_pct: number;
  readonly latency_p50_ms: number;
  readonly latency_p95_ms: number;
  readonly cost_eur_total: number;
  readonly by_intent: Readonly<Record<string, IntentBreakdown>>;
  readonly threshold_accuracy: number;
  readonly threshold_p95_ms: number;
  readonly pass: boolean;
  /** Per-prompt breakdown (anonimizado via hash — NFR12). */
  readonly results: readonly PromptResult[];
}

// =============================================================================
// Helpers
// =============================================================================

/**
 * Hash SHA256 do prompt — usado em logs e JSON output para correlação sem PII
 * (NFR12). Retorna os primeiros 16 chars em hex (suficiente para tracing).
 */
function hashPrompt(prompt: string): string {
  return createHash('sha256').update(prompt).digest('hex').slice(0, 16);
}

/**
 * Verifica se `expected_intents` estão contidos em `actual_intents` e que não
 * há "intent extra de alta confiança" (>0.70) — definição AC5 da Story 2.10.
 *
 * Para o modo mock, `actual_intents` reproduz exactamente `expected_intents`
 * (ou `[unknown]` quando injecção de falha activa). Em modo real, o LLM pode
 * devolver intents extra com baixa confiança — toleradas se < 0.70.
 */
export function computeCorrect(
  expected: readonly Intent[],
  actual: readonly Intent[],
  actualConfidences: readonly number[],
): boolean {
  const actualSet = new Set(actual);
  // Todos os esperados estão presentes?
  for (const exp of expected) {
    if (!actualSet.has(exp)) return false;
  }
  // Há intent extra de alta confiança (>0.70) que não está no esperado?
  const expectedSet = new Set(expected);
  for (let i = 0; i < actual.length; i += 1) {
    const item = actual[i];
    const conf = actualConfidences[i];
    if (item !== undefined && conf !== undefined && !expectedSet.has(item) && conf > 0.7) {
      return false;
    }
  }
  return true;
}

/**
 * Calcula percentil. Para um array sorted ascendente, retorna o valor no
 * percentil indicado (0-100).
 */
export function percentile(sorted: readonly number[], pct: number): number {
  if (sorted.length === 0) return 0;
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.floor((pct / 100) * sorted.length)));
  return sorted[idx] ?? 0;
}

/**
 * Categoriza um fixture para o breakdown `by_intent`. Para multi-intent,
 * usa `'multi_intent'` como bucket. Caso contrário, o intent único.
 */
export function categorizeFixture(fixture: BenchmarkFixture): string {
  if (fixture.expected_intents.length > 1) return 'multi_intent';
  return fixture.expected_intents[0] ?? 'unknown';
}

// =============================================================================
// Runner mock determinístico
// =============================================================================

/**
 * Opções para o runner mock — permite injectar falhas para testar exit-code
 * em `accuracy_pct < 90`.
 */
export interface MockRunnerOpts {
  /** % de falha (0-100). Default 0 (mock perfeito). */
  readonly failurePct?: number;
  /** Latência sintética em ms. Default `MOCK_DEFAULT_LATENCY_MS`. */
  readonly syntheticLatencyMs?: number;
  /**
   * Override de latência p95 para testar exit-code latência > 6000. Aplicado
   * aos últimos N fixtures (default 10% do total) — garante que o p95 (idx ~190
   * em 200 fixtures) captura a latência alta independentemente da seed.
   */
  readonly forceP95Ms?: number;
  /** Seed para reproducibilidade. Default 42. */
  readonly seed?: number;
}

/**
 * Corre o benchmark no modo mock — não invoca LLM real.
 */
export function runBenchmarkMock(opts: MockRunnerOpts = {}): BenchmarkReport {
  const fixtures = BENCHMARK_FIXTURES;
  const failingIds = pickFailingFixtureIds(fixtures, {
    failurePct: opts.failurePct ?? 0,
    seed: opts.seed ?? 42,
  });
  const baseLatency = opts.syntheticLatencyMs ?? MOCK_DEFAULT_LATENCY_MS;
  // `forceP95Ms` aplicado aos últimos 10% de fixtures — garante captura no p95.
  const forceP95FromId =
    opts.forceP95Ms !== undefined ? Math.floor(fixtures.length * 0.9) + 1 : Number.MAX_SAFE_INTEGER;

  const results: PromptResult[] = [];
  for (const fixture of fixtures) {
    const isFailing = failingIds.has(fixture.id);
    // FIX: fixture que esperava `unknown` continua correct mesmo quando "falhada"
    // (buildFailedClassification devolve [unknown]). Para forçar uma falha real,
    // detectar e usar uma intent diferente.
    let classification =
      isFailing ? buildFailedClassification(fixture) : buildExpectedClassification(fixture);
    if (
      isFailing &&
      fixture.expected_intents.length === 1 &&
      fixture.expected_intents[0] === 'unknown'
    ) {
      // Fixture esperava unknown — buildFailedClassification devolveria unknown e
      // ficaria correct. Substituir por intent diferente para forçar falha real.
      classification = {
        intents: [
          {
            intent: 'criar_tarefa',
            confidence: 0.5,
            raw_span: fixture.prompt.slice(0, 30),
          },
        ],
        language: 'pt-PT',
        needs_confirmation: true,
        overall_confidence: 0.5,
      };
    }

    const actualIntents = classification.intents.map((i) => i.intent);
    const actualConfidences = classification.intents.map((i) => i.confidence);

    const latency = opts.forceP95Ms !== undefined && fixture.id >= forceP95FromId
      ? opts.forceP95Ms
      : baseLatency;

    results.push({
      prompt_hash: hashPrompt(fixture.prompt),
      expected_intents: fixture.expected_intents,
      actual_intents: actualIntents,
      actual_confidence: classification.overall_confidence,
      latency_ms: latency,
      cost_eur: MOCK_DEFAULT_COST_EUR,
      correct: computeCorrect(fixture.expected_intents, actualIntents, actualConfidences),
      needs_confirmation: classification.needs_confirmation,
    });
  }

  return buildReport(results, 'mock');
}

// =============================================================================
// Runner real (RUN_BENCHMARK_REAL=true) — invoca Classifier real
// =============================================================================

/**
 * Corre o benchmark no modo real — invoca `Classifier` com `OpenAIProvider`.
 *
 * Esta função é lazy-loaded (dynamic import) para evitar que `@meu-jarvis/classifier`
 * + `@meu-jarvis/agent` sejam carregados em modo mock (CI). Reduz superfície
 * de erro em ambientes sem keys.
 *
 * **NÃO USAR EM CI.** Apenas chamada quando `RUN_BENCHMARK_REAL=true`.
 *
 * Trace: AC5; Story 2.4 (Classifier); Story 2.2 (OpenAIProvider env).
 */
export async function runBenchmarkReal(): Promise<BenchmarkReport> {
  // Dynamic imports para isolamento (não carregar SDKs em modo mock).
  const [{ Classifier }, { OpenAIProvider }] = await Promise.all([
    import('@meu-jarvis/classifier'),
    import('@meu-jarvis/agent'),
  ]);

  // Construir provider + classifier. Provider lê OPENAI_API_KEY do env;
  // lança MissingApiKeyError se ausente — fail-fast intencional.
  const provider = new OpenAIProvider();
  // Adaptador minimal: Classifier requer um OpenAIClientLike (chat.completions.create).
  // OpenAIProvider envolve isso via `complete(input)`. Para esta story, o caminho
  // mais directo é reusar a estrutura interna do OpenAIProvider via getProvider().
  // Mas Classifier recebe `OpenAIClientLike` directo — não `ProviderInterface`.
  // Solução: instanciar o cliente OpenAI directamente aqui (apenas neste path real).
  const OpenAI = (await import('openai')).default;
  // Constructor type permite apiKey via env automaticamente (OpenAI SDK).
  const apiKey = process.env.OPENAI_API_KEY;
  if (apiKey === undefined || apiKey.trim() === '') {
    throw new Error(
      'OPENAI_API_KEY ausente no ambiente — fail-fast (NFR8). Configurar via .env.local antes de RUN_BENCHMARK_REAL=true.',
    );
  }
  const openaiClient = new OpenAI({ apiKey });
  // OpenAI SDK v4+ tem a forma { chat: { completions: { create } } } — compatible
  // com `OpenAIClientLike`. Cast através de `unknown` para evitar coupling de
  // tipos cross-package (Classifier importa `OpenAIClientLike` de @meu-jarvis/agent).
  const classifier = new Classifier(
    openaiClient as unknown as ConstructorParameters<typeof Classifier>[0],
  );

  void provider; // Marca-se como usado — provider serviu de verificação fail-fast acima.

  const results: PromptResult[] = [];
  for (const fixture of BENCHMARK_FIXTURES) {
    const start = Date.now();
    let actualIntents: Intent[] = [];
    let actualConfidences: number[] = [];
    let costEur = 0;
    let overallConfidence = 0;
    let needsConfirmation = false;
    try {
      const result = await classifier.classify({
        text: fixture.prompt,
        householdId: '00000000-0000-0000-0000-000000000001',
        userId: '00000000-0000-0000-0000-000000000001',
        traceId: `benchmark-${fixture.id}`,
      });
      actualIntents = result.intents.map((i) => i.intent);
      actualConfidences = result.intents.map((i) => i.confidence);
      overallConfidence = result.overall_confidence;
      needsConfirmation = result.needs_confirmation;
    } catch (err) {
      // Falha do LLM — regista como classificação `unknown` baixa confiança.
      actualIntents = ['unknown'];
      actualConfidences = [0];
      console.error(`[benchmark] fixture #${String(fixture.id)} falhou: ${err instanceof Error ? err.message : 'unknown'}`);
    }
    const latency = Date.now() - start;

    results.push({
      prompt_hash: hashPrompt(fixture.prompt),
      expected_intents: fixture.expected_intents,
      actual_intents: actualIntents,
      actual_confidence: overallConfidence,
      latency_ms: latency,
      cost_eur: costEur,
      correct: computeCorrect(fixture.expected_intents, actualIntents, actualConfidences),
      needs_confirmation: needsConfirmation,
    });
  }

  return buildReport(results, 'real');
}

// =============================================================================
// Report builder
// =============================================================================

function buildReport(results: readonly PromptResult[], mode: 'real' | 'mock'): BenchmarkReport {
  const fixtures = BENCHMARK_FIXTURES;
  const sortedLatencies = results.map((r) => r.latency_ms).sort((a, b) => a - b);
  const correctCount = results.filter((r) => r.correct).length;
  const accuracyPct = (correctCount / results.length) * 100;
  const costTotal = results.reduce((sum, r) => sum + r.cost_eur, 0);

  // Breakdown por intent (incluindo bucket sintético 'multi_intent')
  const byIntent: Record<string, IntentBreakdown> = {};
  for (let i = 0; i < fixtures.length; i += 1) {
    const fixture = fixtures[i];
    const result = results[i];
    if (fixture === undefined || result === undefined) continue;
    const bucket = categorizeFixture(fixture);
    const existing = byIntent[bucket];
    if (existing === undefined) {
      byIntent[bucket] = { correct: result.correct ? 1 : 0, total: 1, accuracy_pct: 0 };
    } else {
      byIntent[bucket] = {
        correct: existing.correct + (result.correct ? 1 : 0),
        total: existing.total + 1,
        accuracy_pct: 0,
      };
    }
  }
  for (const key of Object.keys(byIntent)) {
    const b = byIntent[key];
    if (b !== undefined) {
      byIntent[key] = {
        ...b,
        accuracy_pct: b.total > 0 ? (b.correct / b.total) * 100 : 0,
      };
    }
  }

  const p50 = percentile(sortedLatencies, 50);
  const p95 = percentile(sortedLatencies, 95);
  const pass = accuracyPct >= ACCURACY_THRESHOLD_PCT && p95 <= LATENCY_P95_THRESHOLD_MS;

  return {
    run_at: new Date().toISOString(),
    mode,
    prompts_total: results.length,
    correct: correctCount,
    accuracy_pct: Math.round(accuracyPct * 100) / 100,
    latency_p50_ms: p50,
    latency_p95_ms: p95,
    cost_eur_total: Math.round(costTotal * 1_000_000) / 1_000_000,
    by_intent: byIntent,
    threshold_accuracy: ACCURACY_THRESHOLD_PCT,
    threshold_p95_ms: LATENCY_P95_THRESHOLD_MS,
    pass,
    results,
  };
}

// =============================================================================
// Output (texto + JSON)
// =============================================================================

/**
 * Formata o report em texto tabular para stdout.
 */
export function formatReportTable(report: BenchmarkReport): string {
  const lines: string[] = [
    '',
    '═══════════════════════════════════════════════════════════════════════',
    `  BENCHMARK CLASSIFIER — modo: ${report.mode.toUpperCase()}`,
    '═══════════════════════════════════════════════════════════════════════',
    `  Total prompts:       ${String(report.prompts_total)}`,
    `  Correctos:           ${String(report.correct)} (${report.accuracy_pct.toFixed(2)}%)`,
    `  Threshold accuracy:  ${String(report.threshold_accuracy)}%`,
    `  Latência p50:        ${String(report.latency_p50_ms)} ms`,
    `  Latência p95:        ${String(report.latency_p95_ms)} ms`,
    `  Threshold p95:       ${String(report.threshold_p95_ms)} ms`,
    `  Custo total:         ${report.cost_eur_total.toFixed(6)} EUR`,
    `  Status:              ${report.pass ? 'PASS ✓' : 'FAIL ✗'}`,
    '',
    '  Precisão por intent:',
    '  ──────────────────────────────────────────────────────────────────',
  ];
  for (const key of Object.keys(report.by_intent).sort()) {
    const b = report.by_intent[key];
    if (b !== undefined) {
      lines.push(
        `    ${key.padEnd(28)} ${String(b.correct).padStart(3)}/${String(b.total).padEnd(3)}  ${b.accuracy_pct.toFixed(2)}%`,
      );
    }
  }
  lines.push('═══════════════════════════════════════════════════════════════════════');
  lines.push('');
  return lines.join('\n');
}

/**
 * Escreve o JSON do report num ficheiro estruturado.
 *
 * Path default: `docs/qa/benchmark-results-{timestamp}.json` (relativo ao
 * cwd que invoca o script — normalmente a raiz do repo).
 */
export function writeReportJson(report: BenchmarkReport, outputPath: string): void {
  mkdirSync(dirname(outputPath), { recursive: true });
  writeFileSync(outputPath, JSON.stringify(report, null, 2), 'utf-8');
}

/**
 * Helper para construir o path de output a partir de cwd + timestamp.
 */
export function buildDefaultOutputPath(cwd: string, runAt: string): string {
  // YYYYMMDDTHHmmss para nome de ficheiro filesystem-safe.
  const slug = runAt.replace(/[:.]/g, '-').replace(/-\d{3}Z$/, 'Z');
  return resolvePath(cwd, 'docs', 'qa', `benchmark-results-${slug}.json`);
}

// =============================================================================
// CLI entry-point (quando o ficheiro é invocado directamente)
// =============================================================================

/**
 * Main — invocado por `tsx src/benchmark/run-benchmark.ts`.
 *
 * Decide modo via env: `RUN_BENCHMARK_REAL=true` → real; caso contrário → mock.
 * Exit code 0 se PASS, 1 se FAIL.
 */
export async function main(): Promise<void> {
  const isReal = process.env.RUN_BENCHMARK_REAL === 'true';
  const report = isReal ? await runBenchmarkReal() : runBenchmarkMock();

  process.stdout.write(formatReportTable(report));

  const outputPath = buildDefaultOutputPath(process.cwd(), report.run_at);
  writeReportJson(report, outputPath);
  process.stdout.write(`  Relatório JSON: ${outputPath}\n\n`);

  if (!report.pass) {
    process.exitCode = 1;
  }
}

// Sanity check em runtime: AC4 do benchmark deve sempre executar 200 fixtures.
if (BENCHMARK_FIXTURES.length !== EXPECTED_TOTAL) {
  throw new Error(
    `Esperados ${String(EXPECTED_TOTAL)} fixtures, mas o array tem ${String(BENCHMARK_FIXTURES.length)}.`,
  );
}

// Auto-run quando invocado directamente (não como import em tests).
// `process.argv[1]` é o entry-point — comparação resolve symlinks via dirname.
const isMainModule =
  typeof process.argv[1] === 'string' &&
  (process.argv[1].endsWith('run-benchmark.ts') || process.argv[1].endsWith('run-benchmark.js'));
if (isMainModule) {
  void main().catch((err: unknown) => {
    console.error('[benchmark] erro fatal:', err);
    process.exitCode = 1;
  });
}
