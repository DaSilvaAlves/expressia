/**
 * Tests AC11(i-v) — Runner mock do benchmark classifier.
 *
 * Trace: Story 2.10 AC11 + AC5 + AC8 + NFR1.
 */
import { describe, expect, it } from 'vitest';

import {
  ACCURACY_THRESHOLD_PCT,
  buildDefaultOutputPath,
  categorizeFixture,
  computeCorrect,
  formatReportTable,
  LATENCY_P95_THRESHOLD_MS,
  percentile,
  runBenchmarkMock,
} from '../run-benchmark';
import { BENCHMARK_FIXTURES } from '../prompts-pt-pt';

describe('BenchmarkRunner — AC11(i-v)', () => {
  // ───────────────────────────────────────────────────────────────────────
  // AC11(i) — run-benchmark mock completa sem LLM call
  // ───────────────────────────────────────────────────────────────────────
  it('(i) runBenchmarkMock completa sem LLM real e produz BenchmarkReport completo', () => {
    const report = runBenchmarkMock();
    expect(report.mode).toBe('mock');
    expect(report.prompts_total).toBe(BENCHMARK_FIXTURES.length);
    expect(report.run_at).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(report.threshold_accuracy).toBe(ACCURACY_THRESHOLD_PCT);
    expect(report.threshold_p95_ms).toBe(LATENCY_P95_THRESHOLD_MS);
    expect(report.results.length).toBe(BENCHMARK_FIXTURES.length);
  });

  // ───────────────────────────────────────────────────────────────────────
  // AC11(ii) — correct calculado correctamente (actual == expected → correct)
  // ───────────────────────────────────────────────────────────────────────
  it('(ii) correct = true quando actual_intents = expected_intents (mock perfeito)', () => {
    const report = runBenchmarkMock({ failurePct: 0 });
    // Mock perfeito → todos correct
    expect(report.correct).toBe(BENCHMARK_FIXTURES.length);
    expect(report.accuracy_pct).toBe(100);
    expect(report.pass).toBe(true);
  });

  it('computeCorrect: detecta intent extra de alta confiança como falha', () => {
    // expected = [criar_tarefa], actual = [criar_tarefa, criar_financa_variavel]
    // confidences = [0.9, 0.85] → extra com >0.7 → falha
    expect(
      computeCorrect(
        ['criar_tarefa'],
        ['criar_tarefa', 'criar_financa_variavel'],
        [0.9, 0.85],
      ),
    ).toBe(false);
  });

  it('computeCorrect: tolera intent extra de baixa confiança (<=0.7)', () => {
    expect(
      computeCorrect(
        ['criar_tarefa'],
        ['criar_tarefa', 'criar_financa_variavel'],
        [0.9, 0.65], // segunda intent <0.7 → tolerada
      ),
    ).toBe(true);
  });

  // ───────────────────────────────────────────────────────────────────────
  // AC11(iii) — exit code 1 quando accuracy < 90 (mock 89%)
  // ───────────────────────────────────────────────────────────────────────
  it('(iii) report.pass = false quando accuracy_pct < 90 (mock 11% failurePct → ~89%)', () => {
    // 11% failure → ~89% accuracy → abaixo do threshold 90
    const report = runBenchmarkMock({ failurePct: 11 });
    expect(report.accuracy_pct).toBeLessThan(ACCURACY_THRESHOLD_PCT);
    expect(report.pass).toBe(false);
  });

  // ───────────────────────────────────────────────────────────────────────
  // AC11(iv) — exit code 1 quando p95 > 6000ms
  // ───────────────────────────────────────────────────────────────────────
  it('(iv) report.pass = false quando latency_p95_ms > 6000 (forceP95Ms=7000)', () => {
    // Injecta latência alta no último fixture (ID = 200) — empurra p95 acima do threshold
    const report = runBenchmarkMock({ forceP95Ms: 7000 });
    expect(report.latency_p95_ms).toBeGreaterThan(LATENCY_P95_THRESHOLD_MS);
    expect(report.pass).toBe(false);
  });

  // ───────────────────────────────────────────────────────────────────────
  // AC11(v) — JSON output tem todos os campos obrigatórios de AC8
  // ───────────────────────────────────────────────────────────────────────
  it('(v) BenchmarkReport tem todos os campos obrigatórios de AC8', () => {
    const report = runBenchmarkMock();
    expect(report).toHaveProperty('run_at');
    expect(report).toHaveProperty('prompts_total');
    expect(report).toHaveProperty('correct');
    expect(report).toHaveProperty('accuracy_pct');
    expect(report).toHaveProperty('latency_p50_ms');
    expect(report).toHaveProperty('latency_p95_ms');
    expect(report).toHaveProperty('cost_eur_total');
    expect(report).toHaveProperty('by_intent');
    expect(report).toHaveProperty('pass');
    expect(report).toHaveProperty('threshold_accuracy');
    expect(report).toHaveProperty('threshold_p95_ms');
  });

  it('by_intent inclui categoria multi_intent quando há fixtures multi-intent', () => {
    const report = runBenchmarkMock();
    expect(report.by_intent.multi_intent).toBeDefined();
    expect(report.by_intent.multi_intent?.total).toBeGreaterThan(0);
  });

  // ───────────────────────────────────────────────────────────────────────
  // Helpers — percentile + categorizeFixture + buildDefaultOutputPath
  // ───────────────────────────────────────────────────────────────────────
  it('percentile: calcula percentil corretamente', () => {
    const sorted = [10, 20, 30, 40, 50, 60, 70, 80, 90, 100];
    expect(percentile(sorted, 50)).toBe(60); // floor(0.5 * 10) = 5 → index 5 = 60
    expect(percentile(sorted, 95)).toBe(100); // floor(0.95 * 10) = 9 → index 9 = 100
    expect(percentile([], 50)).toBe(0); // empty array
  });

  it('categorizeFixture: multi-intent vs single-intent', () => {
    const multiIntent = BENCHMARK_FIXTURES.find((f) => f.expected_intents.length > 1);
    if (multiIntent !== undefined) {
      expect(categorizeFixture(multiIntent)).toBe('multi_intent');
    }
    const singleTask = BENCHMARK_FIXTURES.find(
      (f) => f.expected_intents.length === 1 && f.expected_intents[0] === 'criar_tarefa',
    );
    if (singleTask !== undefined) {
      expect(categorizeFixture(singleTask)).toBe('criar_tarefa');
    }
  });

  it('buildDefaultOutputPath: produz path filesystem-safe sob docs/qa', () => {
    const cwd = process.cwd();
    const path = buildDefaultOutputPath(cwd, '2026-05-15T11:30:45.123Z');
    expect(path).toContain('docs');
    expect(path).toContain('qa');
    expect(path).toMatch(/benchmark-results-2026-05-15T11-30-45Z\.json$/);
  });

  it('formatReportTable: produz string não-vazia com cabeçalho e status', () => {
    const report = runBenchmarkMock();
    const text = formatReportTable(report);
    expect(text).toContain('BENCHMARK CLASSIFIER');
    expect(text).toContain('Total prompts');
    expect(text).toContain('Latência p95');
    expect(text).toContain(report.pass ? 'PASS' : 'FAIL');
  });
});
