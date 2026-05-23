/**
 * Testes para `create_installment` — a mais complexa das 5 tools.
 *
 * Foco AC8 (≥24 testes):
 *   - Cálculo R-4.1 (delegado a installment-split mas verificado via outputs)
 *   - addMonthsSafe(firstInstallmentOn, i-1) — F4
 *   - 1 installment + N transactions criadas (DP8=A — atomicidade testada via executeAtomic)
 *   - Composite reverse_op aninhado D-4.10.4 — limite per-level + ordem FIFO crítica
 *
 * Trace: Story 4.10 AC4 + AC8 + R-4.10.1/3/4.
 */
import { describe, expect, it, vi } from 'vitest';

import {
  COMPOSITE_REVERSE_OP_MAX_OPS,
  ReverseOpPayloadSchema,
  type DrizzleDbClient,
  type ReverseOpPayload,
  type ToolExecutionContext,
} from '@/contracts';
import { executeAtomic } from '@/atomic';

import { createInstallment } from '../create-installment';

vi.mock('@meu-jarvis/observability', () => ({
  withSpan: vi.fn(
    async (_n: string, _a: unknown, fn: (s: unknown) => unknown) => {
      const s = {
        setAttribute: vi.fn(),
        setAttributes: vi.fn(),
        end: vi.fn(),
        recordException: vi.fn(),
        setStatus: vi.fn(),
      };
      return fn(s);
    },
  ),
  hashForCorrelation: vi.fn((s: string) => `hash_${s.slice(0, 8)}`),
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

interface MockState {
  executes: { sqlText: string }[];
  insertReturns: ReadonlyArray<ReadonlyArray<unknown>>;
  throwOnExecuteIndex?: number;
}

function captureSqlText(query: unknown): string {
  let s = '';
  const walk = (n: unknown): void => {
    if (typeof n === 'string') {
      s += n;
      return;
    }
    if (!n || typeof n !== 'object') return;
    const o = n as { queryChunks?: unknown[]; value?: unknown };
    if (Array.isArray(o.queryChunks)) {
      for (const c of o.queryChunks) walk(c);
      return;
    }
    const v = o.value;
    if (Array.isArray(v)) for (const x of v) if (typeof x === 'string') s += x;
    else if (typeof v === 'string') s += v;
  };
  walk(query);
  return s;
}

function makeMockDb(state: MockState): DrizzleDbClient {
  let i = 0;
  const exec = vi.fn(async (q: unknown) => {
    const idx = i;
    state.executes.push({ sqlText: captureSqlText(q) });
    i += 1;
    if (state.throwOnExecuteIndex === idx) {
      throw new Error('simulated DB error at execute ' + String(idx));
    }
    return state.insertReturns[idx] ?? [];
  });
  const dbClient: DrizzleDbClient = {
    transaction: vi.fn(async <T,>(fn: (tx: DrizzleDbClient) => Promise<T>) =>
      fn(dbClient),
    ) as unknown as DrizzleDbClient['transaction'],
    insert: vi.fn(),
    execute: exec as unknown as DrizzleDbClient['execute'],
  };
  return dbClient;
}

const INSTALLMENT_ID = '11111111-2222-4333-8444-555555555555';
const CARD_ID = '33333333-4444-4555-8666-777777777777';
const CATEGORY_ID = '44444444-5555-4666-8777-888888888888';
const DEFAULT_CATEGORY_ID = '55555555-6666-4777-8888-999999999999';
const HOUSEHOLD_ID = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';
const USER_ID = '99999999-aaaa-4bbb-8ccc-dddddddddddd';
const RUN_ID = '88888888-7777-4666-8555-444444444444';

function txId(i: number): string {
  const padded = String(i).padStart(12, '0');
  return `aaaabbbb-1111-4222-8333-${padded}`;
}

function makeCtx(db: DrizzleDbClient): ToolExecutionContext {
  return {
    householdId: HOUSEHOLD_ID,
    userId: USER_ID,
    db,
    traceId: 'trace_test',
    runId: RUN_ID,
  };
}

/**
 * Constroi insertReturns para um execute() com N parcelas:
 *   - 1 SELECT default category (só se categoryId omitido)
 *   - 1 INSERT installment
 *   - N INSERTs transactions
 */
function mockReturnsForN(
  N: number,
  opts: { withDefaultCategoryLookup?: boolean } = {},
): ReadonlyArray<ReadonlyArray<unknown>> {
  const result: ReadonlyArray<unknown>[] = [];
  if (opts.withDefaultCategoryLookup) {
    result.push([{ id: DEFAULT_CATEGORY_ID }]);
  }
  result.push([{ id: INSTALLMENT_ID }]);
  for (let i = 1; i <= N; i += 1) {
    result.push([{ id: txId(i) }]);
  }
  return result;
}

describe('create_installment — metadata', () => {
  it('name correcto', () => {
    expect(createInstallment.name).toBe('create_installment');
  });
  it('domain = finance', () => {
    expect(createInstallment.domain).toBe('finance');
  });
  it('estimatedTokens = 150', () => {
    expect(createInstallment.estimatedTokens).toBe(150);
  });
});

describe('create_installment — input validation', () => {
  const valid = {
    description: 'Portátil',
    cardId: CARD_ID,
    totalAmountCents: 120000,
    numInstallments: 12,
    purchasedOn: '2026-05-23',
    firstInstallmentOn: '2026-06-01',
  };
  it('aceita input válido', () => {
    expect(createInstallment.inputSchema.safeParse(valid).success).toBe(true);
  });
  it('rejeita numInstallments = 0', () => {
    expect(
      createInstallment.inputSchema.safeParse({ ...valid, numInstallments: 0 }).success,
    ).toBe(false);
  });
  it('rejeita numInstallments = 61 (limite schema = 60)', () => {
    expect(
      createInstallment.inputSchema.safeParse({ ...valid, numInstallments: 61 }).success,
    ).toBe(false);
  });
  it('aceita N=60 (limite máximo)', () => {
    expect(
      createInstallment.inputSchema.safeParse({ ...valid, numInstallments: 60 }).success,
    ).toBe(true);
  });
  it('rejeita totalAmountCents <= 0', () => {
    expect(
      createInstallment.inputSchema.safeParse({ ...valid, totalAmountCents: 0 }).success,
    ).toBe(false);
  });
  it('rejeita firstInstallmentOn formato errado (F4 NOT NULL + regex)', () => {
    expect(
      createInstallment.inputSchema.safeParse({
        ...valid,
        firstInstallmentOn: '06/2026',
      }).success,
    ).toBe(false);
  });
  it('rejeita description vazia', () => {
    expect(
      createInstallment.inputSchema.safeParse({ ...valid, description: '' }).success,
    ).toBe(false);
  });
});

describe('create_installment — execute (N=12, sem resto)', () => {
  it('cria 1 installment + 12 transactions (€1.200/12 = €100 cada)', async () => {
    const state: MockState = {
      executes: [],
      insertReturns: mockReturnsForN(12, { withDefaultCategoryLookup: true }),
    };
    const ctx = makeCtx(makeMockDb(state));
    const out = await createInstallment.execute(
      {
        description: 'Portátil',
        cardId: CARD_ID,
        totalAmountCents: 120000,
        numInstallments: 12,
        purchasedOn: '2026-05-23',
        firstInstallmentOn: '2026-06-01',
      },
      ctx,
    );

    expect(out.installmentId).toBe(INSTALLMENT_ID);
    expect(out.transactionIds.length).toBe(12);
    expect(out.perInstallmentCents).toBe(10000);
    expect(out.lastInstallmentCents).toBe(10000); // sem resto
    expect(out.totalAmountCents).toBe(120000);

    // 1 SELECT default + 1 INSERT installments + 12 INSERTs transactions = 14 executes
    expect(state.executes.length).toBe(14);
    expect(state.executes[1]?.sqlText.toLowerCase()).toContain('insert into installments');
    for (let i = 2; i < 14; i += 1) {
      expect(state.executes[i]?.sqlText.toLowerCase()).toContain('insert into transactions');
    }
  });

  it('cada transaction INSERT inclui is_projected=true literal + installment_index', async () => {
    const state: MockState = {
      executes: [],
      insertReturns: mockReturnsForN(3, { withDefaultCategoryLookup: false }),
    };
    const ctx = makeCtx(makeMockDb(state));
    await createInstallment.execute(
      {
        description: 'TV',
        cardId: CARD_ID,
        totalAmountCents: 90000,
        numInstallments: 3,
        purchasedOn: '2026-05-23',
        firstInstallmentOn: '2026-06-01',
        categoryId: CATEGORY_ID,
      },
      ctx,
    );
    // 1 INSERT installment + 3 INSERTs transactions
    expect(state.executes.length).toBe(4);
    for (let i = 1; i <= 3; i += 1) {
      const sqlText = state.executes[i]?.sqlText ?? '';
      expect(sqlText).toMatch(/installment_index/i);
      // is_projected literal `true`
      expect(sqlText).toMatch(/true/);
    }
  });
});

describe('create_installment — execute (N=3, com resto — €1.000/3)', () => {
  it('per=33333 + last=33334 (resto na última)', async () => {
    const state: MockState = {
      executes: [],
      insertReturns: mockReturnsForN(3, { withDefaultCategoryLookup: false }),
    };
    const ctx = makeCtx(makeMockDb(state));
    const out = await createInstallment.execute(
      {
        description: 'X',
        cardId: CARD_ID,
        totalAmountCents: 100000,
        numInstallments: 3,
        purchasedOn: '2026-01-01',
        firstInstallmentOn: '2026-02-01',
        categoryId: CATEGORY_ID,
      },
      ctx,
    );
    expect(out.perInstallmentCents).toBe(33333);
    expect(out.lastInstallmentCents).toBe(33334);
    expect(out.perInstallmentCents * 2 + out.lastInstallmentCents).toBe(100000);
  });
});

describe('create_installment — falha N-ésima INSERT → erro propaga (rollback via executeAtomic)', () => {
  it('falha na 5ª transaction INSERT → execute() lança erro', async () => {
    const state: MockState = {
      executes: [],
      insertReturns: mockReturnsForN(12, { withDefaultCategoryLookup: false }),
      throwOnExecuteIndex: 5, // 0=INSERT installment, 1=tx1, 2=tx2, ..., 5=tx5
    };
    const ctx = makeCtx(makeMockDb(state));
    await expect(
      createInstallment.execute(
        {
          description: 'X',
          cardId: CARD_ID,
          totalAmountCents: 120000,
          numInstallments: 12,
          purchasedOn: '2026-05-23',
          firstInstallmentOn: '2026-06-01',
          categoryId: CATEGORY_ID,
        },
        ctx,
      ),
    ).rejects.toThrow(/simulated DB error/);
  });
});

describe('create_installment — reverse() composite aninhado (D-4.10.4)', () => {
  it('N=12 → top-level [sub[10 tx], sub[2 tx], delete installments]', async () => {
    const transactionIds = Array.from({ length: 12 }, (_, i) => txId(i + 1));
    const op = await createInstallment.reverse(
      {
        installmentId: INSTALLMENT_ID,
        transactionIds,
        perInstallmentCents: 10000,
        lastInstallmentCents: 10000,
        totalAmountCents: 120000,
        numInstallments: 12,
      },
      makeCtx(makeMockDb({ executes: [], insertReturns: [] })),
    );
    if (op.kind !== 'composite') {
      throw new Error('expected composite');
    }
    // Top-level: 2 sub-composites + 1 delete installment
    expect(op.ops.length).toBe(3);
    expect(op.ops[0]?.kind).toBe('composite');
    expect(op.ops[1]?.kind).toBe('composite');
    expect(op.ops[2]).toEqual({
      kind: 'delete_row',
      table: 'installments',
      id: INSTALLMENT_ID,
    });
    // Sub-1: 10 transactions
    if (op.ops[0]?.kind === 'composite') {
      expect(op.ops[0].ops.length).toBe(10);
    }
    // Sub-2: 2 transactions
    if (op.ops[1]?.kind === 'composite') {
      expect(op.ops[1].ops.length).toBe(2);
    }
  });

  it('N=60 → top-level [6 sub-composites de 10, delete installments]', async () => {
    const transactionIds = Array.from({ length: 60 }, (_, i) => txId(i + 1));
    const op = await createInstallment.reverse(
      {
        installmentId: INSTALLMENT_ID,
        transactionIds,
        perInstallmentCents: 1666,
        lastInstallmentCents: 1706,
        totalAmountCents: 100000,
        numInstallments: 60,
      },
      makeCtx(makeMockDb({ executes: [], insertReturns: [] })),
    );
    if (op.kind !== 'composite') throw new Error('expected composite');
    expect(op.ops.length).toBe(7); // 6 sub-composites + 1 delete
    expect(op.ops[6]).toEqual({
      kind: 'delete_row',
      table: 'installments',
      id: INSTALLMENT_ID,
    });
    for (let i = 0; i < 6; i += 1) {
      const sub = op.ops[i];
      if (sub?.kind === 'composite') {
        expect(sub.ops.length).toBe(10);
      }
    }
  });

  it('N=1 → top-level [sub[1 tx], delete installments]', async () => {
    const op = await createInstallment.reverse(
      {
        installmentId: INSTALLMENT_ID,
        transactionIds: [txId(1)],
        perInstallmentCents: 5000,
        lastInstallmentCents: 5000,
        totalAmountCents: 5000,
        numInstallments: 1,
      },
      makeCtx(makeMockDb({ executes: [], insertReturns: [] })),
    );
    if (op.kind !== 'composite') throw new Error('expected composite');
    expect(op.ops.length).toBe(2);
    expect(op.ops[0]?.kind).toBe('composite');
    expect(op.ops[1]?.kind).toBe('delete_row');
  });

  it('payload passa ReverseOpPayloadSchema (recursive Zod) para N=60', () => {
    const transactionIds = Array.from({ length: 60 }, (_, i) => txId(i + 1));
    const sub1: ReverseOpPayload = {
      kind: 'composite',
      ops: transactionIds.slice(0, 10).map((id) => ({
        kind: 'delete_row' as const,
        table: 'transactions',
        id,
      })),
    };
    const op: ReverseOpPayload = {
      kind: 'composite',
      ops: [sub1, sub1, sub1, sub1, sub1, sub1, {
        kind: 'delete_row',
        table: 'installments',
        id: INSTALLMENT_ID,
      }],
    };
    const parsed = ReverseOpPayloadSchema.safeParse(op);
    expect(parsed.success).toBe(true);
  });

  it('ordem: sub-composites de transactions PRIMEIRO, installments POR ÚLTIMO (R-4.10.4)', async () => {
    const transactionIds = Array.from({ length: 5 }, (_, i) => txId(i + 1));
    const op = await createInstallment.reverse(
      {
        installmentId: INSTALLMENT_ID,
        transactionIds,
        perInstallmentCents: 1000,
        lastInstallmentCents: 1000,
        totalAmountCents: 5000,
        numInstallments: 5,
      },
      makeCtx(makeMockDb({ executes: [], insertReturns: [] })),
    );
    if (op.kind !== 'composite') throw new Error('expected composite');
    // Última op MUST ser delete_row installments (FIFO no /undo).
    const lastOp = op.ops[op.ops.length - 1];
    expect(lastOp?.kind).toBe('delete_row');
    if (lastOp?.kind === 'delete_row') {
      expect(lastOp.table).toBe('installments');
    }
  });
});

describe('create_installment — executeAtomic integration', () => {
  it('N=3 via executeAtomic — todas as 5 chamadas (insert installment + 3 insert tx + insert reverse_op)', async () => {
    const state: MockState = {
      executes: [],
      insertReturns: [
        [{ id: INSTALLMENT_ID }],
        [{ id: txId(1) }],
        [{ id: txId(2) }],
        [{ id: txId(3) }],
        [{ id: '00000000-0000-4000-8000-000000000001' }],
      ],
    };
    const ctx = makeCtx(makeMockDb(state));
    const outcome = await executeAtomic(
      [
        {
          definition: createInstallment,
          input: {
            description: 'X',
            cardId: CARD_ID,
            totalAmountCents: 90000,
            numInstallments: 3,
            purchasedOn: '2026-05-23',
            firstInstallmentOn: '2026-06-01',
            categoryId: CATEGORY_ID,
          },
        },
      ],
      ctx,
    );
    expect(outcome.success).toBe(true);
    expect(state.executes.length).toBe(5);
  });
});
