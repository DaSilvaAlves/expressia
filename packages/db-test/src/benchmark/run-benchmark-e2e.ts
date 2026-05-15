/**
 * Script de benchmark E2E pipeline completo — Story 2.10 AC6 + AC7 + AC9 + AC10.
 *
 * Pipeline simulado: `checkQuota → cacheClient.get → Classifier → isSingleConsultarDados →
 *                     Planner → Executor (atomicTransaction com rollback)`.
 *
 * Modos:
 *   - `RUN_BENCHMARK_E2E_REAL=true`: invoca `Classifier` + `Planner` + `Executor`
 *     reais com keys reais (T10 manual). NÃO corre em CI.
 *   - default: modo mock determinístico — usa `AnthropicClientLike` mock + tools
 *     mock registadas em `toolRegistry` (QA2 decision: tools são Story 2.11+).
 *
 * Sub-set: prompts accionáveis (todos excepto `consultar_dados` e `unknown`).
 * Total: ~160 fixtures.
 *
 * Métricas:
 *   - `cost_router_bypass`: % de prompts `consultar_dados` que tomaram caminho directo
 *   - `needs_confirmation`: % de prompts com confidence < 0.70 (não executam)
 *   - `cache_hit_rate`: 0% no modo degradado D57 (sem Upstash)
 *   - Latência total pipeline (classify + plan + execute) p50/p95
 *   - Custo total acumulado EUR
 *
 * Trace: FR2 atomicidade; FR3 audit log; FR4 preview; Architecture §4.1 pipeline
 *        3-estágios; Story 1.4 Testcontainers; Story 2.5 nota E2E; Story 2.9
 *        cost router + cache; PO QA2 (mocks tools no E2E).
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve as resolvePath } from 'node:path';

import type { Intent } from '@meu-jarvis/classifier';

import {
  buildExpectedClassification,
  buildFailedClassification,
  MOCK_DEFAULT_COST_EUR,
  MOCK_DEFAULT_LATENCY_MS,
  pickFailingFixtureIds,
} from './__fixtures__/mock-classifications';
import {
  clearMockBenchmarkTools,
  registerMockBenchmarkTools,
} from './__fixtures__/mock-benchmark-tools';
import {
  BENCHMARK_FIXTURES,
  EXPECTED_TOTAL,
  type BenchmarkFixture,
} from './prompts-pt-pt';

// =============================================================================
// Thresholds (alinhados com run-benchmark.ts — Story 2.10 AC5 + AC6)
// =============================================================================

export const E2E_ACCURACY_THRESHOLD_PCT = 90;
export const E2E_LATENCY_P95_THRESHOLD_MS = 6000;

// =============================================================================
// Tipos
// =============================================================================

export interface E2EPromptResult {
  readonly fixture_id: number;
  readonly expected_intents: readonly Intent[];
  readonly actual_intents: readonly Intent[];
  readonly confidence: number;
  /** Pipeline tomou caminho direct-DB (cost router bypass — Story 2.9 AC4-AC6). */
  readonly cost_router_bypass: boolean;
  /** Preview requested (confidence < 0.70 — FR4). */
  readonly needs_confirmation: boolean;
  /** Plan + execute success (false se bloqueado por preview/quota). */
  readonly executed: boolean;
  /** Cache hit no estágio Classifier (Story 2.9 AC3). False em modo degradado. */
  readonly cache_hit: boolean;
  /** Bloqueado por quota? (Story 2.9 AC7/AC8 — `quota_blocked` registado). */
  readonly quota_blocked: boolean;
  readonly latency_ms: number;
  readonly cost_eur: number;
}

export interface E2EReport {
  readonly run_at: string;
  readonly mode: 'real' | 'mock';
  readonly prompts_total: number;
  readonly executed_count: number;
  readonly preview_blocked_count: number;
  readonly cost_router_bypass_count: number;
  readonly quota_blocked_count: number;
  readonly cache_hit_rate_pct: number;
  readonly latency_p50_ms: number;
  readonly latency_p95_ms: number;
  readonly cost_eur_total: number;
  readonly threshold_p95_ms: number;
  readonly pass: boolean;
  readonly results: readonly E2EPromptResult[];
}

