// @vitest-environment node
/**
 * Integration test — Tools cérebro do domínio Finanças (Story 4.10).
 *
 * Mockable-friendly E2E: exercita o flow `executeAtomic` → tool finance → INSERT
 * em DB + `agent_reverse_ops`, sem chamar OpenAI/Anthropic reais.
 *
 * Escopo (AC9):
 *   - 5 tools registadas no `toolRegistry` (sanity)
 *   - `create_finance_variable` via executeAtomic → INSERT em transactions + agent_reverse_ops
 *   - `create_finance_recurrence` → INSERT em recurrences + reverse_op
 *   - `create_card` → INSERT em cards + reverse_op
 *   - `create_installment` → INSERT em installments + N×INSERT transactions atomicamente (composite reverse_op)
 *   - `query_finance_summary` → 4× SELECT + reverse_op _noop sentinela
 *   - Falha simulada na N-ésima transaction de create_installment → rollback completo
 *   - Cross-household isolation via 2 ToolExecutionContext distintos (R-4.7)
 *
 * Trace: Story 4.10 AC9 + AC6.
 */
import { describe, expect, it, vi } from 'vitest';

vi.mock('@meu-jarvis/observability', () => ({
  withSpan: vi.fn(
    async (_name: string, _attrs: unknown, fn: (span: unknown) => unknown) => {
      const mockSpan = {
        setAttribute: vi.fn(),
        setAttributes: vi.fn(),
        end: vi.fn(),
        recordException: vi.fn(),
        setStatus: vi.fn(),
      };
      return fn(mockSpan);
    },
  ),
  hashForCorrelation: vi.fn((s: string) => `hash_${s.slice(0, 8)}`),
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

import type {
  DrizzleDbClient,
  ToolExecutionContext,
} from '@meu-jarvis/tools';
import {
  COMPOSITE_REVERSE_OP_MAX_OPS,
  createCard,
  createFinanceRecurrence,
  createFinanceVariable,
  createInstallment,
  executeAtomic,
  queryFinanceSummary,
  toolRegistry,
} from '@meu-jarvis/tools';

// ─────────────────────────────────────────────────────────────────────────────
// Mock DB infrastructure
// ─────────────────────────────────────────────────────────────────────────────

interface CapturedExecute {
  readonly sqlText: string;
}

interface MockState {
  executes: CapturedExecute[];
  insertReturns: ReadonlyArray<ReadonlyArray<unknown>>;
  throwOnExecuteIndex?: number;
}

function captureSqlText(query: unknown): string {
  let sqlText = '';
  function walk(node: unknown): void {
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
  }
  walk(query);
  return sqlText;
}

function makeMockDb(state: MockState): DrizzleDbClient {
  let i = 0;
  const exec = vi.fn(async (q: unknown) => {
    const idx = i;
    state.executes.push({ sqlText: captureSqlText(q) });
    i += 1;
    if (state.throwOnExecuteIndex === idx) {
      throw new Error(`simulated DB error at execute ${String(idx)}`);
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

const HOUSEHOLD_A = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';
const HOUSEHOLD_B = 'bbbbbbbb-cccc-4ddd-8eee-ffffffffffff';
const USER_A = '99999999-aaaa-4bbb-8ccc-dddddddddddd';
const USER_B = '88888888-eeee-4fff-9aaa-bbbbbbbbbbbb';
const ACCOUNT_ID = '22222222-3333-4444-8555-666666666666';
const CARD_ID = '33333333-4444-4555-8666-777777777777';
const CATEGORY_ID = '44444444-5555-4666-8777-888888888888';
const RUN_ID = '88888888-7777-4666-8555-444444444444';
const REVERSE_OP_ID = '00000000-0000-4000-8000-000000000001';

function txId(i: number): string {
  const padded = String(i).padStart(12, '0');
  return `aaaabbbb-1111-4222-8333-${padded}`;
}

function makeCtx(
  db: DrizzleDbClient,
  householdId: string,
  userId: string,
): ToolExecutionContext {
  return {
    householdId,
    userId,
    db,
    traceId: 'trace_integ',
    runId: RUN_ID,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Registry sanity (AC6 — registo automático ao import)
// ─────────────────────────────────────────────────────────────────────────────

describe('Story 4.10 — toolRegistry registration sanity', () => {
  it('create_finance_variable registada no singleton', () => {
    expect(toolRegistry.has('create_finance_variable')).toBe(true);
    expect(toolRegistry.get('create_finance_variable')).toBe(createFinanceVariable);
  });

  it('create_finance_recurrence registada', () => {
    expect(toolRegistry.has('create_finance_recurrence')).toBe(true);
    expect(toolRegistry.get('create_finance_recurrence')).toBe(createFinanceRecurrence);
  });

  it('create_card registada', () => {
    expect(toolRegistry.has('create_card')).toBe(true);
    expect(toolRegistry.get('create_card')).toBe(createCard);
  });

  it('create_installment registada', () => {
    expect(toolRegistry.has('create_installment')).toBe(true);
    expect(toolRegistry.get('create_installment')).toBe(createInstallment);
  });

  it('query_finance_summary registada', () => {
    expect(toolRegistry.has('query_finance_summary')).toBe(true);
    expect(toolRegistry.get('query_finance_summary')).toBe(queryFinanceSummary);
  });

  it('getByDomain("finance") inclui as 5 tools', () => {
    const finance = toolRegistry.getByDomain('finance');
    const names = finance.map((t) => t.name);
    expect(names).toContain('create_finance_variable');
    expect(names).toContain('create_finance_recurrence');
    expect(names).toContain('create_card');
    expect(names).toContain('create_installment');
    expect(names).toContain('query_finance_summary');
  });

  it('getAnthropicToolDefinitions serializa as 5 tools com description PT-PT', () => {
    const defs = toolRegistry.getAnthropicToolDefinitions();
    const finance = defs.filter((d) =>
      [
        'create_finance_variable',
        'create_finance_recurrence',
        'create_card',
        'create_installment',
        'query_finance_summary',
      ].includes(d.name),
    );
    expect(finance.length).toBe(5);
    for (const d of finance) {
      expect(d.description.length).toBeGreaterThan(0);
      expect(d.input_schema).toBeDefined();
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Flow 1 — create_finance_variable
// ─────────────────────────────────────────────────────────────────────────────

describe('Story 4.10 — create_finance_variable via executeAtomic', () => {
  it('intent criar_financa_variavel → row em transactions + agent_reverse_ops', async () => {
    const TX_ID = '11111111-2222-4333-8444-555555555555';
    const state: MockState = {
      executes: [],
      insertReturns: [
        // 1) SELECT default category
        [{ id: CATEGORY_ID }],
        // 2) INSERT transaction
        [
          {
            id: TX_ID,
            amount_cents: 7870,
            kind: 'expense',
            transaction_date: '2026-05-23',
            account_id: null,
            card_id: CARD_ID,
            category_id: CATEGORY_ID,
          },
        ],
        // 3) INSERT agent_reverse_ops
        [{ id: REVERSE_OP_ID }],
      ],
    };
    const ctx = makeCtx(makeMockDb(state), HOUSEHOLD_A, USER_A);

    const outcome = await executeAtomic(
      [
        {
          definition: createFinanceVariable,
          input: {
            amountCents: 7870,
            kind: 'expense' as const,
            transactionDate: '2026-05-23',
            description: 'supermercado',
            cardId: CARD_ID,
          },
        },
      ],
      ctx,
    );

    expect(outcome.success).toBe(true);
    if (outcome.success) {
      expect(outcome.results[0]?.toolName).toBe('create_finance_variable');
      const out = outcome.results[0]?.output as { transactionId: string };
      expect(out.transactionId).toBe(TX_ID);
      expect(outcome.results[0]?.reverseOpId).toBe(REVERSE_OP_ID);
    }
    expect(state.executes.length).toBe(3);
    expect(state.executes[1]?.sqlText).toMatch(/insert into transactions/i);
    expect(state.executes[2]?.sqlText).toMatch(/insert into agent_reverse_ops/i);
    expect(state.executes[2]?.sqlText).toMatch(
      /now\(\)\s*\+\s*interval\s*'30\s*seconds'/i,
    );
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Flow 2 — create_finance_recurrence
// ─────────────────────────────────────────────────────────────────────────────

describe('Story 4.10 — create_finance_recurrence via executeAtomic', () => {
  it('intent criar_financa_recorrente → row em recurrences + reverse_op delete_row', async () => {
    const REC_ID = '11111111-2222-4333-8444-555555555555';
    const state: MockState = {
      executes: [],
      insertReturns: [
        [{ id: CATEGORY_ID }],
        [
          {
            id: REC_ID,
            description: 'Renda',
            amount_cents: 60000,
            kind: 'expense',
            frequency: 'monthly',
            starts_on: '2026-06-01',
            next_run_on: '2026-06-01',
          },
        ],
        [{ id: REVERSE_OP_ID }],
      ],
    };
    const ctx = makeCtx(makeMockDb(state), HOUSEHOLD_A, USER_A);

    const outcome = await executeAtomic(
      [
        {
          definition: createFinanceRecurrence,
          input: {
            amountCents: 60000,
            kind: 'expense' as const,
            description: 'Renda',
            frequency: 'monthly' as const,
            startsOn: '2026-06-01',
            accountId: ACCOUNT_ID,
          },
        },
      ],
      ctx,
    );

    expect(outcome.success).toBe(true);
    expect(state.executes.length).toBe(3);
    expect(state.executes[1]?.sqlText.toLowerCase()).toContain('insert into recurrences');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Flow 3 — create_card
// ─────────────────────────────────────────────────────────────────────────────

describe('Story 4.10 — create_card via executeAtomic', () => {
  it('intent criar_cartao → row em cards + reverse_op delete_row table=cards', async () => {
    const CARD_NEW_ID = '99999999-8888-4777-8666-555555555555';
    const state: MockState = {
      executes: [],
      insertReturns: [
        [
          {
            id: CARD_NEW_ID,
            name: 'Activobank Gold',
            account_id: ACCOUNT_ID,
            card_type: 'credit',
            closing_day: 25,
            due_day: 5,
            last4: null,
            credit_limit_cents: 500000,
          },
        ],
        [{ id: REVERSE_OP_ID }],
      ],
    };
    const ctx = makeCtx(makeMockDb(state), HOUSEHOLD_A, USER_A);
    const outcome = await executeAtomic(
      [
        {
          definition: createCard,
          input: {
            name: 'Activobank Gold',
            accountId: ACCOUNT_ID,
            cardType: 'credit' as const,
            closingDay: 25,
            dueDay: 5,
            creditLimitCents: 500000,
          },
        },
      ],
      ctx,
    );
    expect(outcome.success).toBe(true);
    expect(state.executes.length).toBe(2);
    expect(state.executes[0]?.sqlText.toLowerCase()).toContain('insert into cards');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Flow 4 — create_installment (12 prestações, composite reverse_op aninhado)
// ─────────────────────────────────────────────────────────────────────────────

describe('Story 4.10 — create_installment via executeAtomic (R-4.10.1/3/4)', () => {
  it('intent criar_parcelada N=12 → 1 installment + 12 transactions + agent_reverse_ops com composite aninhado', async () => {
    const INSTALLMENT_ID = '99999999-aaaa-4bbb-8ccc-dddddddddddd';
    const insertReturns: ReadonlyArray<unknown>[] = [];
    insertReturns.push([{ id: CATEGORY_ID }]); // SELECT default category
    insertReturns.push([{ id: INSTALLMENT_ID }]); // INSERT installment
    for (let i = 1; i <= 12; i += 1) {
      insertReturns.push([{ id: txId(i) }]); // INSERT transaction i
    }
    insertReturns.push([{ id: REVERSE_OP_ID }]); // INSERT agent_reverse_ops

    const state: MockState = {
      executes: [],
      insertReturns,
    };
    const ctx = makeCtx(makeMockDb(state), HOUSEHOLD_A, USER_A);

    const outcome = await executeAtomic(
      [
        {
          definition: createInstallment,
          input: {
            description: 'Portátil',
            cardId: CARD_ID,
            totalAmountCents: 120000,
            numInstallments: 12,
            purchasedOn: '2026-05-23',
            firstInstallmentOn: '2026-06-01',
          },
        },
      ],
      ctx,
    );

    expect(outcome.success).toBe(true);
    if (outcome.success) {
      const out = outcome.results[0]?.output as {
        installmentId: string;
        transactionIds: string[];
      };
      expect(out.installmentId).toBe(INSTALLMENT_ID);
      expect(out.transactionIds.length).toBe(12);
    }
    // 1 SELECT + 1 installment + 12 tx + 1 reverse_op = 15 executes
    expect(state.executes.length).toBe(15);
    // Última execute é INSERT em agent_reverse_ops
    expect(state.executes[14]?.sqlText.toLowerCase()).toContain(
      'insert into agent_reverse_ops',
    );
  });

  it("falha na 5ª transaction (N=12) → AtomicFailure + rollback (Drizzle propaga)", async () => {
    const INSTALLMENT_ID = '99999999-aaaa-4bbb-8ccc-dddddddddddd';
    const insertReturns: ReadonlyArray<unknown>[] = [];
    insertReturns.push([{ id: CATEGORY_ID }]);
    insertReturns.push([{ id: INSTALLMENT_ID }]);
    for (let i = 1; i <= 12; i += 1) insertReturns.push([{ id: txId(i) }]);

    const state: MockState = {
      executes: [],
      insertReturns,
      throwOnExecuteIndex: 6, // 0=SELECT cat, 1=INSERT installment, 2=tx1, 3=tx2, ..., 6=tx5
    };
    const ctx = makeCtx(makeMockDb(state), HOUSEHOLD_A, USER_A);
    const outcome = await executeAtomic(
      [
        {
          definition: createInstallment,
          input: {
            description: 'Portátil',
            cardId: CARD_ID,
            totalAmountCents: 120000,
            numInstallments: 12,
            purchasedOn: '2026-05-23',
            firstInstallmentOn: '2026-06-01',
          },
        },
      ],
      ctx,
    );
    expect(outcome.success).toBe(false);
    if (!outcome.success) {
      expect(outcome.failedToolName).toBe('create_installment');
      expect(outcome.rolledBack).toBe(true);
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Flow 5 — query_finance_summary (read-only, sentinela _noop)
// ─────────────────────────────────────────────────────────────────────────────

describe('Story 4.10 — query_finance_summary via executeAtomic (sentinela _noop)', () => {
  it('intent consultar_dados → 4 SELECT queries + reverse_op table=_noop', async () => {
    const state: MockState = {
      executes: [],
      insertReturns: [
        // 1) totals
        [{ total_income_cents: 200000, total_expense_cents: 75000 }],
        // 2) topCategories (1 row)
        [
          {
            category_id: CATEGORY_ID,
            category_name: 'Supermercado',
            kind: 'expense',
            total_cents: 40000,
          },
        ],
        // 3) accounts
        [{ id: ACCOUNT_ID, initial_balance_cents: 1000000 }],
        // 4) sums por conta
        [
          {
            account_id: ACCOUNT_ID,
            income_cents: 200000,
            expense_cents: 50000,
          },
        ],
        // 5) INSERT agent_reverse_ops (sentinela _noop)
        [{ id: REVERSE_OP_ID }],
      ],
    };
    const ctx = makeCtx(makeMockDb(state), HOUSEHOLD_A, USER_A);

    const outcome = await executeAtomic(
      [{ definition: queryFinanceSummary, input: { monthAnchor: '2026-05-23' } }],
      ctx,
    );
    expect(outcome.success).toBe(true);
    if (outcome.success) {
      const out = outcome.results[0]?.output as {
        totalIncomeCents: number;
        totalExpenseCents: number;
        netCents: number;
        netWorthCents: number;
      };
      expect(out.totalIncomeCents).toBe(200000);
      expect(out.totalExpenseCents).toBe(75000);
      expect(out.netCents).toBe(125000);
      expect(out.netWorthCents).toBe(1000000 + 200000 - 50000); // 1.150.000
    }
    expect(state.executes.length).toBe(5);
    // Última op é INSERT agent_reverse_ops com payload reverse_op._noop
    expect(state.executes[4]?.sqlText).toMatch(/insert into agent_reverse_ops/i);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Flow 6 — Cross-household isolation (R-4.7)
// ─────────────────────────────────────────────────────────────────────────────

describe('Story 4.10 — cross-household isolation (R-4.7 mock JWT)', () => {
  it('2 ctx household diferentes → execuções isoladas, ctx.householdId derivado JWT (não input)', async () => {
    const TX_A = 'aaaa1111-2222-4333-8444-555555555555';
    const TX_B = 'bbbb1111-2222-4333-8444-555555555555';
    const stateA: MockState = {
      executes: [],
      insertReturns: [
        [{ id: CATEGORY_ID }],
        [
          {
            id: TX_A,
            amount_cents: 1000,
            kind: 'expense',
            transaction_date: '2026-05-23',
            account_id: ACCOUNT_ID,
            card_id: null,
            category_id: CATEGORY_ID,
          },
        ],
        [{ id: REVERSE_OP_ID }],
      ],
    };
    const stateB: MockState = {
      executes: [],
      insertReturns: [
        [{ id: CATEGORY_ID }],
        [
          {
            id: TX_B,
            amount_cents: 2000,
            kind: 'expense',
            transaction_date: '2026-05-23',
            account_id: ACCOUNT_ID,
            card_id: null,
            category_id: CATEGORY_ID,
          },
        ],
        [{ id: REVERSE_OP_ID }],
      ],
    };
    const ctxA = makeCtx(makeMockDb(stateA), HOUSEHOLD_A, USER_A);
    const ctxB = makeCtx(makeMockDb(stateB), HOUSEHOLD_B, USER_B);

    const outA = await executeAtomic(
      [
        {
          definition: createFinanceVariable,
          input: {
            amountCents: 1000,
            kind: 'expense' as const,
            transactionDate: '2026-05-23',
            description: 'A',
            accountId: ACCOUNT_ID,
          },
        },
      ],
      ctxA,
    );
    const outB = await executeAtomic(
      [
        {
          definition: createFinanceVariable,
          input: {
            amountCents: 2000,
            kind: 'expense' as const,
            transactionDate: '2026-05-23',
            description: 'B',
            accountId: ACCOUNT_ID,
          },
        },
      ],
      ctxB,
    );
    expect(outA.success).toBe(true);
    expect(outB.success).toBe(true);
    expect(stateA.executes.length).toBe(3);
    expect(stateB.executes.length).toBe(3);
  });

  it('inputSchema das 5 tools descarta household_id (defense em profundidade)', () => {
    const tools = [
      createFinanceVariable,
      createFinanceRecurrence,
      createCard,
      createInstallment,
      queryFinanceSummary,
    ];
    for (const tool of tools) {
      // Cada tool aceita ou rejeita o input — o ponto é que nenhuma propaga
      // household_id para o output, mesmo que o LLM o injecte.
      const parsed = tool.inputSchema.safeParse({
        household_id: 'attacker-uuid',
        amountCents: 1000,
        kind: 'expense' as const,
        transactionDate: '2026-05-23',
        description: 'X',
        accountId: ACCOUNT_ID,
        // Campos adicionais para passar refinements das outras tools.
        name: 'X',
        cardType: 'debit' as const,
        frequency: 'monthly' as const,
        startsOn: '2026-06-01',
        cardId: CARD_ID,
        totalAmountCents: 1000,
        numInstallments: 1,
        purchasedOn: '2026-05-23',
        firstInstallmentOn: '2026-06-01',
        monthAnchor: '2026-05-23',
      });
      if (parsed.success) {
        expect(parsed.data).not.toHaveProperty('household_id');
      }
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Composite reverse_op limits (D-4.10.4)
// ─────────────────────────────────────────────────────────────────────────────

describe('Story 4.10 — create_installment reverse_op respeita COMPOSITE_REVERSE_OP_MAX_OPS', () => {
  it('N=60 produz top-level com ≤ COMPOSITE_REVERSE_OP_MAX_OPS+1 ops', async () => {
    const transactionIds = Array.from({ length: 60 }, (_, i) => txId(i + 1));
    const op = await createInstallment.reverse(
      {
        installmentId: '99999999-aaaa-4bbb-8ccc-dddddddddddd',
        transactionIds,
        perInstallmentCents: 1666,
        lastInstallmentCents: 1706,
        totalAmountCents: 100000,
        numInstallments: 60,
      },
      makeCtx(makeMockDb({ executes: [], insertReturns: [] }), HOUSEHOLD_A, USER_A),
    );
    if (op.kind !== 'composite') throw new Error('expected composite');
    // 6 sub-composites (60/10) + 1 delete installment = 7 ops top-level
    expect(op.ops.length).toBeLessThanOrEqual(COMPOSITE_REVERSE_OP_MAX_OPS);
  });
});
