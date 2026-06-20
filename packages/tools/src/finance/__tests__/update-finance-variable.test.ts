/**
 * Testes para `update_finance_variable` tool — resolução (transactionId/fuzzy +
 * desambiguadores), guarda is_projected/installment_id, snapshot snake_case
 * (PO-FIX-1), reverse_op restore_row, preview EUR PT-PT (CON9), RLS.
 *
 * Trace: Story 2.14 AC3 + AC12.
 */
import { describe, expect, it, vi } from 'vitest';

import type { DrizzleDbClient, ToolExecutionContext } from '@/contracts';
import { ToolExecutionError } from '@/errors';

import { updateFinanceVariable } from '../update-finance-variable';

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
const CAT_ID = 'cccccccc-1111-4222-8333-444444444444';

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
    amount_cents: 500,
    description: 'café',
    transaction_date: '2026-06-19',
    category_id: CAT_ID,
    payment_method: 'cash',
    match_count: 1,
    ...overrides,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Metadata + validation
// ─────────────────────────────────────────────────────────────────────────────

describe('update_finance_variable — metadata', () => {
  it('nome correcto', () => {
    expect(updateFinanceVariable.name).toBe('update_finance_variable');
  });
  it('domínio finance', () => {
    expect(updateFinanceVariable.domain).toBe('finance');
  });
  it('estimatedTokens = 110', () => {
    expect(updateFinanceVariable.estimatedTokens).toBe(110);
  });
});

describe('update_finance_variable — validation', () => {
  it('rejeita sem identificador', () => {
    expect(updateFinanceVariable.inputSchema.safeParse({ newAmountCents: 100 }).success).toBe(false);
  });
  it('rejeita sem campo new*', () => {
    expect(updateFinanceVariable.inputSchema.safeParse({ transactionId: TX_ID }).success).toBe(false);
  });
  it('rejeita newAmountCents não positivo', () => {
    expect(
      updateFinanceVariable.inputSchema.safeParse({ transactionId: TX_ID, newAmountCents: -5 }).success,
    ).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// execute
// ─────────────────────────────────────────────────────────────────────────────

describe('update_finance_variable — execute', () => {
  it('resolve por transactionId → UPDATE + snapshot snake_case', async () => {
    const state: MockState = {
      executes: [],
      insertReturns: [[resolvedTx()], [{ id: TX_ID }]],
    };
    const ctx = makeCtx(makeMockDb(state));
    const out = await updateFinanceVariable.execute(
      { transactionId: TX_ID, newAmountCents: 350 },
      ctx,
    );
    expect(out.transactionId).toBe(TX_ID);
    expect(out.updatedFields).toContain('amount_cents');
    expect(out.snapshot).toEqual({ amount_cents: 500 });
    // Guarda is_projected/installment_id no SELECT.
    expect(state.executes[0]?.sqlText).toMatch(/is_projected = false/i);
    expect(state.executes[0]?.sqlText).toMatch(/installment_id is null/i);
    expect(updateFinanceVariable.outputSchema.safeParse(out).success).toBe(true);
  });

  it('fuzzy por description sem desambiguadores → mais recente', async () => {
    const state: MockState = {
      executes: [],
      insertReturns: [[resolvedTx()], [{ id: TX_ID }]],
    };
    const ctx = makeCtx(makeMockDb(state));
    const out = await updateFinanceVariable.execute(
      { description: 'café', newDescription: 'café da manhã' },
      ctx,
    );
    expect(out.updatedFields).toContain('description');
    expect(state.executes[0]?.sqlText).toMatch(/order by transaction_date desc/i);
  });

  it('fuzzy + transactionDate desambiguador → SQL inclui filtro de data', async () => {
    const state: MockState = {
      executes: [],
      insertReturns: [[resolvedTx()], [{ id: TX_ID }]],
    };
    const ctx = makeCtx(makeMockDb(state));
    await updateFinanceVariable.execute(
      { description: 'café', transactionDate: '2026-06-19', newAmountCents: 350 },
      ctx,
    );
    expect(state.executes[0]?.sqlText).toMatch(/transaction_date = /i);
  });

  it('fuzzy + amountCents desambiguador → SQL inclui filtro de valor', async () => {
    const state: MockState = {
      executes: [],
      insertReturns: [[resolvedTx()], [{ id: TX_ID }]],
    };
    const ctx = makeCtx(makeMockDb(state));
    await updateFinanceVariable.execute(
      { description: 'café', amountCents: 500, newAmountCents: 350 },
      ctx,
    );
    expect(state.executes[0]?.sqlText).toMatch(/amount_cents = /i);
  });

  it('rejeita transacção projectada/parcela → ToolExecutionError PT-PT', async () => {
    // Resolver devolve vazio porque a guarda is_projected=false filtra a row.
    const state: MockState = { executes: [], insertReturns: [[]] };
    const ctx = makeCtx(makeMockDb(state));
    await expect(
      updateFinanceVariable.execute({ transactionId: TX_ID, newAmountCents: 350 }, ctx),
    ).rejects.toBeInstanceOf(ToolExecutionError);
  });

  it('zero matches fuzzy → ToolExecutionError PT-PT', async () => {
    const state: MockState = { executes: [], insertReturns: [[]] };
    const ctx = makeCtx(makeMockDb(state));
    await expect(
      updateFinanceVariable.execute({ description: 'inexistente', newAmountCents: 100 }, ctx),
    ).rejects.toBeInstanceOf(ToolExecutionError);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// reverse + preview
// ─────────────────────────────────────────────────────────────────────────────

describe('update_finance_variable — reverse() restore_row', () => {
  const ctx = makeCtx(makeMockDb({ executes: [], insertReturns: [] }));
  it('reverse() retorna restore_row com snapshot snake_case', async () => {
    const reverseOp = await updateFinanceVariable.reverse(
      { transactionId: TX_ID, updatedFields: ['amount_cents'], snapshot: { amount_cents: 500 } },
      ctx,
    );
    expect(reverseOp).toMatchObject({ kind: 'restore_row', table: 'transactions', id: TX_ID });
    if (reverseOp.kind === 'restore_row') {
      expect(reverseOp.snapshot).toEqual({ amount_cents: 500 });
    }
  });
});

describe('update_finance_variable — preview EUR PT-PT (CON9)', () => {
  const ctx = makeCtx(makeMockDb({ executes: [], insertReturns: [] }));
  it('preview com vírgula decimal no novo valor', () => {
    const out = updateFinanceVariable.preview(
      { description: 'café', newAmountCents: 350 },
      ctx,
    );
    expect(out).toContain('€3,50');
    expect(out.toLowerCase()).toContain('actualizar');
  });
});
