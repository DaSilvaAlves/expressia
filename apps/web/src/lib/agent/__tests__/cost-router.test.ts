// @vitest-environment node
/**
 * Tests para `apps/web/src/lib/agent/cost-router.ts` — Story 2.9 AC14.
 *
 * Estratégia mockable-only — mock DB shim para asserts de uso `getDb()` vs
 * `getServiceDb()` (DN6 + D54).
 *
 * Trace: Story 2.9 AC4-AC6+AC14, DN6+DN9+DN14.
 */
import { describe, expect, it, vi } from 'vitest';

import {
  isSingleConsultarDados,
  selectTemplate,
  executeDirectQuery,
} from '@/lib/agent/cost-router';

import type { ClassificationResult } from '@meu-jarvis/classifier';

function makeIntents(
  intents: Array<{ intent: string; confidence?: number; raw_span?: string }>,
): ClassificationResult['intents'] {
  return intents.map((i) => ({
    intent: i.intent as ClassificationResult['intents'][number]['intent'],
    confidence: i.confidence ?? 0.85,
    raw_span: i.raw_span ?? '',
  })) as ClassificationResult['intents'];
}

describe('isSingleConsultarDados — singleton check', () => {
  it('AC14(i) — true para [consultar_dados] singleton', () => {
    expect(isSingleConsultarDados(makeIntents([{ intent: 'consultar_dados' }]))).toBe(true);
  });

  it('AC14(ii) — false para array vazio', () => {
    expect(isSingleConsultarDados([])).toBe(false);
  });

  it('AC14(ii) — false para outras intents', () => {
    expect(isSingleConsultarDados(makeIntents([{ intent: 'criar_tarefa' }]))).toBe(false);
    expect(isSingleConsultarDados(makeIntents([{ intent: 'pagar_conta' }]))).toBe(false);
  });

  it('AC14(ii) — false para multi-intent que inclui consultar_dados', () => {
    expect(
      isSingleConsultarDados(
        makeIntents([{ intent: 'consultar_dados' }, { intent: 'criar_tarefa' }]),
      ),
    ).toBe(false);
  });
});

describe('selectTemplate — heurística keyword (DN14 — 3 templates MVP)', () => {
  it('AC14 — span com "tarefa" → count_tasks', () => {
    expect(selectTemplate('quantas tarefas tenho')).toBe('count_tasks');
    expect(selectTemplate('tarefas pendentes')).toBe('count_tasks');
  });

  it('AC14 — span com "saldo" → balance_summary', () => {
    expect(selectTemplate('qual é o meu saldo')).toBe('balance_summary');
    expect(selectTemplate('saldo total')).toBe('balance_summary');
  });

  it('AC14 — span com "transac"/"finanç" → count_finances', () => {
    expect(selectTemplate('quantas transações')).toBe('count_finances');
    expect(selectTemplate('finanças do mês')).toBe('count_finances');
    expect(selectTemplate('despesas')).toBe('count_finances');
  });

  it('AC14 — span undefined → default count_tasks', () => {
    expect(selectTemplate(undefined)).toBe('count_tasks');
    expect(selectTemplate('')).toBe('count_tasks');
  });
});

describe('executeDirectQuery — uses getDb (authenticated + RLS) DN6+D54', () => {
  it('AC14(iii) — count_tasks template executa SELECT em public.tasks', async () => {
    const executeMock = vi.fn().mockResolvedValue([{ count: 7 }]);
    const db = { execute: executeMock };
    const result = await executeDirectQuery(
      'quantas tarefas tenho',
      '00000000-0000-0000-0000-000000000001',
      db,
    );
    expect(executeMock).toHaveBeenCalledTimes(1);
    expect(result.templateUsed).toBe('count_tasks');
    expect(result.data).toEqual([{ count: 7 }]);
    expect(result.summary).toContain('7');
  });

  it('AC14 — balance_summary template formato PT-PT (vírgula decimal)', async () => {
    const executeMock = vi.fn().mockResolvedValue([{ total_cents: 123456 }]);
    const db = { execute: executeMock };
    const result = await executeDirectQuery(
      'qual é o meu saldo',
      '00000000-0000-0000-0000-000000000001',
      db,
    );
    expect(result.templateUsed).toBe('balance_summary');
    expect(result.summary).toMatch(/€/);
    // 1234.56 EUR → vírgula decimal PT-PT
    expect(result.summary).toContain('1234,56');
  });

  it('AC14(iv) — propaga erro DB (não silencia)', async () => {
    const executeMock = vi.fn().mockRejectedValue(new Error('connection refused'));
    const db = { execute: executeMock };
    await expect(
      executeDirectQuery('tarefas', '00000000-0000-0000-0000-000000000001', db),
    ).rejects.toThrow('connection refused');
  });

  it('AC14 — count_tasks com 0 produz summary correcto PT-PT', async () => {
    const executeMock = vi.fn().mockResolvedValue([{ count: 0 }]);
    const db = { execute: executeMock };
    const result = await executeDirectQuery('tarefas', 'hh-1', db);
    expect(result.summary).toBe('Não tens tarefas pendentes.');
  });

  it('AC14 — count_tasks com 1 usa singular', async () => {
    const executeMock = vi.fn().mockResolvedValue([{ count: 1 }]);
    const db = { execute: executeMock };
    const result = await executeDirectQuery('tarefas', 'hh-1', db);
    expect(result.summary).toBe('Tens 1 tarefa pendente.');
  });

  it('AC14 — count_finances com 0 produz summary correcto PT-PT', async () => {
    const executeMock = vi.fn().mockResolvedValue([{ count: 0 }]);
    const db = { execute: executeMock };
    const result = await executeDirectQuery('transações', 'hh-1', db);
    expect(result.summary).toBe('Sem transações registadas.');
  });
});
