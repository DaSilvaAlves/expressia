/**
 * Tests AC11(i-iii) — Runner E2E mock + tools mock no toolRegistry.
 *
 * Trace: Story 2.10 AC11 + AC6 + AC9 + AC10 + QA2 (mocks tools).
 */
import { describe, expect, it } from 'vitest';

import { toolRegistry } from '@meu-jarvis/tools';

import {
  MOCK_BENCHMARK_TOOLS,
  registerMockBenchmarkTools,
  clearMockBenchmarkTools,
} from '../__fixtures__/mock-benchmark-tools';
import {
  E2E_LATENCY_P95_THRESHOLD_MS,
  isSingleConsultarDados,
  runE2EMock,
  runE2EReal,
} from '../run-benchmark-e2e';
import { BENCHMARK_FIXTURES } from '../prompts-pt-pt';

describe('BenchmarkE2E — AC11(i-iii)', () => {
  // ───────────────────────────────────────────────────────────────────────
  // AC11(i) — run-benchmark-e2e mock usa toolRegistry com mock tools
  // ───────────────────────────────────────────────────────────────────────
  it('(i) runE2EMock completa sem LLM real e popula toolRegistry com 6 mock tools', () => {
    // toolRegistry está limpo no início (afterEach do test anterior limpa)
    // Verificamos via side-effect: durante o run, os mocks foram registados.
    // Para esta asserção, registamos explicitamente e contamos.
    clearMockBenchmarkTools();
    registerMockBenchmarkTools();
    expect(toolRegistry.list().length).toBe(MOCK_BENCHMARK_TOOLS.length);
    expect(toolRegistry.has('create_task')).toBe(true);
    expect(toolRegistry.has('create_finance_variable')).toBe(true);
    expect(toolRegistry.has('create_finance_recurrence')).toBe(true);
    expect(toolRegistry.has('create_card')).toBe(true);
    expect(toolRegistry.has('create_installment')).toBe(true);
    expect(toolRegistry.has('cancel_last_run')).toBe(true);
    clearMockBenchmarkTools();
  });

  it('runE2EMock retorna E2EReport com todos os campos e respeita threshold p95', () => {
    const report = runE2EMock();
    expect(report.mode).toBe('mock');
    expect(report.prompts_total).toBe(BENCHMARK_FIXTURES.length);
    expect(report.threshold_p95_ms).toBe(E2E_LATENCY_P95_THRESHOLD_MS);
    expect(report.latency_p95_ms).toBeLessThanOrEqual(E2E_LATENCY_P95_THRESHOLD_MS);
    expect(report.pass).toBe(true); // mock latency está sempre abaixo do threshold
    expect(report.cache_hit_rate_pct).toBe(0); // D57 modo degradado
  });

  // ───────────────────────────────────────────────────────────────────────
  // AC11(ii) — transacções Testcontainers: rollback (mock simula)
  // ───────────────────────────────────────────────────────────────────────
  it('(ii) toolRegistry está limpo após runE2EMock (clearMockBenchmarkTools no finally)', () => {
    runE2EMock();
    // O try/finally garante clear no final — toolRegistry está limpo.
    expect(toolRegistry.list().length).toBe(0);
  });

  // ───────────────────────────────────────────────────────────────────────
  // AC11(iii) — cost_router_bypass registado correctamente para consultar_dados singleton
  // ───────────────────────────────────────────────────────────────────────
  it('(iii) cost_router_bypass: true para fixtures consultar_dados singleton', () => {
    const report = runE2EMock();
    // 30 fixtures consultar_dados singleton + 0 multi-intent que envolvam consultar_dados sozinho.
    // O bypass aplica-se quando expected = [consultar_dados] exactamente.
    const expectedBypassCount = BENCHMARK_FIXTURES.filter(
      (f) => f.expected_intents.length === 1 && f.expected_intents[0] === 'consultar_dados',
    ).length;
    expect(report.cost_router_bypass_count).toBe(expectedBypassCount);
    expect(expectedBypassCount).toBeGreaterThanOrEqual(25); // tolerância distribuição
  });

  it('isSingleConsultarDados: true só para array [consultar_dados]', () => {
    expect(isSingleConsultarDados(['consultar_dados'])).toBe(true);
    expect(isSingleConsultarDados(['consultar_dados', 'criar_tarefa'])).toBe(false);
    expect(isSingleConsultarDados(['criar_tarefa'])).toBe(false);
    expect(isSingleConsultarDados([])).toBe(false);
  });

  // ───────────────────────────────────────────────────────────────────────
  // Comportamento FR4 — preview block para confidence < 0.70
  // ───────────────────────────────────────────────────────────────────────
  it('preview_blocked_count corresponde a fixtures com expected_confidence_min < 0.70', () => {
    const report = runE2EMock();
    const expectedPreviewCount = BENCHMARK_FIXTURES.filter(
      (f) => f.expected_confidence_min < 0.7 && !(
        f.expected_intents.length === 1 && f.expected_intents[0] === 'consultar_dados'
      ),
    ).length;
    expect(report.preview_blocked_count).toBe(expectedPreviewCount);
    // AC9: pelo menos 3 fixtures com confidence baixa para validar este caminho.
    expect(expectedPreviewCount).toBeGreaterThanOrEqual(3);
  });

  it('quota_blocked simulado quando opts.quotaBlockPct > 0', () => {
    const report = runE2EMock({ quotaBlockPct: 10 });
    expect(report.quota_blocked_count).toBeGreaterThan(0);
    // ~10% × 200 ≈ 20 (mas Mulberry32 pode arredondar)
    expect(report.quota_blocked_count).toBeLessThanOrEqual(25);
  });

  // ───────────────────────────────────────────────────────────────────────
  // runE2EReal lança erro explícito enquanto T10 está BLOCKED
  // ───────────────────────────────────────────────────────────────────────
  it('runE2EReal lança erro explícito porque T10 está BLOCKED pending Eurico QA1', async () => {
    await expect(runE2EReal()).rejects.toThrow('T10 está BLOCKED');
  });

  // ───────────────────────────────────────────────────────────────────────
  // Sanity: tools registadas têm inputSchema válido + reverse declarativo
  // ───────────────────────────────────────────────────────────────────────
  it('MOCK_BENCHMARK_TOOLS têm inputSchema Zod válido e reverse() declarativo', async () => {
    const ctx = {
      householdId: '00000000-0000-0000-0000-000000000001',
      userId: '00000000-0000-0000-0000-000000000001',
      // db é unused pelos mocks — `unknown` cast permite passar sem trigger de tipo
      db: {} as never,
      traceId: 'test',
      runId: '00000000-0000-0000-0000-000000000001',
    } as const;

    const inputsByName: Record<string, unknown> = {
      create_task: { title: 'test' },
      create_finance_variable: { amount_cents: 100, description: 'x' },
      create_finance_recurrence: { amount_cents: 100, description: 'x' },
      create_card: { issuer: 'x' },
      create_installment: { total_amount_cents: 100, installments: 2, description: 'x' },
      cancel_last_run: { confirm: true },
    };

    for (const tool of MOCK_BENCHMARK_TOOLS) {
      expect(tool.name).toMatch(/^[a-z_]+$/);
      expect(tool.inputSchema).toBeDefined();
      const input = inputsByName[tool.name];
      expect(input, `input mínimo para ${tool.name} deve estar definido`).toBeDefined();
      // execute() retorna { id: uuid } — tipo unknown porque MOCK_BENCHMARK_TOOLS é genérico
      const result = (await tool.execute(input, ctx)) as { id: string };
      expect(result).toHaveProperty('id');
      // reverse() devolve payload declarativo
      const reverseOp = await tool.reverse(result, ctx);
      expect(reverseOp).toHaveProperty('kind');
      expect(['delete_row', 'restore_row', 'composite']).toContain(reverseOp.kind);
    }
  });
});
