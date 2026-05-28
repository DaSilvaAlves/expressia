// @vitest-environment node
/**
 * Testes — GET /api/visao/financas-mes (Story 5.5 AC3 + AC9).
 *
 * Cobre: 401, 200 com mix de income+expense, 200 sem transacções (tudo 0).
 * Inclui caso `sum` devolve string (Postgres `numeric` → JS string).
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
}));

const { GET } = await import('@/app/api/visao/financas-mes/route');

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

describe('GET /api/visao/financas-mes', () => {
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

  it('200 com mix income/expense — balance correcto, currency EUR', async () => {
    authed();
    // `sum` Drizzle/Postgres devolve string (numeric); o handler defensivamente
    // parseia com Number.isFinite (D-5.5.3). transfer entra no count mas não
    // no balance.
    mocks.dbExecuteMock.mockResolvedValue([
      { kind: 'income', total_cents: '180000', transaction_count: 3 },
      { kind: 'expense', total_cents: '78700', transaction_count: 12 },
      { kind: 'transfer', total_cents: '50000', transaction_count: 2 },
    ]);
    const res = await GET();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.incomeTotal).toBe(180000);
    expect(body.expenseTotal).toBe(78700);
    expect(body.balance).toBe(180000 - 78700);
    expect(body.transactionCount).toBe(17);
    expect(body.currency).toBe('EUR');
  });

  it('200 sem transacções no mês — tudo 0', async () => {
    authed();
    mocks.dbExecuteMock.mockResolvedValue([]);
    const res = await GET();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.incomeTotal).toBe(0);
    expect(body.expenseTotal).toBe(0);
    expect(body.balance).toBe(0);
    expect(body.transactionCount).toBe(0);
    expect(body.currency).toBe('EUR');
  });
});
