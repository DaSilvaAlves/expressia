/**
 * Tests do OTel tracing (whitelist + zero PII).
 *
 * Trace: Story 2.5 AC9 + AC13.
 */
import type { Span } from '@opentelemetry/api';

import { describe, expect, it, vi } from 'vitest';

import {
  EXECUTOR_SPAN_ATTRIBUTE_KEYS,
  PLANNER_SPAN_ATTRIBUTE_KEYS,
  annotateExecutorMetrics,
  annotatePlannerMetrics,
} from '@/tracing';

const VALID_HOUSEHOLD_ID = '11111111-1111-1111-1111-111111111111';
const VALID_RUN_ID = '22222222-2222-2222-2222-222222222222';

function createMockSpan(): { span: Span; attrs: Record<string, unknown> } {
  const attrs: Record<string, unknown> = {};
  const span = {
    setAttribute: vi.fn((key: string, value: unknown) => {
      attrs[key] = value;
    }),
  } as unknown as Span;
  return { span, attrs };
}

describe('PLANNER_SPAN_ATTRIBUTE_KEYS — whitelist 12 keys', () => {
  it('contém exactamente 12 keys imutáveis', () => {
    expect(PLANNER_SPAN_ATTRIBUTE_KEYS).toHaveLength(12);
    expect(PLANNER_SPAN_ATTRIBUTE_KEYS).toContain('planner.model');
    expect(PLANNER_SPAN_ATTRIBUTE_KEYS).toContain('planner.cache_hit');
    expect(PLANNER_SPAN_ATTRIBUTE_KEYS).toContain('planner.cost_eur');
    expect(PLANNER_SPAN_ATTRIBUTE_KEYS).toContain('planner.household_hash');
  });

  it('annotatePlannerMetrics SÓ usa keys da whitelist (zero PII)', () => {
    const { span, attrs } = createMockSpan();
    annotatePlannerMetrics(span, {
      model: 'claude-sonnet-4-5',
      intentCount: 2,
      intentUniqueTypes: 2,
      toolCallCount: 2,
      cacheHit: true,
      durationMs: 1500,
      tokensInput: 500,
      tokensOutput: 50,
      costEur: 0.001,
      householdId: VALID_HOUSEHOLD_ID,
    });

    const usedKeys = new Set(Object.keys(attrs));
    for (const key of usedKeys) {
      expect(PLANNER_SPAN_ATTRIBUTE_KEYS).toContain(key);
    }

    // Zero PII: householdId raw NÃO aparece
    expect(JSON.stringify(attrs)).not.toContain(VALID_HOUSEHOLD_ID);
    // Mas household_hash existe
    expect(attrs['planner.household_hash']).toBeDefined();
    expect(typeof attrs['planner.household_hash']).toBe('string');
    expect(attrs['planner.household_hash']).not.toBe(VALID_HOUSEHOLD_ID);
  });
});

describe('EXECUTOR_SPAN_ATTRIBUTE_KEYS — whitelist 8 keys', () => {
  it('contém exactamente 8 keys imutáveis', () => {
    expect(EXECUTOR_SPAN_ATTRIBUTE_KEYS).toHaveLength(8);
    expect(EXECUTOR_SPAN_ATTRIBUTE_KEYS).toContain('executor.tool_count');
    expect(EXECUTOR_SPAN_ATTRIBUTE_KEYS).toContain('executor.rolled_back');
    expect(EXECUTOR_SPAN_ATTRIBUTE_KEYS).toContain('executor.run_id');
    expect(EXECUTOR_SPAN_ATTRIBUTE_KEYS).toContain('executor.household_hash');
  });

  it('annotateExecutorMetrics SÓ usa keys da whitelist (zero PII)', () => {
    const { span, attrs } = createMockSpan();
    annotateExecutorMetrics(span, {
      toolCount: 3,
      durationMs: 800,
      success: true,
      rolledBack: false,
      reverseOpCount: 3,
      runId: VALID_RUN_ID,
      householdId: VALID_HOUSEHOLD_ID,
    });

    const usedKeys = new Set(Object.keys(attrs));
    for (const key of usedKeys) {
      expect(EXECUTOR_SPAN_ATTRIBUTE_KEYS).toContain(key);
    }

    // householdId raw NÃO presente
    expect(JSON.stringify(attrs)).not.toContain(VALID_HOUSEHOLD_ID);
    expect(attrs['executor.household_hash']).toBeDefined();

    // runId presente (UUID — não PII, é referência interna a agent_runs.id)
    expect(attrs['executor.run_id']).toBe(VALID_RUN_ID);
  });

  it('annotateExecutorMetrics em failure inclui failed_tool_name', () => {
    const { span, attrs } = createMockSpan();
    annotateExecutorMetrics(span, {
      toolCount: 3,
      durationMs: 100,
      success: false,
      rolledBack: true,
      failedToolName: 'create_task',
      reverseOpCount: 0,
      runId: VALID_RUN_ID,
      householdId: VALID_HOUSEHOLD_ID,
    });

    expect(attrs['executor.failed_tool_name']).toBe('create_task');
    expect(attrs['executor.success']).toBe(false);
    expect(attrs['executor.rolled_back']).toBe(true);
  });
});
