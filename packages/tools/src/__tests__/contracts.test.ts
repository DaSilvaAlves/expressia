/**
 * Testes para contratos públicos (`ReverseOpPayload`, serialização, enums).
 *
 * Trace: Story 2.3 AC2 + AC4 + AC11 (≥6 testes em contracts.test.ts).
 */
import { describe, expect, it } from 'vitest';

import {
  COMPOSITE_REVERSE_OP_MAX_OPS,
  deserializeReverseOp,
  PLAN_TIER_VALUES,
  PlanTierSchema,
  ReverseOpPayloadSchema,
  serializeReverseOp,
  ToolDomainSchema,
  TOOL_DOMAIN_VALUES,
  type ReverseOpPayload,
} from '@/contracts';
import { ToolValidationError } from '@/errors';

describe('ReverseOpPayload — round-trip serialização', () => {
  it('round-trip variante delete_row', () => {
    const op: ReverseOpPayload = {
      kind: 'delete_row',
      table: 'tasks',
      id: '11111111-1111-4111-8111-111111111111',
    };
    const round = deserializeReverseOp(serializeReverseOp(op));
    expect(round).toEqual(op);
  });

  it('round-trip variante restore_row com snapshot multi-campo', () => {
    const op: ReverseOpPayload = {
      kind: 'restore_row',
      table: 'transactions',
      id: '22222222-2222-4222-8222-222222222222',
      snapshot: {
        amount_cents: 870,
        category_id: '33333333-3333-4333-8333-333333333333',
        notes: 'compra anterior',
      },
    };
    const round = deserializeReverseOp(serializeReverseOp(op));
    expect(round).toEqual(op);
  });

  it('round-trip variante composite com 3 sub-ops', () => {
    const op: ReverseOpPayload = {
      kind: 'composite',
      ops: [
        { kind: 'delete_row', table: 'installments', id: '44444444-4444-4444-8444-444444444444' },
        { kind: 'delete_row', table: 'installments', id: '55555555-5555-4555-8555-555555555555' },
        { kind: 'delete_row', table: 'transactions', id: '66666666-6666-4666-8666-666666666666' },
      ],
    };
    const round = deserializeReverseOp(serializeReverseOp(op));
    expect(round).toEqual(op);
  });

  it('round-trip variante external_call delete_event (Story J-5)', () => {
    const op: ReverseOpPayload = {
      kind: 'external_call',
      provider: 'google_calendar',
      operation: 'delete_event',
      eventId: 'evt_abc123',
    };
    const round = deserializeReverseOp(serializeReverseOp(op));
    expect(round).toEqual(op);
  });

  it('round-trip variante external_call restore_event com horários originais (Story J-5)', () => {
    const op: ReverseOpPayload = {
      kind: 'external_call',
      provider: 'google_calendar',
      operation: 'restore_event',
      eventId: 'evt_xyz789',
      originalStart: '2026-06-27T10:00:00+01:00',
      originalEnd: '2026-06-27T11:00:00+01:00',
    };
    const round = deserializeReverseOp(serializeReverseOp(op));
    expect(round).toEqual(op);
  });

  it('round-trip composite aninhado (1 nível) — guard per-level passa', () => {
    const op: ReverseOpPayload = {
      kind: 'composite',
      ops: [
        {
          kind: 'composite',
          ops: [
            { kind: 'delete_row', table: 'a', id: '77777777-7777-4777-8777-777777777777' },
            { kind: 'delete_row', table: 'a', id: '88888888-8888-4888-8888-888888888888' },
          ],
        },
        { kind: 'delete_row', table: 'b', id: '99999999-9999-4999-8999-999999999999' },
      ],
    };
    const round = deserializeReverseOp(serializeReverseOp(op));
    expect(round).toEqual(op);
  });
});

