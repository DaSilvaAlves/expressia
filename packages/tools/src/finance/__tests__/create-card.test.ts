/**
 * Testes para `create_card` tool — schema corrigido por PO_FIX_INLINE F3.
 *
 * Trace: Story 4.10 AC3 + AC8 (≥14 testes).
 */
import { describe, expect, it, vi } from 'vitest';

import type { DrizzleDbClient, ToolExecutionContext } from '@/contracts';
import { executeAtomic } from '@/atomic';

import { createCard } from '../create-card';

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
  return {
    transaction: vi.fn(async <T,>(fn: (tx: DrizzleDbClient) => Promise<T>) =>
      fn({
        transaction: vi.fn(async <U,>(g: (gt: DrizzleDbClient) => Promise<U>) =>
          g({
            transaction: vi.fn(),
            insert: vi.fn(),
            execute: exec as unknown as DrizzleDbClient['execute'],
          } as DrizzleDbClient),
        ) as unknown as DrizzleDbClient['transaction'],
        insert: vi.fn(),
        execute: exec as unknown as DrizzleDbClient['execute'],
      } as DrizzleDbClient),
    ) as unknown as DrizzleDbClient['transaction'],
    insert: vi.fn(),
    execute: exec as unknown as DrizzleDbClient['execute'],
  };
}

const CARD_ID = '11111111-2222-4333-8444-555555555555';
const ACCOUNT_ID = '22222222-3333-4444-8555-666666666666';
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

describe('create_card — metadata', () => {
  it('name correcto', () => {
    expect(createCard.name).toBe('create_card');
  });
  it('domain = finance', () => {
    expect(createCard.domain).toBe('finance');
  });
  it('estimatedTokens = 70', () => {
    expect(createCard.estimatedTokens).toBe(70);
  });
});

describe('create_card — input validation (F3 corrigido)', () => {
  const validCredit = {
    name: 'Activobank Gold',
    accountId: ACCOUNT_ID,
    cardType: 'credit' as const,
    closingDay: 25,
    dueDay: 5,
    creditLimitCents: 500000,
  };

  it('aceita débito sem closingDay/dueDay/creditLimitCents', () => {
    expect(
      createCard.inputSchema.safeParse({
        name: 'Activobank Débito',
        accountId: ACCOUNT_ID,
        cardType: 'debit',
      }).success,
    ).toBe(true);
  });

  it('aceita crédito completo (closingDay+dueDay+creditLimitCents)', () => {
    expect(createCard.inputSchema.safeParse(validCredit).success).toBe(true);
  });

  it('rejeita crédito sem closingDay', () => {
    expect(
      createCard.inputSchema.safeParse({
        ...validCredit,
        closingDay: undefined,
      }).success,
    ).toBe(false);
  });

  it('rejeita crédito sem creditLimitCents (CHECK cards_credit_needs_limit)', () => {
    expect(
      createCard.inputSchema.safeParse({
        ...validCredit,
        creditLimitCents: undefined,
      }).success,
    ).toBe(false);
  });

  it('rejeita closingDay = 0', () => {
    expect(
      createCard.inputSchema.safeParse({ ...validCredit, closingDay: 0 }).success,
    ).toBe(false);
  });

  it('rejeita closingDay = 29 (CHECK 1..28)', () => {
    expect(
      createCard.inputSchema.safeParse({ ...validCredit, closingDay: 29 }).success,
    ).toBe(false);
  });

  it("rejeita cardType 'credito' (PT — F3 corrigiu para EN)", () => {
    expect(
      createCard.inputSchema.safeParse({
        ...validCredit,
        cardType: 'credito' as never,
      }).success,
    ).toBe(false);
  });

  it('rejeita accountId omitido (F3 NOT NULL)', () => {
    const noAccount: Record<string, unknown> = { ...validCredit };
    delete noAccount['accountId'];
    expect(createCard.inputSchema.safeParse(noAccount).success).toBe(false);
  });

  it('aceita last4 válido (4 dígitos)', () => {
    expect(
      createCard.inputSchema.safeParse({ ...validCredit, last4: '1234' }).success,
    ).toBe(true);
  });

  it('rejeita last4 com letras', () => {
    expect(
      createCard.inputSchema.safeParse({ ...validCredit, last4: '12ab' }).success,
    ).toBe(false);
  });

  it('rejeita last4 com 3 dígitos', () => {
    expect(
      createCard.inputSchema.safeParse({ ...validCredit, last4: '123' }).success,
    ).toBe(false);
  });
});

