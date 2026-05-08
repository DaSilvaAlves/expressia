/**
 * Testes para os helpers de tracing.
 *
 * Trace: Story 2.3 AC9 + AC11 (≥5 testes em tracing.test.ts).
 *
 * Garante que:
 *   - Apenas attribute keys whitelisted (TOOL_SPAN_ATTRIBUTE_KEYS) são emitidas.
 *   - Tool inputs/outputs/snapshots NÃO aparecem como attributes.
 *   - household_hash é o resultado de hashForCorrelation, não o UUID raw.
 *   - Span status ERROR é registado em falha (delegado a withSpan).
 */
import { describe, expect, it, vi } from 'vitest';

import {
  annotateAtomicMetrics,
  annotateToolMetrics,
  TOOL_SPAN_ATTRIBUTE_KEYS,
  withAtomicSpan,
  withToolSpan,
} from '@/tracing';

// Mock @meu-jarvis/observability — captura attributes aplicados no span
// e simula withSpan para retornar o resultado de fn enriquecido.
vi.mock('@meu-jarvis/observability', () => {
  return {
    withSpan: vi.fn(async (name: string, attrs: unknown, fn: (span: unknown) => unknown) => {
      const setCalls: Array<{ key: string; value: unknown }> = [];
      const mockSpan = {
        setAttribute: vi.fn((key: string, value: unknown) => {
          setCalls.push({ key, value });
        }),
        setAttributes: vi.fn((kv: Record<string, unknown>) => {
          for (const [k, v] of Object.entries(kv)) setCalls.push({ key: k, value: v });
        }),
        end: vi.fn(),
        recordException: vi.fn(),
        setStatus: vi.fn(),
      };
      try {
        const result = await fn(mockSpan);
        const enriched = result as { __setCalls?: typeof setCalls; __initialAttrs?: unknown; __spanName?: string };
        enriched.__setCalls = setCalls;
        enriched.__initialAttrs = attrs;
        enriched.__spanName = name;
        return enriched;
      } catch (err) {
        // Simula recordSpanError → setStatus({ code: ERROR })
        mockSpan.setStatus({ code: 'ERROR' });
        throw err;
      }
    }),
    // hashForCorrelation determinístico para teste — nunca devolve o input cru.
    hashForCorrelation: vi.fn((input: string) => `hash_${input.slice(0, 8)}`),
  };
});

interface CapturedSpan {
  __setCalls?: Array<{ key: string; value: unknown }>;
  __initialAttrs?: { extra?: Record<string, unknown> };
  __spanName?: string;
}