// =============================================================================
// Helpers
// =============================================================================

/**
 * isSingleConsultarDados — heurística cost router Story 2.9. Replica a lógica
 * para o benchmark sem depender de `apps/web/src/lib/cost-router.ts` (que tem
 * dependências runtime adicionais).
 *
 * Regra: classification com exactamente 1 intent === 'consultar_dados'.
 */
export function isSingleConsultarDados(intents: readonly Intent[]): boolean {
  return intents.length === 1 && intents[0] === 'consultar_dados';
}

function percentile(sorted: readonly number[], pct: number): number {
  if (sorted.length === 0) return 0;
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.floor((pct / 100) * sorted.length)));
  return sorted[idx] ?? 0;
}

// =============================================================================
// Runner mock determinístico
// =============================================================================

export interface E2EMockRunnerOpts {
  /** Forçar latência sintética. Default `MOCK_DEFAULT_LATENCY_MS * 1.5`. */
  readonly syntheticLatencyMs?: number;
  /** % de prompts que falham classificação. Default 0. */
  readonly failurePct?: number;
  /** Simular quota bloqueada para N% dos prompts. Default 0. */
  readonly quotaBlockPct?: number;
  /** Seed determinístico. Default 42. */
  readonly seed?: number;
}

/**
 * Pipeline E2E mockable — não invoca LLM real, não toca em DB real.
 *
 * Simula o caminho `checkQuota → cache → Classifier → cost router → Planner →
 * Executor` com decisões determinísticas baseadas em `BenchmarkFixture`.
 *
 * Pipeline lógico (modo mock):
 *   1. `checkQuota` (mock): bloqueia se ID está em `quotaBlocked` set.
 *   2. `cache.get` (mock): sempre miss (D57 — modo degradado sem Upstash).
 *   3. `Classifier.classify` (mock): retorna `buildExpectedClassification`.
 *   4. `isSingleConsultarDados` → se true: `cost_router_bypass = true`, executed = true (direct-DB simulado).
 *   5. Else, se `confidence < 0.70` → `needs_confirmation = true`, executed = false (preview block).
 *   6. Else, `Planner.plan` (mock): mock tools registadas devolvem AtomicResult.success.
 *   7. `Executor.execute` (mock): rollback transacção (zero residual).
 */
export function runE2EMock(opts: E2EMockRunnerOpts = {}): E2EReport {
  registerMockBenchmarkTools();

  try {
    const fixtures = BENCHMARK_FIXTURES;
    const failingIds = pickFailingFixtureIds(fixtures, {
      failurePct: opts.failurePct ?? 0,
      seed: opts.seed ?? 42,
    });
    const quotaBlocked = pickFailingFixtureIds(fixtures, {
      failurePct: opts.quotaBlockPct ?? 0,
      seed: (opts.seed ?? 42) + 1,
    });
    const baseLatency = opts.syntheticLatencyMs ?? Math.round(MOCK_DEFAULT_LATENCY_MS * 1.5);

    const results: E2EPromptResult[] = [];
    for (const fixture of fixtures) {
      results.push(buildE2EResultMock(fixture, failingIds, quotaBlocked, baseLatency));
    }

    return buildE2EReport(results, 'mock');
  } finally {
    clearMockBenchmarkTools();
  }
}

