/**
 * Testes para `query_finance_summary` tool — read-only sentinela `_noop`.
 *
 * Trace: Story 4.10 AC5 + AC8 (≥10 testes).
 */
import { describe, expect, it, vi } from 'vitest';

import type { DrizzleDbClient, ToolExecutionContext } from '@/contracts';
import { executeAtomic } from '@/atomic';

import { queryFinanceSummary } from '../query-finance-summary';

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
    state.executes.push({ sqlText: captureSqlText(q) });
    const r = state.insertReturns[i] ?? [];
    i += 1;
    return r;
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

const HOUSEHOLD_ID = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';
const USER_ID = '99999999-aaaa-4bbb-8ccc-dddddddddddd';
const RUN_ID = '88888888-7777-4666-8555-444444444444';
const CATEGORY_ID = '44444444-5555-4666-8777-888888888888';

function makeCtx(db: DrizzleDbClient): ToolExecutionContext {
  return {
    householdId: HOUSEHOLD_ID,
    userId: USER_ID,
    db,
    traceId: 'trace_test',
    runId: RUN_ID,
  };
}

describe('query_finance_summary — metadata', () => {
  it('name correcto', () => {
    expect(queryFinanceSummary.name).toBe('query_finance_summary');
  });
  it('domain = finance', () => {
    expect(queryFinanceSummary.domain).toBe('finance');
  });
  it('estimatedTokens = 120', () => {
    expect(queryFinanceSummary.estimatedTokens).toBe(120);
  });
});

describe('query_finance_summary — input validation', () => {
  it('aceita input vazio (todos opcionais)', () => {
    expect(queryFinanceSummary.inputSchema.safeParse({}).success).toBe(true);
  });
  it('aceita monthAnchor válido', () => {
    expect(
      queryFinanceSummary.inputSchema.safeParse({ monthAnchor: '2026-05-23' }).success,
    ).toBe(true);
  });
  it('rejeita monthAnchor formato errado', () => {
    expect(
      queryFinanceSummary.inputSchema.safeParse({ monthAnchor: '23/05' }).success,
    ).toBe(false);
  });
  it('aceita includeNetWorth=false', () => {
    expect(
      queryFinanceSummary.inputSchema.safeParse({ includeNetWorth: false }).success,
    ).toBe(true);
  });
});

describe('query_finance_summary — preview PT-PT', () => {
  const ctx = makeCtx(makeMockDb({ executes: [], insertReturns: [] }));
  it('preview "maio de 2026"', () => {
    const out = queryFinanceSummary.preview({ monthAnchor: '2026-05-23' }, ctx);
    expect(out).toContain('maio de 2026');
  });
});