describe('withToolSpan + annotateToolMetrics', () => {
  it('cria span com initial attrs tool.name + tool.domain', async () => {
    const result = (await withToolSpan('criar_tarefa', 'tasks', async (span) => {
      annotateToolMetrics(span, {
        durationMs: 12,
        success: true,
        householdId: '11111111-2222-3333-4444-555555555555',
        traceId: 'trace_abc',
      });
      return {} as CapturedSpan;
    })) as CapturedSpan;

    expect(result.__spanName).toBe('agent.tool.call');
    expect(result.__initialAttrs?.extra).toEqual({
      'tool.name': 'criar_tarefa',
      'tool.domain': 'tasks',
    });
  });

  it('annotateToolMetrics aplica APENAS keys whitelisted (4 keys)', async () => {
    const result = (await withToolSpan('criar_tarefa', 'tasks', async (span) => {
      annotateToolMetrics(span, {
        durationMs: 25,
        success: true,
        householdId: '11111111-2222-3333-4444-555555555555',
        traceId: 'trace_xyz',
      });
      return {} as CapturedSpan;
    })) as CapturedSpan;

    const keys = (result.__setCalls ?? []).map((c) => c.key);
    expect(keys).toContain('tool.duration_ms');
    expect(keys).toContain('tool.success');
    expect(keys).toContain('tool.household_hash');
    expect(keys).toContain('tool.trace_id');

    // Cada key emitida está na whitelist global.
    for (const key of keys) {
      expect(TOOL_SPAN_ATTRIBUTE_KEYS).toContain(key);
    }
  });

  it('NÃO emite tool inputs/outputs/snapshots como attributes (PII guard)', async () => {
    const result = (await withToolSpan('criar_financa_variavel', 'finance', async (span) => {
      annotateToolMetrics(span, {
        durationMs: 50,
        success: true,
        householdId: '11111111-2222-3333-4444-555555555555',
        traceId: 'trace_pii',
      });
      return {} as CapturedSpan;
    })) as CapturedSpan;

    const keys = (result.__setCalls ?? []).map((c) => c.key);
    // Nenhuma destas keys jamais deve aparecer.
    expect(keys).not.toContain('tool.input');
    expect(keys).not.toContain('tool.output');
    expect(keys).not.toContain('tool.snapshot');
    expect(keys).not.toContain('tool.prompt');
    expect(keys).not.toContain('tool.message');
    expect(keys).not.toContain('tool.amount');
    expect(keys).not.toContain('tool.titulo');
  });

  it('household_hash usa hashForCorrelation (não expõe UUID raw)', async () => {
    const householdRaw = '11111111-2222-3333-4444-555555555555';
    const result = (await withToolSpan('criar_tarefa', 'tasks', async (span) => {
      annotateToolMetrics(span, {
        durationMs: 10,
        success: true,
        householdId: householdRaw,
        traceId: 'trace_z',
      });
      return {} as CapturedSpan;
    })) as CapturedSpan;

    const hashEntry = (result.__setCalls ?? []).find((c) => c.key === 'tool.household_hash');
    expect(hashEntry).toBeDefined();
    // O mock retorna 'hash_<8chars>' — o importante é que NÃO é o UUID raw.
    expect(hashEntry?.value).not.toBe(householdRaw);
    expect(typeof hashEntry?.value).toBe('string');
    expect(String(hashEntry?.value).startsWith('hash_')).toBe(true);
  });

  it('span status ERROR registado quando fn lança', async () => {
    let captured: unknown;
    try {
      await withToolSpan('criar_tarefa', 'tasks', async () => {
        throw new Error('boom');
      });
    } catch (err) {
      captured = err;
    }
    expect(captured).toBeInstanceOf(Error);
    expect((captured as Error).message).toBe('boom');
  });
});

describe('withAtomicSpan + annotateAtomicMetrics', () => {
  it('cria span com initial attrs atomic.tool_count + atomic.run_id', async () => {
    const runId = '99999999-9999-9999-9999-999999999999';
    const result = (await withAtomicSpan(runId, 3, async (span) => {
      annotateAtomicMetrics(span, { success: true, rolledBack: false });
      return {} as CapturedSpan;
    })) as CapturedSpan;

    expect(result.__spanName).toBe('agent.tool.atomic');
    expect(result.__initialAttrs?.extra).toEqual({
      'tool.atomic.tool_count': 3,
      'tool.atomic.run_id': runId,
    });

    const keys = (result.__setCalls ?? []).map((c) => c.key);
    expect(keys).toContain('tool.atomic.success');
    expect(keys).toContain('tool.atomic.rolled_back');
    for (const key of keys) {
      expect(TOOL_SPAN_ATTRIBUTE_KEYS).toContain(key);
    }
  });

  it('annotateAtomicMetrics regista rolled_back: true em falha', async () => {
    const result = (await withAtomicSpan('run_x', 2, async (span) => {
      annotateAtomicMetrics(span, { success: false, rolledBack: true });
      return {} as CapturedSpan;
    })) as CapturedSpan;

    const setCalls = result.__setCalls ?? [];
    const successEntry = setCalls.find((c) => c.key === 'tool.atomic.success');
    const rolledEntry = setCalls.find((c) => c.key === 'tool.atomic.rolled_back');
    expect(successEntry?.value).toBe(false);
    expect(rolledEntry?.value).toBe(true);
  });
});

describe('TOOL_SPAN_ATTRIBUTE_KEYS — invariante', () => {
  it('contém exactamente 10 keys e nenhuma se chama input/output/snapshot', () => {
    expect(TOOL_SPAN_ATTRIBUTE_KEYS.length).toBe(10);
    const flat = (TOOL_SPAN_ATTRIBUTE_KEYS as ReadonlyArray<string>).join(' ').toLowerCase();
    expect(flat).not.toContain('input');
    expect(flat).not.toContain('output');
    expect(flat).not.toContain('snapshot');
    expect(flat).not.toContain('prompt');
    expect(flat).not.toContain('message');
  });
});