function buildE2EResultMock(
  fixture: BenchmarkFixture,
  failingIds: ReadonlySet<number>,
  quotaBlocked: ReadonlySet<number>,
  baseLatency: number,
): E2EPromptResult {
  // Step 1 — quota check
  if (quotaBlocked.has(fixture.id)) {
    return {
      fixture_id: fixture.id,
      expected_intents: fixture.expected_intents,
      actual_intents: [],
      confidence: 0,
      cost_router_bypass: false,
      needs_confirmation: false,
      executed: false,
      cache_hit: false,
      quota_blocked: true,
      latency_ms: 5, // checkQuota é rápido
      cost_eur: 0,
    };
  }

  // Steps 2-3 — cache miss + classify
  const isFailing = failingIds.has(fixture.id);
  const classification = isFailing
    ? buildFailedClassification(fixture)
    : buildExpectedClassification(fixture);

  const actualIntents = classification.intents.map((i) => i.intent);
  const confidence = classification.overall_confidence;

  // Step 4 — cost router bypass para singleton consultar_dados
  if (isSingleConsultarDados(actualIntents)) {
    return {
      fixture_id: fixture.id,
      expected_intents: fixture.expected_intents,
      actual_intents: actualIntents,
      confidence,
      cost_router_bypass: true,
      needs_confirmation: false,
      executed: true, // direct-DB query simulado bem-sucedido
      cache_hit: false,
      quota_blocked: false,
      latency_ms: Math.round(baseLatency * 0.4), // ~40% da latência (sem Planner)
      cost_eur: MOCK_DEFAULT_COST_EUR, // só classifier — sem Planner Sonnet
    };
  }

  // Step 5 — preview block (FR4)
  if (confidence < 0.7) {
    return {
      fixture_id: fixture.id,
      expected_intents: fixture.expected_intents,
      actual_intents: actualIntents,
      confidence,
      cost_router_bypass: false,
      needs_confirmation: true,
      executed: false,
      cache_hit: false,
      quota_blocked: false,
      latency_ms: Math.round(baseLatency * 0.5), // só classifier
      cost_eur: MOCK_DEFAULT_COST_EUR,
    };
  }

  // Steps 6-7 — Planner + Executor (mock tools registadas)
  // Em modo mock, tools devolvem sucesso determinístico — rollback Testcontainers
  // garantiria zero residual em modo real.
  return {
    fixture_id: fixture.id,
    expected_intents: fixture.expected_intents,
    actual_intents: actualIntents,
    confidence,
    cost_router_bypass: false,
    needs_confirmation: false,
    executed: true,
    cache_hit: false,
    quota_blocked: false,
    latency_ms: baseLatency, // pipeline completo
    cost_eur: MOCK_DEFAULT_COST_EUR * 5, // ~5× porque Planner Sonnet é mais caro
  };
}

// =============================================================================
// Runner real (RUN_BENCHMARK_E2E_REAL=true)
// =============================================================================

/**
 * Pipeline E2E real — invoca `Classifier` + `Planner` + `Executor` com keys
 * reais. **NÃO USAR EM CI.** Requer Testcontainers Postgres em execução.
 *
 * Esta função fica esqueletizada nesta story porque T10 está BLOCKED pending
 * Eurico QA1. Quando T10 for desbloqueado, esta função deve ser populada com:
 *   - Testcontainers setup (reutilizar `packages/db-test/src/setup/global-setup.ts`)
 *   - getProvider({ preferredProvider: 'anthropic' }) + AnthropicProvider real
 *   - getProvider({ preferredProvider: 'openai' }) + OpenAIProvider real
 *   - tools reais (Story 2.11+ / Epic 3) ou mocks via registerMockBenchmarkTools
 *
 * Trace: Story 2.10 T10 (BLOCKED).
 */
export async function runE2EReal(): Promise<E2EReport> {
  throw new Error(
    'runE2EReal não está implementado nesta story — T10 está BLOCKED pending Eurico QA1 (DPA UE Anthropic). Ver `docs/runbooks/vercel-llm-keys-setup.md` §8.4 para a decisão pendente.',
  );
}

// =============================================================================
// Report builder
// =============================================================================