describe('query_finance_summary — execute', () => {
  it('default monthAnchor = hoje (executa 4 queries com includeNetWorth=true default)', async () => {
    const state: MockState = {
      executes: [],
      insertReturns: [
        // 1) totals
        [{ total_income_cents: 500000, total_expense_cents: 250000 }],
        // 2) byCategory (top 5 expense)
        [
          { category_id: CATEGORY_ID, category_name: 'Supermercado', kind: 'expense', total_cents: 100000 },
        ],
        // 3) accounts (netWorth)
        [{ id: 'acc-1', initial_balance_cents: 1000000 }],
        // 4) sums por conta
        [{ account_id: 'acc-1', income_cents: 500000, expense_cents: 200000 }],
      ],
    };
    const ctx = makeCtx(makeMockDb(state));
    const out = await queryFinanceSummary.execute({}, ctx);

    expect(state.executes.length).toBe(4);
    expect(out.totalIncomeCents).toBe(500000);
    expect(out.totalExpenseCents).toBe(250000);
    expect(out.netCents).toBe(250000);
    expect(out.topCategories.length).toBe(1);
    expect(out.topCategories[0]?.categoryName).toBe('Supermercado');
    expect(out.netWorthCents).toBe(1000000 + 500000 - 200000); // 1.300.000
    expect(out.accountCount).toBe(1);
  });

  it('includeNetWorth=false → 2 queries (sem account_balances), netWorthCents=null', async () => {
    const state: MockState = {
      executes: [],
      insertReturns: [
        [{ total_income_cents: 100000, total_expense_cents: 50000 }],
        [],
      ],
    };
    const ctx = makeCtx(makeMockDb(state));
    const out = await queryFinanceSummary.execute(
      { monthAnchor: '2026-05-15', includeNetWorth: false },
      ctx,
    );
    expect(state.executes.length).toBe(2);
    expect(out.netWorthCents).toBeNull();
    expect(out.accountCount).toBe(0);
  });

  it('totals zero (DB vazia) — netCents=0', async () => {
    const state: MockState = {
      executes: [],
      insertReturns: [
        [{ total_income_cents: 0, total_expense_cents: 0 }],
        [],
        [],
        [],
      ],
    };
    const ctx = makeCtx(makeMockDb(state));
    const out = await queryFinanceSummary.execute({ monthAnchor: '2026-05-15' }, ctx);
    expect(out.netCents).toBe(0);
    expect(out.topCategories.length).toBe(0);
    expect(out.netWorthCents).toBe(0);
    expect(out.accountCount).toBe(0);
  });

  it('SQL inclui filtros is_projected=false + month range', async () => {
    const state: MockState = {
      executes: [],
      insertReturns: [
        [{ total_income_cents: 0, total_expense_cents: 0 }],
        [],
        [],
        [],
      ],
    };
    const ctx = makeCtx(makeMockDb(state));
    await queryFinanceSummary.execute({ monthAnchor: '2026-05-23' }, ctx);
    const totalsSql = state.executes[0]?.sqlText.toLowerCase() ?? '';
    expect(totalsSql).toContain('is_projected = false');
    expect(totalsSql).toContain('transaction_date');
  });

  it('topCategories limitado a 5 — query inclui LIMIT 5', async () => {
    const state: MockState = {
      executes: [],
      insertReturns: [
        [{ total_income_cents: 0, total_expense_cents: 0 }],
        // Devolvemos 5 rows (LIMIT 5 no SQL respeitado pelo mock)
        Array.from({ length: 5 }, (_, i) => ({
          category_id: CATEGORY_ID,
          category_name: `Cat${String(i)}`,
          kind: 'expense',
          total_cents: 1000 * (5 - i),
        })),
        [],
        [],
      ],
    };
    const ctx = makeCtx(makeMockDb(state));
    const out = await queryFinanceSummary.execute({ monthAnchor: '2026-05-23' }, ctx);
    expect(out.topCategories.length).toBe(5);
    // SQL contém limit 5
    expect(state.executes[1]?.sqlText.toLowerCase()).toContain('limit 5');
    // Filter por kind='expense' está literal no SQL
    expect(state.executes[1]?.sqlText.toLowerCase()).toContain("kind = 'expense'");
  });
});

describe('query_finance_summary — reverse() sentinela _noop', () => {
  const ctx = makeCtx(makeMockDb({ executes: [], insertReturns: [] }));
  it("reverse() devolve table='_noop' com UUID válido", async () => {
    const op = await queryFinanceSummary.reverse(
      {
        monthAnchor: '2026-05-23',
        totalIncomeCents: 0,
        totalExpenseCents: 0,
        netCents: 0,
        topCategories: [],
        netWorthCents: null,
        accountCount: 0,
      },
      ctx,
    );
    expect(op.kind).toBe('delete_row');
    if (op.kind === 'delete_row') {
      expect(op.table).toBe('_noop');
      expect(op.id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i);
    }
  });
});

describe('query_finance_summary — executeAtomic integration', () => {
  it('via executeAtomic → 4 query reads + 1 INSERT reverse_op (_noop)', async () => {
    const state: MockState = {
      executes: [],
      insertReturns: [
        [{ total_income_cents: 100000, total_expense_cents: 50000 }],
        [],
        [],
        [],
        [{ id: '00000000-0000-4000-8000-000000000001' }],
      ],
    };
    const ctx = makeCtx(makeMockDb(state));
    const outcome = await executeAtomic(
      [{ definition: queryFinanceSummary, input: { monthAnchor: '2026-05-23' } }],
      ctx,
    );
    expect(outcome.success).toBe(true);
    expect(state.executes.length).toBe(5);
    expect(state.executes[4]?.sqlText.toLowerCase()).toContain('insert into agent_reverse_ops');
  });
});
