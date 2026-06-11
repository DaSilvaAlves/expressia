// @vitest-environment node
/**
 * Testes — GET /api/visao/saldo-contas (Story 5.5 AC5 + AC9).
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  getUserMock: vi.fn(),
  fromMock: vi.fn(),
  dbExecuteMock: vi.fn(),
}));

vi.mock('@meu-jarvis/auth/server', () => ({
  createServerSupabaseClient: vi.fn(async () => ({
    auth: { getUser: mocks.getUserMock },
    from: mocks.fromMock,
  })),
}));

vi.mock('@/lib/agent/db-shim', () => ({
  getDb: () => ({ execute: mocks.dbExecuteMock }),
  // SEC-6 — `withHousehold` executa o callback com o fake db (a transação real é
  // provada pelo gate de aplicação `db-test`, não aqui).
  withHousehold: (_auth: unknown, fn: (tx: unknown) => unknown) =>
    fn({ execute: mocks.dbExecuteMock }),
}));

const { GET } = await import('@/app/api/visao/saldo-contas/route');

function memberChain(householdId: string | null) {
  return {
    select: vi.fn().mockReturnValue({
      eq: vi.fn().mockReturnValue({
        limit: vi.fn().mockReturnValue({
          maybeSingle: vi.fn().mockResolvedValue({
            data: householdId ? { household_id: householdId } : null,
            error: null,
          }),
        }),
      }),
    }),
  };
}

function authed() {
  mocks.getUserMock.mockResolvedValue({
    data: { user: { id: '00000000-0000-0000-0000-000000000001' } },
    error: null,
  });
  mocks.fromMock.mockReturnValue(memberChain('00000000-0000-0000-0000-000000000002'));
}

describe('GET /api/visao/saldo-contas', () => {
  beforeEach(() => {
    mocks.getUserMock.mockReset();
    mocks.fromMock.mockReset();
    mocks.dbExecuteMock.mockReset();
  });

  it('401 AUTH_REQUIRED se sem sessão', async () => {
    mocks.getUserMock.mockResolvedValue({ data: { user: null }, error: null });
    const res = await GET();
    expect(res.status).toBe(401);
  });

  it('200 agrega múltiplas contas activas (saldo computado on-read, não a coluna morta)', async () => {
    authed();
    // `getAccountBalanceMap` faz 2 execute em ordem: contas, somas por conta.
    // 3 contas activas: saldo = initial + income − expense.
    //   acc-1: 100000 + 200000 − 50000 = 250000
    //   acc-2: 500000 + 0 − 0           = 500000
    //   acc-3: 484567 + 0 − 0           = 484567   → total 1234567
    mocks.dbExecuteMock
      .mockResolvedValueOnce([
        { id: 'acc-1', initial_balance_cents: 100000 },
        { id: 'acc-2', initial_balance_cents: 500000 },
        { id: 'acc-3', initial_balance_cents: 484567 },
      ])
      .mockResolvedValueOnce([
        { account_id: 'acc-1', income_cents: 200000, expense_cents: 50000 },
      ]);
    const res = await GET();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.accountCount).toBe(3);
    expect(body.totalBalanceCents).toBe(1234567);
    expect(body.currency).toBe('EUR');
  });

  it('200 conta com despesas — saldo computado (despesas reduzem o saldo)', async () => {
    authed();
    // 1 conta: initial 30000 + income 0 − expense 12200 = 17800 (a coluna stored
    // `balance_cents` seria irrelevante — não é lida).
    mocks.dbExecuteMock
      .mockResolvedValueOnce([{ id: 'acc-1', initial_balance_cents: 30000 }])
      .mockResolvedValueOnce([
        { account_id: 'acc-1', income_cents: 0, expense_cents: 12200 },
      ]);
    const res = await GET();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.accountCount).toBe(1);
    expect(body.totalBalanceCents).toBe(17800);
    expect(body.currency).toBe('EUR');
  });

  it('200 saldo negativo (descoberto) suportado', async () => {
    authed();
    // initial 5000 + income 1000 − expense 20000 = -14000.
    mocks.dbExecuteMock
      .mockResolvedValueOnce([{ id: 'acc-1', initial_balance_cents: 5000 }])
      .mockResolvedValueOnce([
        { account_id: 'acc-1', income_cents: 1000, expense_cents: 20000 },
      ]);
    const res = await GET();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.accountCount).toBe(1);
    expect(body.totalBalanceCents).toBe(-14000);
  });

  it('200 sem contas activas — totais a 0', async () => {
    authed();
    // Sem contas → Map vazio → size 0, total 0.
    mocks.dbExecuteMock
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([]);
    const res = await GET();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.accountCount).toBe(0);
    expect(body.totalBalanceCents).toBe(0);
    expect(body.currency).toBe('EUR');
  });
});
