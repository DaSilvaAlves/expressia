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

  it('200 agrega múltiplas contas activas', async () => {
    authed();
    // sum devolve string (Postgres numeric); count int.
    mocks.dbExecuteMock.mockResolvedValue([
      { account_count: 3, total_balance_cents: '1234567' },
    ]);
    const res = await GET();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.accountCount).toBe(3);
    expect(body.totalBalanceCents).toBe(1234567);
    expect(body.currency).toBe('EUR');
  });

  it('200 sem contas activas — totais a 0', async () => {
    authed();
    // SUM sobre tabela vazia devolve NULL.
    mocks.dbExecuteMock.mockResolvedValue([
      { account_count: 0, total_balance_cents: null },
    ]);
    const res = await GET();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.accountCount).toBe(0);
    expect(body.totalBalanceCents).toBe(0);
    expect(body.currency).toBe('EUR');
  });
});