describe('create_card — preview PT-PT', () => {
  const ctx = makeCtx(makeMockDb({ executes: [], insertReturns: [] }));
  it('preview crédito inclui fecho/vencimento/limite PT-PT', () => {
    const out = createCard.preview(
      {
        name: 'Activobank Gold',
        accountId: ACCOUNT_ID,
        cardType: 'credit',
        closingDay: 25,
        dueDay: 5,
        creditLimitCents: 500000,
      },
      ctx,
    );
    expect(out).toContain('Activobank Gold');
    expect(out).toContain('Crédito');
    expect(out).toContain('25');
    expect(out).toContain('5');
    expect(out).toContain('€5000,00');
  });
  it('preview débito não inclui limite', () => {
    const out = createCard.preview(
      {
        name: 'Activobank',
        accountId: ACCOUNT_ID,
        cardType: 'debit',
      },
      ctx,
    );
    expect(out).toContain('Débito');
    expect(out).not.toContain('limite');
  });
});

describe('create_card — execute', () => {
  it('INSERT em cards usa ctx.householdId e accountId do input', async () => {
    const state: MockState = {
      executes: [],
      insertReturns: [
        [
          {
            id: CARD_ID,
            name: 'Activobank Gold',
            account_id: ACCOUNT_ID,
            card_type: 'credit',
            closing_day: 25,
            due_day: 5,
            last4: null,
            credit_limit_cents: 500000,
          },
        ],
      ],
    };
    const ctx = makeCtx(makeMockDb(state));
    const out = await createCard.execute(
      {
        name: 'Activobank Gold',
        accountId: ACCOUNT_ID,
        cardType: 'credit',
        closingDay: 25,
        dueDay: 5,
        creditLimitCents: 500000,
      },
      ctx,
    );
    expect(state.executes[0]?.sqlText.toLowerCase()).toContain('insert into cards');
    expect(out.cardId).toBe(CARD_ID);
    expect(out.creditLimitCents).toBe(500000);
    expect(out.cardType).toBe('credit');
  });

  it('débito persiste creditLimitCents=null', async () => {
    const state: MockState = {
      executes: [],
      insertReturns: [
        [
          {
            id: CARD_ID,
            name: 'Débito',
            account_id: ACCOUNT_ID,
            card_type: 'debit',
            closing_day: null,
            due_day: null,
            last4: null,
            credit_limit_cents: null,
          },
        ],
      ],
    };
    const ctx = makeCtx(makeMockDb(state));
    const out = await createCard.execute(
      {
        name: 'Débito',
        accountId: ACCOUNT_ID,
        cardType: 'debit',
      },
      ctx,
    );
    expect(out.creditLimitCents).toBeNull();
    expect(out.closingDay).toBeNull();
  });
});

describe('create_card — reverse()', () => {
  const ctx = makeCtx(makeMockDb({ executes: [], insertReturns: [] }));
  it('reverse() delete_row table=cards', async () => {
    const op = await createCard.reverse(
      {
        cardId: CARD_ID,
        name: 'X',
        accountId: ACCOUNT_ID,
        cardType: 'debit',
        closingDay: null,
        dueDay: null,
        last4: null,
        creditLimitCents: null,
      },
      ctx,
    );
    expect(op).toEqual({ kind: 'delete_row', table: 'cards', id: CARD_ID });
  });
});

describe('create_card — executeAtomic integration', () => {
  it('via executeAtomic → 2 execute calls (INSERT + reverse_op)', async () => {
    const state: MockState = {
      executes: [],
      insertReturns: [
        [
          {
            id: CARD_ID,
            name: 'X',
            account_id: ACCOUNT_ID,
            card_type: 'debit',
            closing_day: null,
            due_day: null,
            last4: null,
            credit_limit_cents: null,
          },
        ],
        [{ id: REVERSE_OP_ID }],
      ],
    };
    const ctx = makeCtx(makeMockDb(state));
    const outcome = await executeAtomic(
      [
        {
          definition: createCard,
          input: { name: 'X', accountId: ACCOUNT_ID, cardType: 'debit' },
        },
      ],
      ctx,
    );
    expect(outcome.success).toBe(true);
    expect(state.executes.length).toBe(2);
  });
});