describe('ReverseOpPayload — guard composite max ops', () => {
  it('composite com EXACTAMENTE 10 ops aceita (limite inclusivo)', () => {
    const ops = Array.from({ length: COMPOSITE_REVERSE_OP_MAX_OPS }, (_, i) => ({
      kind: 'delete_row' as const,
      table: 'x',
      id: `00000000-0000-4000-8000-${String(i).padStart(12, '0')}`,
    }));
    const op: ReverseOpPayload = { kind: 'composite', ops };
    expect(() => serializeReverseOp(op)).not.toThrow();
  });

  it('composite com 11 ops é REJEITADO via ToolValidationError', () => {
    const ops = Array.from({ length: COMPOSITE_REVERSE_OP_MAX_OPS + 1 }, (_, i) => ({
      kind: 'delete_row' as const,
      table: 'x',
      id: `00000000-0000-4000-8000-${String(i).padStart(12, '0')}`,
    }));
    const op = { kind: 'composite' as const, ops };
    expect(() => serializeReverseOp(op)).toThrow(ToolValidationError);
  });

  it('guard per-level: composite com nested composite oversize falha', () => {
    const innerOps = Array.from({ length: COMPOSITE_REVERSE_OP_MAX_OPS + 1 }, (_, i) => ({
      kind: 'delete_row' as const,
      table: 'x',
      id: `00000000-0000-4000-8000-${String(i).padStart(12, '0')}`,
    }));
    const op = {
      kind: 'composite' as const,
      ops: [
        { kind: 'composite' as const, ops: innerOps },
      ],
    };
    expect(() => serializeReverseOp(op)).toThrow(ToolValidationError);
  });
});

describe('deserializeReverseOp — input inválido', () => {
  it('JSON não-parseável → ToolValidationError', () => {
    expect(() => deserializeReverseOp('not-json-{')).toThrow(ToolValidationError);
  });

  it('JSON válido mas kind desconhecido → ToolValidationError', () => {
    expect(() =>
      deserializeReverseOp(JSON.stringify({ kind: 'truncate_table', table: 'x' })),
    ).toThrow(ToolValidationError);
  });

  it('JSON com delete_row sem `id` UUID válido → ToolValidationError', () => {
    expect(() =>
      deserializeReverseOp(JSON.stringify({ kind: 'delete_row', table: 'x', id: 'not-a-uuid' })),
    ).toThrow(ToolValidationError);
  });

  it('serialização rejeita payload null/undefined', () => {
    expect(() => serializeReverseOp(null as unknown as ReverseOpPayload)).toThrow(
      ToolValidationError,
    );
  });
});

describe('Enums — coerência runtime', () => {
  it('TOOL_DOMAIN_VALUES tem exactamente 7 entries (Story M-1 +memory)', () => {
    expect(TOOL_DOMAIN_VALUES.length).toBe(7);
    expect([...TOOL_DOMAIN_VALUES]).toEqual([
      'tasks',
      'finance',
      'query',
      'system',
      'calendar',
      'email',
      'memory',
    ]);
  });

  it('ToolDomainSchema aceita os 7 valores e rejeita outros', () => {
    expect(() => ToolDomainSchema.parse('tasks')).not.toThrow();
    expect(() => ToolDomainSchema.parse('finance')).not.toThrow();
    expect(() => ToolDomainSchema.parse('calendar')).not.toThrow();
    expect(() => ToolDomainSchema.parse('email')).not.toThrow();
    expect(() => ToolDomainSchema.parse('memory')).not.toThrow();
    expect(() => ToolDomainSchema.parse('invalid')).toThrow();
  });

  it('PLAN_TIER_VALUES tem exactamente 4 entries alinhadas com plan_tier enum', () => {
    expect(PLAN_TIER_VALUES.length).toBe(4);
    expect([...PLAN_TIER_VALUES]).toEqual(['free', 'pessoal', 'familia', 'pro']);
  });

  it('PlanTierSchema rejeita valores inválidos', () => {
    expect(() => PlanTierSchema.parse('free')).not.toThrow();
    expect(() => PlanTierSchema.parse('familia')).not.toThrow();
    expect(() => PlanTierSchema.parse('enterprise')).toThrow();
  });

  it('ReverseOpPayloadSchema — discriminated union explícita', () => {
    expect(
      ReverseOpPayloadSchema.safeParse({
        kind: 'delete_row',
        table: 'tasks',
        id: '11111111-1111-4111-8111-111111111111',
      }).success,
    ).toBe(true);
    expect(
      ReverseOpPayloadSchema.safeParse({
        kind: 'unknown',
        foo: 'bar',
      }).success,
    ).toBe(false);
  });
});