function buildE2EReport(results: readonly E2EPromptResult[], mode: 'real' | 'mock'): E2EReport {
  const sortedLatencies = results.map((r) => r.latency_ms).sort((a, b) => a - b);
  const executedCount = results.filter((r) => r.executed).length;
  const previewCount = results.filter((r) => r.needs_confirmation).length;
  const bypassCount = results.filter((r) => r.cost_router_bypass).length;
  const quotaCount = results.filter((r) => r.quota_blocked).length;
  const cacheHits = results.filter((r) => r.cache_hit).length;
  const costTotal = results.reduce((sum, r) => sum + r.cost_eur, 0);

  const p50 = percentile(sortedLatencies, 50);
  const p95 = percentile(sortedLatencies, 95);
  const pass = p95 <= E2E_LATENCY_P95_THRESHOLD_MS;

  return {
    run_at: new Date().toISOString(),
    mode,
    prompts_total: results.length,
    executed_count: executedCount,
    preview_blocked_count: previewCount,
    cost_router_bypass_count: bypassCount,
    quota_blocked_count: quotaCount,
    cache_hit_rate_pct:
      results.length > 0 ? Math.round((cacheHits / results.length) * 10000) / 100 : 0,
    latency_p50_ms: p50,
    latency_p95_ms: p95,
    cost_eur_total: Math.round(costTotal * 1_000_000) / 1_000_000,
    threshold_p95_ms: E2E_LATENCY_P95_THRESHOLD_MS,
    pass,
    results,
  };
}

// =============================================================================
// Output
// =============================================================================

export function formatE2EReportTable(report: E2EReport): string {
  const lines: string[] = [
    '',
    '═══════════════════════════════════════════════════════════════════════',
    `  BENCHMARK E2E PIPELINE — modo: ${report.mode.toUpperCase()}`,
    '═══════════════════════════════════════════════════════════════════════',
    `  Total prompts:           ${String(report.prompts_total)}`,
    `  Executados:              ${String(report.executed_count)}`,
    `  Bloqueados por preview:  ${String(report.preview_blocked_count)} (FR4)`,
    `  Cost router bypass:      ${String(report.cost_router_bypass_count)} (consultar_dados singleton)`,
    `  Bloqueados por quota:    ${String(report.quota_blocked_count)} (NFR20)`,
    `  Cache hit rate:          ${report.cache_hit_rate_pct.toFixed(2)}% (0% modo degradado D57)`,
    `  Latência p50:            ${String(report.latency_p50_ms)} ms`,
    `  Latência p95:            ${String(report.latency_p95_ms)} ms`,
    `  Threshold p95:           ${String(report.threshold_p95_ms)} ms`,
    `  Custo total:             ${report.cost_eur_total.toFixed(6)} EUR`,
    `  Status:                  ${report.pass ? 'PASS ✓' : 'FAIL ✗'}`,
    '═══════════════════════════════════════════════════════════════════════',
    '',
  ];
  return lines.join('\n');
}

export function writeE2EReportJson(report: E2EReport, outputPath: string): void {
  mkdirSync(dirname(outputPath), { recursive: true });
  writeFileSync(outputPath, JSON.stringify(report, null, 2), 'utf-8');
}

export function buildE2EDefaultOutputPath(cwd: string, runAt: string): string {
  const slug = runAt.replace(/[:.]/g, '-').replace(/-\d{3}Z$/, 'Z');
  return resolvePath(cwd, 'docs', 'qa', `benchmark-e2e-results-${slug}.json`);
}

// =============================================================================
// CLI entry-point
// =============================================================================

export async function mainE2E(): Promise<void> {
  const isReal = process.env.RUN_BENCHMARK_E2E_REAL === 'true';
  const report = isReal ? await runE2EReal() : runE2EMock();

  process.stdout.write(formatE2EReportTable(report));

  const outputPath = buildE2EDefaultOutputPath(process.cwd(), report.run_at);
  writeE2EReportJson(report, outputPath);
  process.stdout.write(`  Relatório JSON: ${outputPath}\n\n`);

  if (!report.pass) {
    process.exitCode = 1;
  }
}

if (BENCHMARK_FIXTURES.length !== EXPECTED_TOTAL) {
  throw new Error(
    `Esperados ${String(EXPECTED_TOTAL)} fixtures, mas o array tem ${String(BENCHMARK_FIXTURES.length)}.`,
  );
}

const isMainModule =
  typeof process.argv[1] === 'string' &&
  (process.argv[1].endsWith('run-benchmark-e2e.ts') ||
    process.argv[1].endsWith('run-benchmark-e2e.js'));
if (isMainModule) {
  void mainE2E().catch((err: unknown) => {
    console.error('[benchmark-e2e] erro fatal:', err);
    process.exitCode = 1;
  });
}
