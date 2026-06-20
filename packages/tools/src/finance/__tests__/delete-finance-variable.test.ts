/**
 * Testes para `delete_finance_variable` tool — preview obrigatório, DELETE +
 * snapshot completo snake_case (com kind enum + transaction_date), reverse_op
 * reinsert_row (FIX-1), guarda is_projected/installment_id, múltiplos matches →
 * lista 3 (R-2.14.2), preview EUR PT-PT (CON9).
 *
 * Trace: Story 2.14 AC4 + AC12.
 */
import { describe, expect, it, vi } from 'vitest';

import type { DrizzleDbClient, ToolExecutionContext } from '@/contracts';
import { ToolExecutionError } from '@/errors';

import { deleteFinanceVariable } from '../delete-finance-variable';

vi.mock('@meu-jarvis/observability', () => ({
  withSpan: vi.fn(async (_n: string, _a: unknown, fn: (s: unknown) => unknown) => {
    const mockSpan = {
      setAttribute: vi.fn(),
      setAttributes: vi.fn(),
      end: vi.fn(),
      recordException: vi.fn(),
      setStatus: vi.fn(),
    };
    return fn(mockSpan);
  }),
  hashForCorrelation: vi.fn((s: string) => `hash_${s.slice(0, 8)}`),
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

interface CapturedExecute {
  readonly sqlText: string;
}
interface MockState {
  executes: CapturedExecute[];
  insertReturns: ReadonlyArray<ReadonlyArray<unknown>>;
}

function captureSqlText(query: unknown): string {
  let sqlText = '';
  const walk = (node: unknown): void => {
    if (typeof node === 'string') {
      sqlText += node;
      return;
    }
    if (!node || typeof node !== 'object') return;
    const obj = node as { queryChunks?: unknown[]; value?: unknown };
    if (Array.isArray(obj.queryChunks)) {
      for (const c of obj.queryChunks) walk(c);
      return;
    }
    const v = obj.value;
    if (Array.isArray(v)) {
      for (const x of v) if (typeof x === 'string') sqlText += x;
    } else if (typeof v === 'string') {
      sqlText += v;
    }
  };
  walk(query);
  return sqlText;
}

function makeMockDb(state: MockState): DrizzleDbClient {
  let i = 0;
  const exec = vi.fn(async (query: unknown) => {
    state.executes.push({ sqlText: captureSqlText(query) });
    const r = state.insertReturns[i] ?? [];
    i += 1;
    return r;
  });
  return {
    transaction: vi.fn() as unknown as DrizzleDbClient['transaction'],
    insert: vi.fn(),
    execute: exec as unknown as DrizzleDbClient['execute'],
  };
}

const TX_ID = '22222222-3333-4444-8555-666666666666';
const HOUSEHOLD_ID = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';
const USER_ID = '99999999-aaaa-4bbb-8ccc-dddddddddddd';

function makeCtx(db: DrizzleDbClient): ToolExecutionContext {
  return {
    householdId: HOUSEHOLD_ID,
    userId: USER_ID,
    db,
    traceId: 'trace_test',
    runId: '88888888-7777-4666-8555-444444444444',
  };
}

function resolvedTx(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: TX_ID,
    household_id: HOUSEHOLD_ID,
    created_by_user_id: USER_ID,
    account_id: 'acc11111-1111-4111-8111-111111111111',
    card_id: null,
    category_id: 'cat11111-1111-4111-8111-111111111111',
    amount_cents: 1200,
    currency: 'EUR',
    kind: 'expense',
    description: 'almoço',
    transaction_date: '2026-06-22',
    payment_method: 'card',
    recurrence_id: null,
    installment_id: null,
    installment_index: null,
    agent_run_id: null,
    notes: null,
    is_projected: false,
    created_at: '2026-06-22T13:00:00Z',
    match_count: 1,
    ...overrides,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Metadata
// ─────────────────────────────────────────────────────────────────────────────

describe('delete_finance_variable — metadata', () => {
  it('nome correcto', () => {
    expect(deleteFinanceVariable.name).toBe('delete_finance_variable');
  });
  it('domínio finance', () => {
    expect(deleteFinanceVariable.domain).toBe('finance');
  });
  it('estimatedTokens = 110', () => {
    expect(deleteFinanceVariable.estimatedTokens).toBe(110);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Preview obrigatório
// ─────────────────────────────────────────────────────────────────────────────

describe('delete_finance_variable — preview obrigatório', () => {
  it('sem confirmed=true → needsConfirmation true, sem DELETE, sem reverse_op', async () => {
    const state: MockState = { executes: [], insertReturns: [[resolvedTx()]] };
    const ctx = makeCtx(makeMockDb(state));
    const out = await deleteFinanceVariable.execute({ description: 'almoço' }, ctx);
    expect(out.needsConfirmation).toBe(true);
    expect(out.snapshot).toBeUndefined();
    expect(state.executes.some((e) => /delete from transactions/i.test(e.sqlText))).toBe(false);
  });

  it('preview() contém "CONFIRMAR"', () => {
    const ctx = makeCtx(makeMockDb({ executes: [], insertReturns: [] }));
    expect(deleteFinanceVariable.preview({ description: 'almoço' }, ctx)).toContain('CONFIRMAR');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// DELETE confirmado + snapshot
// ─────────────────────────────────────────────────────────────────────────────

describe('delete_finance_variable — DELETE confirmado', () => {
  it('confirmed=true → DELETE + snapshot completo snake_case (kind/transaction_date)', async () => {
    const state: MockState = {
      executes: [],
      insertReturns: [[resolvedTx()], []],
    };
    const ctx = makeCtx(makeMockDb(state));
    const out = await deleteFinanceVariable.execute(
      { transactionId: TX_ID, confirmed: true },
      ctx,
    );
    expect(out.needsConfirmation).toBe(false);
    expect(out.snapshot).toBeDefined();
    // snake_case (PO-FIX-1) com enum kind + date (PO-FIX-2 cobre o reinsert no E2E).
    expect(out.snapshot?.kind).toBe('expense');
    expect(out.snapshot?.transaction_date).toBe('2026-06-22');
    expect(out.snapshot?.amount_cents).toBe(1200);
    expect(out.snapshot).not.toHaveProperty('id');
    expect(out.snapshot).not.toHaveProperty('match_count');
    expect(state.executes[1]?.sqlText).toMatch(/delete from transactions/i);
    expect(deleteFinanceVariable.outputSchema.safeParse(out).success).toBe(true);
  });

  it('guarda is_projected=false AND installment_id IS NULL no SELECT', async () => {
    const state: MockState = {
      executes: [],
      insertReturns: [[resolvedTx()], []],
    };
    const ctx = makeCtx(makeMockDb(state));
    await deleteFinanceVariable.execute({ transactionId: TX_ID, confirmed: true }, ctx);
    expect(state.executes[0]?.sqlText).toMatch(/is_projected = false/i);
    expect(state.executes[0]?.sqlText).toMatch(/installment_id is null/i);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// reverse() reinsert_row (FIX-1)
// ─────────────────────────────────────────────────────────────────────────────

describe('delete_finance_variable — reverse() reinsert_row (FIX-1)', () => {
  const ctx = makeCtx(makeMockDb({ executes: [], insertReturns: [] }));
  it('reverse() retorna reinsert_row com id original + snapshot completo', async () => {
    const snapshot = { kind: 'expense', amount_cents: 1200, transaction_date: '2026-06-22' };
    const reverseOp = await deleteFinanceVariable.reverse(
      {
        transactionId: TX_ID,
        description: 'almoço',
        amountCents: 1200,
        transactionDate: '2026-06-22',
        needsConfirmation: false,
        snapshot,
      },
      ctx,
    );
    expect(reverseOp).toMatchObject({
      kind: 'reinsert_row',
      table: 'transactions',
      id: TX_ID,
    });
    if (reverseOp.kind === 'reinsert_row') {
      expect(reverseOp.snapshot).toEqual(snapshot);
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// R-2.14.2 — múltiplos matches → lista 3
// ─────────────────────────────────────────────────────────────────────────────

describe('delete_finance_variable — múltiplos matches (R-2.14.2)', () => {
  it('múltiplos matches sem desambiguador → warning lista até 3 + preview', async () => {
    const state: MockState = {
      executes: [],
      insertReturns: [
        // SELECT de resolução — mais recente + match_count=5
        [resolvedTx({ match_count: 5 })],
        // SELECT listTopMatches — 3 primeiros
        [
          { id: TX_ID, description: 'almoço', amount_cents: 1200, transaction_date: '2026-06-22' },
          { id: 'b2222222-3333-4444-8555-666666666666', description: 'almoço', amount_cents: 900, transaction_date: '2026-06-21' },
          { id: 'c3333333-3333-4444-8555-666666666666', description: 'almoço', amount_cents: 1100, transaction_date: '2026-06-20' },
        ],
      ],
    };
    const ctx = makeCtx(makeMockDb(state));
    const out = await deleteFinanceVariable.execute({ description: 'almoço' }, ctx);
    expect(out.needsConfirmation).toBe(true);
    expect(out.warnings).toBeDefined();
    expect(out.warnings?.[0]).toMatch(/5 transac/);
    // Lista inclui valores EUR PT-PT (vírgula).
    expect(out.warnings?.[0]).toContain('€12,00');
    expect(out.warnings?.[0]).toContain('€9,00');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Erros
// ─────────────────────────────────────────────────────────────────────────────

describe('delete_finance_variable — erros', () => {
  it('zero matches → ToolExecutionError PT-PT', async () => {
    const state: MockState = { executes: [], insertReturns: [[]] };
    const ctx = makeCtx(makeMockDb(state));
    await expect(
      deleteFinanceVariable.execute({ description: 'inexistente', confirmed: true }, ctx),
    ).rejects.toBeInstanceOf(ToolExecutionError);
  });

  it('rejeita parcela (resolver vazio por guarda) → ToolExecutionError', async () => {
    const state: MockState = { executes: [], insertReturns: [[]] };
    const ctx = makeCtx(makeMockDb(state));
    await expect(
      deleteFinanceVariable.execute({ transactionId: TX_ID, confirmed: true }, ctx),
    ).rejects.toBeInstanceOf(ToolExecutionError);
  });
});
