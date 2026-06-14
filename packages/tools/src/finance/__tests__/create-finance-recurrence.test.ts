/**
 * Testes para `create_finance_recurrence` tool.
 *
 * Trace: Story 4.10 AC2 + AC8 (≥16 testes).
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { DrizzleDbClient, ToolExecutionContext } from '@/contracts';
import { executeAtomic } from '@/atomic';

import { createFinanceRecurrence } from '../create-finance-recurrence';

vi.mock('@meu-jarvis/observability', () => ({
  withSpan: vi.fn(async (_n: string, _a: unknown, fn: (s: unknown) => unknown) => {
    const s = {
      setAttribute: vi.fn(),
      setAttributes: vi.fn(),
      end: vi.fn(),
      recordException: vi.fn(),
      setStatus: vi.fn(),
    };
    return fn(s);
  }),
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
    if (Array.isArray(v))
      for (const x of v)
        if (typeof x === 'string') s += x;
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
  const tx: DrizzleDbClient = {
    transaction: vi.fn(async <T>(fn: (tx: DrizzleDbClient) => Promise<T>) =>
      fn(tx),
    ) as unknown as DrizzleDbClient['transaction'],
    insert: vi.fn(),
    execute: exec as unknown as DrizzleDbClient['execute'],
  };
  return {
    transaction: vi.fn(async <T>(fn: (tx: DrizzleDbClient) => Promise<T>) =>
      fn(tx),
    ) as unknown as DrizzleDbClient['transaction'],
    insert: vi.fn(),
    execute: exec as unknown as DrizzleDbClient['execute'],
  };
}

const REC_ID = '11111111-2222-4333-8444-555555555555';
const ACCOUNT_ID = '22222222-3333-4444-8555-666666666666';
const CARD_ID = '33333333-4444-4555-8666-777777777777';
const CATEGORY_ID = '44444444-5555-4666-8777-888888888888';
const DEFAULT_CATEGORY_ID = '55555555-6666-4777-8888-999999999999';
const HOUSEHOLD_ID = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';
const USER_ID = '99999999-aaaa-4bbb-8ccc-dddddddddddd';
const RUN_ID = '88888888-7777-4666-8555-444444444444';
const REVERSE_OP_ID = '00000000-0000-4000-8000-000000000001';

function makeCtx(db: DrizzleDbClient): ToolExecutionContext {
  return {
    householdId: HOUSEHOLD_ID,
    userId: USER_ID,
    db,
    traceId: 'trace_test',
    runId: RUN_ID,
  };
}

describe('create_finance_recurrence — metadata', () => {
  it('name correcto', () => {
    expect(createFinanceRecurrence.name).toBe('create_finance_recurrence');
  });
  it('domain = finance', () => {
    expect(createFinanceRecurrence.domain).toBe('finance');
  });
  it('estimatedTokens = 100', () => {
    expect(createFinanceRecurrence.estimatedTokens).toBe(100);
  });
});

describe('create_finance_recurrence — input validation', () => {
  const base = {
    amountCents: 60000,
    kind: 'expense' as const,
    description: 'Renda casa',
    frequency: 'monthly' as const,
    startsOn: '2026-06-01',
    accountId: ACCOUNT_ID,
  };

  it('aceita input válido', () => {
    expect(createFinanceRecurrence.inputSchema.safeParse(base).success).toBe(true);
  });
  it('rejeita frequency biweekly (subset MVP — F2 nota de scope)', () => {
    expect(
      createFinanceRecurrence.inputSchema.safeParse({
        ...base,
        frequency: 'biweekly' as never,
      }).success,
    ).toBe(false);
  });
  it("rejeita frequency 'custom'", () => {
    expect(
      createFinanceRecurrence.inputSchema.safeParse({
        ...base,
        frequency: 'custom' as never,
      }).success,
    ).toBe(false);
  });
  it('aceita frequency=weekly', () => {
    expect(
      createFinanceRecurrence.inputSchema.safeParse({ ...base, frequency: 'weekly' }).success,
    ).toBe(true);
  });
  it('aceita frequency=yearly', () => {
    expect(
      createFinanceRecurrence.inputSchema.safeParse({ ...base, frequency: 'yearly' }).success,
    ).toBe(true);
  });
  it('rejeita description vazia (F2 NOT NULL)', () => {
    expect(
      createFinanceRecurrence.inputSchema.safeParse({ ...base, description: '' }).success,
    ).toBe(false);
  });
  it('rejeita startsOn formato errado', () => {
    expect(
      createFinanceRecurrence.inputSchema.safeParse({ ...base, startsOn: '01/06/2026' }).success,
    ).toBe(false);
  });
  it("rejeita kind='transfer' (DP-4.10.C)", () => {
    expect(
      createFinanceRecurrence.inputSchema.safeParse({ ...base, kind: 'transfer' as never }).success,
    ).toBe(false);
  });
  it('ACEITA sem accountId E sem cardId (Story 2.13 — refine relaxado; conta default em execute)', () => {
    expect(
      createFinanceRecurrence.inputSchema.safeParse({
        ...base,
        accountId: undefined,
        cardId: undefined,
      }).success,
    ).toBe(true);
  });
  it('aceita com cardId (sem accountId)', () => {
    expect(
      createFinanceRecurrence.inputSchema.safeParse({
        ...base,
        accountId: undefined,
        cardId: CARD_ID,
      }).success,
    ).toBe(true);
  });
});

describe('create_finance_recurrence — preview PT-PT', () => {
  const ctx = makeCtx(makeMockDb({ executes: [], insertReturns: [] }));
  it('inclui valor PT-PT vírgula + frequência PT + DD/MM/YYYY', () => {
    const out = createFinanceRecurrence.preview(
      {
        amountCents: 60000,
        kind: 'expense',
        description: 'Renda',
        frequency: 'monthly',
        startsOn: '2026-06-01',
        accountId: ACCOUNT_ID,
      },
      ctx,
    );
    expect(out).toContain('Renda');
    expect(out).toContain('€600,00');
    expect(out).toContain('mensal');
    expect(out).toContain('01/06/2026');
  });
});

describe('create_finance_recurrence — execute', () => {
  let state: MockState;
  beforeEach(() => {
    state = {
      executes: [],
      insertReturns: [
        [{ id: DEFAULT_CATEGORY_ID }],
        [{ id: ACCOUNT_ID }], // pré-check accountId explícito (FASE A)
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
      ],
    };
  });

  it('INSERT em recurrences usa next_run_on = startsOn', async () => {
    const ctx = makeCtx(makeMockDb(state));
    await createFinanceRecurrence.execute(
      {
        amountCents: 60000,
        kind: 'expense',
        description: 'Renda',
        frequency: 'monthly',
        startsOn: '2026-06-01',
        accountId: ACCOUNT_ID,
      },
      ctx,
    );
    // SELECT category + pré-check accountId + INSERT.
    expect(state.executes.length).toBe(3);
    expect(state.executes[2]?.sqlText.toLowerCase()).toContain('insert into recurrences');
  });

  it('com categoryId fornecido → NÃO chama resolveDefaultCategory', async () => {
    state.insertReturns = [
      [{ id: ACCOUNT_ID }], // pré-check accountId (sem SELECT category)
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
    ];
    const ctx = makeCtx(makeMockDb(state));
    await createFinanceRecurrence.execute(
      {
        amountCents: 60000,
        kind: 'expense',
        description: 'Renda',
        frequency: 'monthly',
        startsOn: '2026-06-01',
        accountId: ACCOUNT_ID,
        categoryId: CATEGORY_ID,
      },
      ctx,
    );
    // pré-check accountId + INSERT (sem SELECT category).
    expect(state.executes.length).toBe(2);
    expect(state.executes[1]?.sqlText.toLowerCase()).toContain('insert into recurrences');
  });

  it('output válido', async () => {
    const ctx = makeCtx(makeMockDb(state));
    const out = await createFinanceRecurrence.execute(
      {
        amountCents: 60000,
        kind: 'expense',
        description: 'Renda',
        frequency: 'monthly',
        startsOn: '2026-06-01',
        accountId: ACCOUNT_ID,
      },
      ctx,
    );
    expect(out.recurrenceId).toBe(REC_ID);
    expect(out.amountCents).toBe(60000);
    expect(out.frequency).toBe('monthly');
    expect(out.startsOn).toBe('2026-06-01');
    expect(out.nextRunOn).toBe('2026-06-01');
    expect(createFinanceRecurrence.outputSchema.safeParse(out).success).toBe(true);
  });

  it('INSERT inclui active=true literal', async () => {
    const ctx = makeCtx(makeMockDb(state));
    await createFinanceRecurrence.execute(
      {
        amountCents: 60000,
        kind: 'expense',
        description: 'Renda',
        frequency: 'monthly',
        startsOn: '2026-06-01',
        accountId: ACCOUNT_ID,
      },
      ctx,
    );
    // SELECT category + pré-check accountId + INSERT → o INSERT (índice 2) tem `active=true`.
    expect(state.executes[2]?.sqlText).toMatch(/true/);
  });
});

describe('create_finance_recurrence — conta default (Story 2.13)', () => {
  const DINHEIRO_ACCOUNT_ID = '66666666-7777-4888-8999-aaaaaaaaaaaa';

  it('sem accountId nem cardId → resolveDefaultAccount + paymentMethod cash (dinheiro)', async () => {
    const state: MockState = {
      executes: [],
      insertReturns: [
        [{ id: DEFAULT_CATEGORY_ID }], // SELECT category
        [{ id: DINHEIRO_ACCOUNT_ID, account_type: 'dinheiro' }], // SELECT account
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
      ],
    };
    const ctx = makeCtx(makeMockDb(state));
    await createFinanceRecurrence.execute(
      {
        amountCents: 60000,
        kind: 'expense',
        description: 'Renda',
        frequency: 'monthly',
        startsOn: '2026-06-01',
      },
      ctx,
    );
    expect(state.executes.length).toBe(3);
    const accountSelectSql = state.executes[1]?.sqlText.toLowerCase() ?? '';
    expect(accountSelectSql).toContain('from accounts');
    expect(accountSelectSql).toContain('archived_at is null');
    const insertSql = state.executes[2]?.sqlText.toLowerCase() ?? '';
    expect(insertSql).toContain('insert into recurrences');
    expect(insertSql).toContain('cash');
  });

  it('household sem conta → ToolExecutionError PT-PT', async () => {
    const state: MockState = {
      executes: [],
      insertReturns: [
        [{ id: DEFAULT_CATEGORY_ID }],
        [], // SELECT account → vazio
      ],
    };
    const ctx = makeCtx(makeMockDb(state));
    try {
      await createFinanceRecurrence.execute(
        {
          amountCents: 60000,
          kind: 'expense',
          description: 'Renda',
          frequency: 'monthly',
          startsOn: '2026-06-01',
        },
        ctx,
      );
      expect.fail('devia ter lançado ToolExecutionError');
    } catch (err) {
      expect((err as Error).name).toBe('ToolExecutionError');
      expect(((err as { cause?: Error }).cause as Error).message).toMatch(/Nenhuma conta/);
    }
  });
});

describe('create_finance_recurrence — reverse()', () => {
  const ctx = makeCtx(makeMockDb({ executes: [], insertReturns: [] }));
  it('reverse() delete_row table=recurrences', async () => {
    const op = await createFinanceRecurrence.reverse(
      {
        recurrenceId: REC_ID,
        description: 'Renda',
        amountCents: 60000,
        kind: 'expense',
        frequency: 'monthly',
        startsOn: '2026-06-01',
        nextRunOn: '2026-06-01',
      },
      ctx,
    );
    expect(op).toEqual({ kind: 'delete_row', table: 'recurrences', id: REC_ID });
  });
});

describe('create_finance_recurrence — cross-tenant (accountId/cardId explícito)', () => {
  it('accountId de OUTRO household → ToolExecutionError no pré-check (NÃO chega ao INSERT)', async () => {
    const state: MockState = {
      executes: [],
      insertReturns: [
        [{ id: DEFAULT_CATEGORY_ID }], // SELECT category OK
        [], // pré-check account SELECT → 0 rows
      ],
    };
    const ctx = makeCtx(makeMockDb(state));
    await expect(
      createFinanceRecurrence.execute(
        {
          amountCents: 60000,
          kind: 'expense',
          description: 'Renda',
          frequency: 'monthly',
          startsOn: '2026-06-01',
          accountId: ACCOUNT_ID,
        },
        ctx,
      ),
    ).rejects.toMatchObject({ name: 'ToolExecutionError' });
    expect(
      state.executes.some((e) => e.sqlText.toLowerCase().includes('insert into recurrences')),
    ).toBe(false);
  });

  it('cardId de OUTRO household → ToolExecutionError no pré-check', async () => {
    const state: MockState = {
      executes: [],
      insertReturns: [
        [{ id: DEFAULT_CATEGORY_ID }], // SELECT category OK
        [], // pré-check card SELECT → 0 rows
      ],
    };
    const ctx = makeCtx(makeMockDb(state));
    await expect(
      createFinanceRecurrence.execute(
        {
          amountCents: 60000,
          kind: 'expense',
          description: 'Renda',
          frequency: 'monthly',
          startsOn: '2026-06-01',
          cardId: CARD_ID,
        },
        ctx,
      ),
    ).rejects.toMatchObject({ name: 'ToolExecutionError' });
    expect(
      state.executes.some((e) => e.sqlText.toLowerCase().includes('insert into recurrences')),
    ).toBe(false);
  });
});

describe('create_finance_recurrence — executeAtomic integration', () => {
  it('via executeAtomic → 4 execute calls (SELECT + pré-check + INSERT + reverse_op)', async () => {
    const state: MockState = {
      executes: [],
      insertReturns: [
        [{ id: DEFAULT_CATEGORY_ID }],
        [{ id: ACCOUNT_ID }], // pré-check accountId
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
    const ctx = makeCtx(makeMockDb(state));
    const outcome = await executeAtomic(
      [
        {
          definition: createFinanceRecurrence,
          input: {
            amountCents: 60000,
            kind: 'expense',
            description: 'Renda',
            frequency: 'monthly',
            startsOn: '2026-06-01',
            accountId: ACCOUNT_ID,
          },
        },
      ],
      ctx,
    );
    expect(outcome.success).toBe(true);
    if (outcome.success) {
      expect(outcome.results[0]?.reverseOpId).toBe(REVERSE_OP_ID);
    }
    // SELECT category + pré-check accountId + INSERT recurrences + INSERT reverse_op.
    expect(state.executes.length).toBe(4);
  });
});
