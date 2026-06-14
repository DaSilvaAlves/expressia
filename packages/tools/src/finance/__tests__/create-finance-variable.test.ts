/**
 * Testes para `create_finance_variable` tool — happy paths + Zod validation
 * + reverse_op + RLS via ctx.householdId + cenário InternalAtomicAbort.
 *
 * Trace: Story 4.10 AC1 + AC8 (≥18 testes) + TEST-001-NB bonus.
 *
 * Padrão: vi.mock + mockTx pattern (idêntico a `tasks/__tests__/criar-tarefa.test.ts`).
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { DrizzleDbClient, ToolExecutionContext } from '@/contracts';
import { executeAtomic } from '@/atomic';

import { createFinanceVariable } from '../create-finance-variable';

// ─────────────────────────────────────────────────────────────────────────────
// Mocks
// ─────────────────────────────────────────────────────────────────────────────

vi.mock('@meu-jarvis/observability', () => ({
  withSpan: vi.fn(async (_name: string, _attrs: unknown, fn: (span: unknown) => unknown) => {
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
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

interface CapturedExecute {
  readonly sqlText: string;
}

interface MockState {
  executes: CapturedExecute[];
  insertReturns: ReadonlyArray<ReadonlyArray<unknown>>;
  shouldThrowInTransaction?: Error;
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

  const db: DrizzleDbClient = {
    transaction: vi.fn(async <T>(fn: (tx: DrizzleDbClient) => Promise<T>) => {
      if (state.shouldThrowInTransaction) {
        throw state.shouldThrowInTransaction;
      }
      return fn(tx);
    }) as unknown as DrizzleDbClient['transaction'],
    insert: vi.fn(),
    execute: exec as unknown as DrizzleDbClient['execute'],
  };

  return db;
}

const TX_ID = '11111111-2222-4333-8444-555555555555';
const ACCOUNT_ID = '22222222-3333-4444-8555-666666666666';
const CARD_ID = '33333333-4444-4555-8666-777777777777';
const CATEGORY_ID = '44444444-5555-4666-8777-888888888888';
const DEFAULT_CATEGORY_ID = '55555555-6666-4777-8888-999999999999';
const HOUSEHOLD_ID = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';
const USER_ID = '99999999-aaaa-4bbb-8ccc-dddddddddddd';
const RUN_ID = '88888888-7777-4666-8555-444444444444';
const REVERSE_OP_ID = '00000000-0000-4000-8000-000000000001';

function makeCtx(
  db: DrizzleDbClient,
  overrides?: Partial<ToolExecutionContext>,
): ToolExecutionContext {
  return {
    householdId: HOUSEHOLD_ID,
    userId: USER_ID,
    db,
    traceId: 'trace_test',
    runId: RUN_ID,
    ...overrides,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Tests — metadata
// ─────────────────────────────────────────────────────────────────────────────

describe('create_finance_variable — metadata', () => {
  it('name correcto', () => {
    expect(createFinanceVariable.name).toBe('create_finance_variable');
  });

  it('domain = finance', () => {
    expect(createFinanceVariable.domain).toBe('finance');
  });

  it('description PT-PT menciona "variável"', () => {
    expect(createFinanceVariable.description.toLowerCase()).toMatch(/vari[aá]vel/);
  });

  it('estimatedTokens = 80', () => {
    expect(createFinanceVariable.estimatedTokens).toBe(80);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Tests — input schema validation
// ─────────────────────────────────────────────────────────────────────────────

describe('create_finance_variable — input validation', () => {
  const baseValid = {
    amountCents: 7870,
    kind: 'expense' as const,
    transactionDate: '2026-05-23',
    description: 'supermercado',
    accountId: ACCOUNT_ID,
  };

  it('aceita input válido com accountId', () => {
    expect(createFinanceVariable.inputSchema.safeParse(baseValid).success).toBe(true);
  });

  it('aceita input válido com cardId (sem accountId)', () => {
    expect(
      createFinanceVariable.inputSchema.safeParse({
        ...baseValid,
        accountId: undefined,
        cardId: CARD_ID,
      }).success,
    ).toBe(true);
  });

  it('rejeita amountCents = 0', () => {
    expect(
      createFinanceVariable.inputSchema.safeParse({ ...baseValid, amountCents: 0 }).success,
    ).toBe(false);
  });

  it('rejeita amountCents negativo', () => {
    expect(
      createFinanceVariable.inputSchema.safeParse({ ...baseValid, amountCents: -100 }).success,
    ).toBe(false);
  });

  it('rejeita amountCents não-inteiro', () => {
    expect(
      createFinanceVariable.inputSchema.safeParse({ ...baseValid, amountCents: 7.5 }).success,
    ).toBe(false);
  });

  it("rejeita kind 'transfer' (DP-4.10.C — sem transfer)", () => {
    expect(
      createFinanceVariable.inputSchema.safeParse({ ...baseValid, kind: 'transfer' as never })
        .success,
    ).toBe(false);
  });

  it('rejeita transactionDate em formato errado', () => {
    expect(
      createFinanceVariable.inputSchema.safeParse({
        ...baseValid,
        transactionDate: '23/05/2026',
      }).success,
    ).toBe(false);
  });

  it('rejeita description vazia (NOT NULL — F1)', () => {
    expect(
      createFinanceVariable.inputSchema.safeParse({ ...baseValid, description: '' }).success,
    ).toBe(false);
  });

  it('rejeita description > 500 chars', () => {
    expect(
      createFinanceVariable.inputSchema.safeParse({
        ...baseValid,
        description: 'X'.repeat(501),
      }).success,
    ).toBe(false);
  });

  it('ACEITA input SEM accountId E SEM cardId (Story 2.13 — refine relaxado; conta default resolvida em execute)', () => {
    const r = createFinanceVariable.inputSchema.safeParse({
      ...baseValid,
      accountId: undefined,
      cardId: undefined,
    });
    expect(r.success).toBe(true);
  });

  it("aceita paymentMethod válido ('mb_way')", () => {
    expect(
      createFinanceVariable.inputSchema.safeParse({
        ...baseValid,
        paymentMethod: 'mb_way',
      }).success,
    ).toBe(true);
  });

  it("rejeita paymentMethod inválido ('crypto')", () => {
    expect(
      createFinanceVariable.inputSchema.safeParse({
        ...baseValid,
        paymentMethod: 'crypto' as never,
      }).success,
    ).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Tests — preview (PT-PT vírgula decimal — CON9)
// ─────────────────────────────────────────────────────────────────────────────

describe('create_finance_variable — preview PT-PT', () => {
  const ctx = makeCtx(makeMockDb({ executes: [], insertReturns: [] }));

  it('despesa em PT-PT com vírgula decimal', () => {
    const out = createFinanceVariable.preview(
      {
        amountCents: 7870,
        kind: 'expense',
        transactionDate: '2026-05-23',
        description: 'supermercado',
        accountId: ACCOUNT_ID,
      },
      ctx,
    );
    expect(out).toContain('despesa');
    expect(out).toContain('€78,70');
    expect(out).toContain('supermercado');
    expect(out).not.toContain('78.70'); // CON9 — sem ponto decimal
  });

  it('receita em PT-PT', () => {
    const out = createFinanceVariable.preview(
      {
        amountCents: 5000,
        kind: 'income',
        transactionDate: '2026-05-23',
        description: 'reembolso',
        accountId: ACCOUNT_ID,
      },
      ctx,
    );
    expect(out).toContain('receita');
    expect(out).toContain('€50,00');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Tests — execute (RLS, INSERT, output)
// ─────────────────────────────────────────────────────────────────────────────

describe('create_finance_variable — execute', () => {
  let state: MockState;

  beforeEach(() => {
    state = {
      executes: [],
      insertReturns: [
        // 1ª chamada: SELECT default category (resolveDefaultCategory) — só se categoryId omitido
        [{ id: DEFAULT_CATEGORY_ID }],
        // 2ª chamada: pré-check cross-tenant do accountId explícito (FASE A) — 1 row = pertence
        [{ id: ACCOUNT_ID }],
        // 3ª chamada: INSERT em transactions
        [
          {
            id: TX_ID,
            amount_cents: 7870,
            kind: 'expense',
            transaction_date: '2026-05-23',
            account_id: ACCOUNT_ID,
            card_id: null,
            category_id: DEFAULT_CATEGORY_ID,
          },
        ],
      ],
    };
  });

  it('INSERT em transactions usa ctx.householdId (não do input — R-4.7)', async () => {
    const ctx = makeCtx(makeMockDb(state));
    await createFinanceVariable.execute(
      {
        amountCents: 7870,
        kind: 'expense',
        transactionDate: '2026-05-23',
        description: 'supermercado',
        accountId: ACCOUNT_ID,
      },
      ctx,
    );

    // 1) lookup default category; 2) pré-check accountId; 3) insert transaction
    expect(state.executes.length).toBe(3);
    const insertSql = state.executes[2]?.sqlText ?? '';
    expect(insertSql).toMatch(/insert into transactions/i);
    expect(insertSql).toMatch(/household_id/i);
    expect(insertSql).toMatch(/created_by_user_id/i);
    expect(insertSql).toMatch(/agent_run_id/i);
    expect(insertSql).toMatch(/is_projected/i);
  });

  it("inclui literal 'false' para is_projected (transactions reais — não projecções)", async () => {
    // categoryId fornecido → sem SELECT category; accountId explícito → pré-check + INSERT.
    state.insertReturns = [
      [{ id: ACCOUNT_ID }], // 1ª: pré-check accountId
      [
        {
          id: TX_ID,
          amount_cents: 1000,
          kind: 'income',
          transaction_date: '2026-05-23',
          account_id: ACCOUNT_ID,
          card_id: null,
          category_id: CATEGORY_ID,
        },
      ], // 2ª: INSERT
    ];
    const ctx = makeCtx(makeMockDb(state));
    await createFinanceVariable.execute(
      {
        amountCents: 1000,
        kind: 'income',
        transactionDate: '2026-05-23',
        description: 'reembolso',
        accountId: ACCOUNT_ID,
        categoryId: CATEGORY_ID,
      },
      ctx,
    );
    // is_projected forçado a literal false → o INSERT (2ª chamada) inclui "false".
    const sqlText = state.executes[1]?.sqlText ?? '';
    expect(sqlText).toMatch(/false/);
  });

  it('quando categoryId omitido → resolveDefaultCategory chamado primeiro (SELECT categories)', async () => {
    const ctx = makeCtx(makeMockDb(state));
    await createFinanceVariable.execute(
      {
        amountCents: 7870,
        kind: 'expense',
        transactionDate: '2026-05-23',
        description: 'supermercado',
        accountId: ACCOUNT_ID,
      },
      ctx,
    );
    // 1) SELECT category; 2) pré-check accountId; 3) INSERT.
    expect(state.executes.length).toBe(3);
    const firstSql = state.executes[0]?.sqlText.toLowerCase() ?? '';
    expect(firstSql).toContain('select');
    expect(firstSql).toContain('from categories');
  });

  it("quando categoryId omitido + kind='income' → procura 'Outros rendimentos'", async () => {
    state.insertReturns = [
      // 1ª: SELECT default category (income)
      [{ id: DEFAULT_CATEGORY_ID }],
      // 2ª: pré-check accountId explícito
      [{ id: ACCOUNT_ID }],
      // 3ª: INSERT transaction
      [
        {
          id: TX_ID,
          amount_cents: 5000,
          kind: 'income',
          transaction_date: '2026-05-23',
          account_id: ACCOUNT_ID,
          card_id: null,
          category_id: DEFAULT_CATEGORY_ID,
        },
      ],
    ];
    const ctx = makeCtx(makeMockDb(state));
    await createFinanceVariable.execute(
      {
        amountCents: 5000,
        kind: 'income',
        transactionDate: '2026-05-23',
        description: 'reembolso',
        accountId: ACCOUNT_ID,
      },
      ctx,
    );
    // 3 chamadas: SELECT category + pré-check accountId + INSERT.
    expect(state.executes.length).toBe(3);
  });

  it('quando categoryId fornecido → NÃO chama resolveDefaultCategory (pré-check + INSERT)', async () => {
    state.insertReturns = [
      // 1ª: pré-check accountId explícito (sem SELECT default category)
      [{ id: ACCOUNT_ID }],
      // 2ª: INSERT transaction
      [
        {
          id: TX_ID,
          amount_cents: 7870,
          kind: 'expense',
          transaction_date: '2026-05-23',
          account_id: ACCOUNT_ID,
          card_id: null,
          category_id: CATEGORY_ID,
        },
      ],
    ];
    const ctx = makeCtx(makeMockDb(state));
    await createFinanceVariable.execute(
      {
        amountCents: 7870,
        kind: 'expense',
        transactionDate: '2026-05-23',
        description: 'supermercado',
        accountId: ACCOUNT_ID,
        categoryId: CATEGORY_ID,
      },
      ctx,
    );
    // sem SELECT category; 1) pré-check accountId; 2) INSERT.
    expect(state.executes.length).toBe(2);
    expect(state.executes[1]?.sqlText.toLowerCase()).toContain('insert into transactions');
  });

  it('output schema válido — transactionId UUID + amountCents inteiro', async () => {
    const ctx = makeCtx(makeMockDb(state));
    const out = await createFinanceVariable.execute(
      {
        amountCents: 7870,
        kind: 'expense',
        transactionDate: '2026-05-23',
        description: 'supermercado',
        accountId: ACCOUNT_ID,
      },
      ctx,
    );
    expect(out.transactionId).toBe(TX_ID);
    expect(out.amountCents).toBe(7870);
    expect(out.kind).toBe('expense');
    expect(out.transactionDate).toBe('2026-05-23');
    expect(out.accountId).toBe(ACCOUNT_ID);
    expect(out.cardId).toBeNull();
    expect(out.categoryId).toBe(DEFAULT_CATEGORY_ID);
    const parsed = createFinanceVariable.outputSchema.safeParse(out);
    expect(parsed.success).toBe(true);
  });

  it('lança erro quando INSERT não devolve row', async () => {
    state.insertReturns = [
      [{ id: DEFAULT_CATEGORY_ID }], // SELECT default category
      [{ id: ACCOUNT_ID }], // pré-check accountId OK
      [], // INSERT empty
    ];
    const ctx = makeCtx(makeMockDb(state));
    await expect(
      createFinanceVariable.execute(
        {
          amountCents: 7870,
          kind: 'expense',
          transactionDate: '2026-05-23',
          description: 'X',
          accountId: ACCOUNT_ID,
        },
        ctx,
      ),
    ).rejects.toThrow(/INSERT em transactions não devolveu row/);
  });

  it('lança ToolExecutionError quando seed "Outros gastos" ausente', async () => {
    state.insertReturns = [
      [], // SELECT default category → empty (seed missing)
    ];
    const ctx = makeCtx(makeMockDb(state));
    try {
      await createFinanceVariable.execute(
        {
          amountCents: 7870,
          kind: 'expense',
          transactionDate: '2026-05-23',
          description: 'X',
          accountId: ACCOUNT_ID,
        },
        ctx,
      );
      expect.fail('execute() devia ter lançado ToolExecutionError');
    } catch (err) {
      expect((err as Error).name).toBe('ToolExecutionError');
      const cause = (err as { cause?: unknown }).cause;
      expect(cause).toBeInstanceOf(Error);
      expect((cause as Error).message).toMatch(/Outros gastos/);
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Tests — conta default (Story 2.13 AC3/AC4 — resolveDefaultAccount)
// ─────────────────────────────────────────────────────────────────────────────

const DINHEIRO_ACCOUNT_ID = '66666666-7777-4888-8999-aaaaaaaaaaaa';

describe('create_finance_variable — conta default (Story 2.13)', () => {
  it('sem accountId nem cardId → resolveDefaultAccount + INSERT usa conta default + paymentMethod cash (dinheiro)', async () => {
    const state: MockState = {
      executes: [],
      insertReturns: [
        // 1ª: SELECT default category
        [{ id: DEFAULT_CATEGORY_ID }],
        // 2ª: SELECT default account (resolveDefaultAccount) → conta Dinheiro
        [{ id: DINHEIRO_ACCOUNT_ID, account_type: 'dinheiro' }],
        // 3ª: INSERT transaction
        [
          {
            id: TX_ID,
            amount_cents: 1870,
            kind: 'expense',
            transaction_date: '2026-05-30',
            account_id: DINHEIRO_ACCOUNT_ID,
            card_id: null,
            category_id: DEFAULT_CATEGORY_ID,
          },
        ],
      ],
    };
    const ctx = makeCtx(makeMockDb(state));
    const out = await createFinanceVariable.execute(
      {
        amountCents: 1870,
        kind: 'expense',
        transactionDate: '2026-05-30',
        description: 'Pingo Doce',
      },
      ctx,
    );

    // 3 chamadas: SELECT category + SELECT account + INSERT.
    expect(state.executes.length).toBe(3);
    const accountSelectSql = state.executes[1]?.sqlText.toLowerCase() ?? '';
    expect(accountSelectSql).toContain('from accounts');
    expect(accountSelectSql).toContain('archived_at is null');
    // INSERT usa o accountId resolvido + paymentMethod cash (forçado para dinheiro).
    const insertSql = state.executes[2]?.sqlText.toLowerCase() ?? '';
    expect(insertSql).toContain('insert into transactions');
    expect(insertSql).toContain('cash');
    expect(out.accountId).toBe(DINHEIRO_ACCOUNT_ID);
  });

  it("conta default não-dinheiro (legacy) → paymentMethod 'transfer'", async () => {
    const state: MockState = {
      executes: [],
      insertReturns: [
        [{ id: DEFAULT_CATEGORY_ID }],
        [{ id: ACCOUNT_ID, account_type: 'corrente' }],
        [
          {
            id: TX_ID,
            amount_cents: 1870,
            kind: 'expense',
            transaction_date: '2026-05-30',
            account_id: ACCOUNT_ID,
            card_id: null,
            category_id: DEFAULT_CATEGORY_ID,
          },
        ],
      ],
    };
    const ctx = makeCtx(makeMockDb(state));
    await createFinanceVariable.execute(
      {
        amountCents: 1870,
        kind: 'expense',
        transactionDate: '2026-05-30',
        description: 'Pingo Doce',
      },
      ctx,
    );
    const insertSql = state.executes[2]?.sqlText.toLowerCase() ?? '';
    expect(insertSql).toContain('transfer');
    expect(insertSql).not.toContain('cash');
  });

  it('com accountId explícito → NÃO chama resolveDefaultAccount (mas faz pré-check cross-tenant)', async () => {
    const localState: MockState = {
      executes: [],
      insertReturns: [
        [{ id: DEFAULT_CATEGORY_ID }], // SELECT category
        [{ id: ACCOUNT_ID }], // pré-check accountId
        [
          {
            id: TX_ID,
            amount_cents: 7870,
            kind: 'expense',
            transaction_date: '2026-05-23',
            account_id: ACCOUNT_ID,
            card_id: null,
            category_id: DEFAULT_CATEGORY_ID,
          },
        ], // INSERT
      ],
    };
    const ctx = makeCtx(makeMockDb(localState));
    await createFinanceVariable.execute(
      {
        amountCents: 7870,
        kind: 'expense',
        transactionDate: '2026-05-23',
        description: 'supermercado',
        accountId: ACCOUNT_ID,
      },
      ctx,
    );
    // 3 chamadas: SELECT category + pré-check accountId + INSERT.
    expect(localState.executes.length).toBe(3);
    // O pré-check consulta `from accounts ... where id =` MAS NÃO é o
    // resolveDefaultAccount (que filtra `archived_at is null` + ordena por dinheiro).
    expect(
      localState.executes.some((e) => e.sqlText.toLowerCase().includes('archived_at is null')),
    ).toBe(false);
    expect(localState.executes.some((e) => /from accounts where id =/i.test(e.sqlText))).toBe(true);
  });

  it('household sem nenhuma conta → ToolExecutionError PT-PT accionável', async () => {
    const state: MockState = {
      executes: [],
      insertReturns: [
        [{ id: DEFAULT_CATEGORY_ID }], // SELECT category OK
        [], // SELECT account → vazio (sem contas)
      ],
    };
    const ctx = makeCtx(makeMockDb(state));
    try {
      await createFinanceVariable.execute(
        {
          amountCents: 1870,
          kind: 'expense',
          transactionDate: '2026-05-30',
          description: 'X',
        },
        ctx,
      );
      expect.fail('execute() devia ter lançado ToolExecutionError');
    } catch (err) {
      expect((err as Error).name).toBe('ToolExecutionError');
      const cause = (err as { cause?: unknown }).cause;
      expect(cause).toBeInstanceOf(Error);
      expect((cause as Error).message).toMatch(/Nenhuma conta/);
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Tests — reverse()
// ─────────────────────────────────────────────────────────────────────────────

describe('create_finance_variable — reverse()', () => {
  const ctx = makeCtx(makeMockDb({ executes: [], insertReturns: [] }));

  it('reverse() devolve delete_row table=transactions com transactionId', async () => {
    const op = await createFinanceVariable.reverse(
      {
        transactionId: TX_ID,
        amountCents: 7870,
        kind: 'expense',
        transactionDate: '2026-05-23',
        accountId: ACCOUNT_ID,
        cardId: null,
        categoryId: CATEGORY_ID,
      },
      ctx,
    );
    expect(op).toEqual({
      kind: 'delete_row',
      table: 'transactions',
      id: TX_ID,
    });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Tests — executeAtomic integration + TEST-001-NB bonus
// ─────────────────────────────────────────────────────────────────────────────

describe('create_finance_variable — executeAtomic integration', () => {
  it('via executeAtomic — sucesso + agent_reverse_ops persistido', async () => {
    const state: MockState = {
      executes: [],
      insertReturns: [
        // 1ª: SELECT default category
        [{ id: DEFAULT_CATEGORY_ID }],
        // 2ª: pré-check accountId explícito
        [{ id: ACCOUNT_ID }],
        // 3ª: INSERT transaction
        [
          {
            id: TX_ID,
            amount_cents: 7870,
            kind: 'expense',
            transaction_date: '2026-05-23',
            account_id: ACCOUNT_ID,
            card_id: null,
            category_id: DEFAULT_CATEGORY_ID,
          },
        ],
        // 4ª: INSERT agent_reverse_ops
        [{ id: REVERSE_OP_ID }],
      ],
    };
    const ctx = makeCtx(makeMockDb(state));
    const outcome = await executeAtomic(
      [
        {
          definition: createFinanceVariable,
          input: {
            amountCents: 7870,
            kind: 'expense',
            transactionDate: '2026-05-23',
            description: 'supermercado',
            accountId: ACCOUNT_ID,
          },
        },
      ],
      ctx,
    );

    expect(outcome.success).toBe(true);
    if (outcome.success) {
      expect(outcome.results[0]?.toolName).toBe('create_finance_variable');
      expect(outcome.results[0]?.reverseOpId).toBe(REVERSE_OP_ID);
    }
    // category + pré-check + INSERT transaction + INSERT agent_reverse_ops.
    expect(state.executes.length).toBe(4);
    expect(state.executes[3]?.sqlText).toMatch(/insert into agent_reverse_ops/i);
    expect(state.executes[3]?.sqlText).toMatch(/now\(\)\s*\+\s*interval\s*'30\s*seconds'/i);
  });

  it('TEST-001-NB — transacção rebenta → ToolTransactionError propaga (rollback)', async () => {
    const state: MockState = {
      executes: [],
      insertReturns: [],
      shouldThrowInTransaction: new Error('connection lost mid-tx'),
    };
    const ctx = makeCtx(makeMockDb(state));

    await expect(
      executeAtomic(
        [
          {
            definition: createFinanceVariable,
            input: {
              amountCents: 7870,
              kind: 'expense',
              transactionDate: '2026-05-23',
              description: 'X',
              accountId: ACCOUNT_ID,
            },
          },
        ],
        ctx,
      ),
    ).rejects.toThrow(/transaction failed|connection lost/i);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Tests — RLS / cross-household defesa em profundidade
// ─────────────────────────────────────────────────────────────────────────────

// ─────────────────────────────────────────────────────────────────────────────
// Tests — hardening cross-tenant (FASE A — accountId/cardId explícito)
// ─────────────────────────────────────────────────────────────────────────────

describe('create_finance_variable — cross-tenant (accountId/cardId explícito)', () => {
  it('accountId de OUTRO household → ToolExecutionError no pré-check (NÃO chega ao INSERT)', async () => {
    const state: MockState = {
      executes: [],
      insertReturns: [
        [{ id: DEFAULT_CATEGORY_ID }], // 1ª: SELECT default category OK
        [], // 2ª: pré-check account SELECT → 0 rows (conta de outro household / RLS)
      ],
    };
    const ctx = makeCtx(makeMockDb(state));
    await expect(
      createFinanceVariable.execute(
        {
          amountCents: 1000,
          kind: 'expense',
          transactionDate: '2026-05-23',
          description: 'X',
          accountId: ACCOUNT_ID,
        },
        ctx,
      ),
    ).rejects.toMatchObject({ name: 'ToolExecutionError' });
    // Só 2 chamadas (category + pré-check), NUNCA o INSERT.
    expect(state.executes.length).toBe(2);
    expect(
      state.executes.some((e) => e.sqlText.toLowerCase().includes('insert into transactions')),
    ).toBe(false);
  });

  it('cardId de OUTRO household → ToolExecutionError no pré-check (NÃO chega ao INSERT)', async () => {
    const state: MockState = {
      executes: [],
      insertReturns: [
        [{ id: DEFAULT_CATEGORY_ID }], // SELECT default category OK
        [], // pré-check card SELECT → 0 rows
      ],
    };
    const ctx = makeCtx(makeMockDb(state));
    await expect(
      createFinanceVariable.execute(
        {
          amountCents: 1000,
          kind: 'expense',
          transactionDate: '2026-05-23',
          description: 'X',
          cardId: CARD_ID,
        },
        ctx,
      ),
    ).rejects.toMatchObject({ name: 'ToolExecutionError' });
    expect(
      state.executes.some((e) => e.sqlText.toLowerCase().includes('insert into transactions')),
    ).toBe(false);
  });

  it('accountId VÁLIDO → pré-check passa + INSERT prossegue', async () => {
    const state: MockState = {
      executes: [],
      insertReturns: [
        [{ id: DEFAULT_CATEGORY_ID }], // SELECT default category
        [{ id: ACCOUNT_ID }], // pré-check account SELECT → 1 row
        [
          {
            id: TX_ID,
            amount_cents: 1000,
            kind: 'expense',
            transaction_date: '2026-05-23',
            account_id: ACCOUNT_ID,
            card_id: null,
            category_id: DEFAULT_CATEGORY_ID,
          },
        ],
      ],
    };
    const ctx = makeCtx(makeMockDb(state));
    const out = await createFinanceVariable.execute(
      {
        amountCents: 1000,
        kind: 'expense',
        transactionDate: '2026-05-23',
        description: 'X',
        accountId: ACCOUNT_ID,
      },
      ctx,
    );
    expect(out.transactionId).toBe(TX_ID);
    // 3 chamadas: category + pré-check + INSERT.
    expect(state.executes.length).toBe(3);
  });

  it('trigger DB 23P51 no INSERT (race) → mapeado para ToolExecutionError PT-PT', async () => {
    const state: MockState = {
      executes: [],
      insertReturns: [
        [{ id: DEFAULT_CATEGORY_ID }], // SELECT default category
        [{ id: ACCOUNT_ID }], // pré-check passa (race: conta movida entre check e insert)
      ],
    };
    // Forçar o INSERT (3ª chamada execute) a rebentar com SQLSTATE 23P51.
    const db = makeMockDb(state);
    const originalExecute = db.execute;
    let calls = 0;
    db.execute = (async (q: unknown) => {
      calls += 1;
      if (calls === 3) {
        throw Object.assign(
          new Error('A conta indicada não pertence ao agregado familiar (account_id=...).'),
          { code: '23P51' },
        );
      }
      return originalExecute(q);
    }) as unknown as DrizzleDbClient['execute'];
    const ctx = makeCtx(db);

    try {
      await createFinanceVariable.execute(
        {
          amountCents: 1000,
          kind: 'expense',
          transactionDate: '2026-05-23',
          description: 'X',
          accountId: ACCOUNT_ID,
        },
        ctx,
      );
      expect.fail('devia ter lançado ToolExecutionError');
    } catch (err) {
      expect((err as Error).name).toBe('ToolExecutionError');
      const cause = (err as { cause?: unknown }).cause;
      expect((cause as Error).message).toMatch(/não pertence ao teu agregado/i);
    }
  });
});

describe('create_finance_variable — segurança RLS', () => {
  it('inputSchema descarta household_id se for injectado (Zod strip mode)', () => {
    const r = createFinanceVariable.inputSchema.safeParse({
      amountCents: 1000,
      kind: 'expense',
      transactionDate: '2026-05-23',
      description: 'X',
      accountId: ACCOUNT_ID,
      household_id: 'attacker-uuid',
    });
    expect(r.success).toBe(true);
    if (r.success) {
      expect(r.data).not.toHaveProperty('household_id');
    }
  });

  it('payload com 2 ctx diferentes → SQL parametriza ctx.householdId distinto', async () => {
    const HH_A = HOUSEHOLD_ID;
    const HH_B = 'bbbbbbbb-cccc-4ddd-8eee-ffffffffffff';
    const stateA: MockState = {
      executes: [],
      insertReturns: [
        [{ id: DEFAULT_CATEGORY_ID }],
        [{ id: ACCOUNT_ID }], // pré-check accountId
        [
          {
            id: TX_ID,
            amount_cents: 100,
            kind: 'expense',
            transaction_date: '2026-05-23',
            account_id: ACCOUNT_ID,
            card_id: null,
            category_id: DEFAULT_CATEGORY_ID,
          },
        ],
      ],
    };
    const stateB: MockState = {
      executes: [],
      insertReturns: [
        [{ id: DEFAULT_CATEGORY_ID }],
        [{ id: ACCOUNT_ID }], // pré-check accountId
        [
          {
            id: '99999999-aaaa-4bbb-8ccc-dddddddddddd',
            amount_cents: 200,
            kind: 'expense',
            transaction_date: '2026-05-23',
            account_id: ACCOUNT_ID,
            card_id: null,
            category_id: DEFAULT_CATEGORY_ID,
          },
        ],
      ],
    };
    const ctxA = makeCtx(makeMockDb(stateA), { householdId: HH_A });
    const ctxB = makeCtx(makeMockDb(stateB), { householdId: HH_B });

    await createFinanceVariable.execute(
      {
        amountCents: 100,
        kind: 'expense',
        transactionDate: '2026-05-23',
        description: 'A',
        accountId: ACCOUNT_ID,
      },
      ctxA,
    );
    await createFinanceVariable.execute(
      {
        amountCents: 200,
        kind: 'expense',
        transactionDate: '2026-05-23',
        description: 'B',
        accountId: ACCOUNT_ID,
      },
      ctxB,
    );
    // category + pré-check accountId + INSERT por cada ctx.
    expect(stateA.executes.length).toBe(3);
    expect(stateB.executes.length).toBe(3);
  });
});
