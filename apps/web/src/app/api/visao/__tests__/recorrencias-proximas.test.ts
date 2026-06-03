// @vitest-environment node
/**
 * Testes — GET /api/visao/recorrencias-proximas (Story 5.5 AC4 + AC9).
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

const { GET } = await import('@/app/api/visao/recorrencias-proximas/route');

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

describe('GET /api/visao/recorrencias-proximas', () => {
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

  it('200 com recorrências activas nos próximos 30 dias', async () => {
    authed();
    mocks.dbExecuteMock.mockResolvedValue([
      {
        id: '00000000-0000-0000-0000-0000000000c1',
        description: 'Renda',
        kind: 'expense',
        amount_cents: 75000,
        frequency: 'monthly',
        next_run_on: '2026-06-01',
      },
      {
        id: '00000000-0000-0000-0000-0000000000c2',
        description: 'Salário',
        kind: 'income',
        amount_cents: 250000,
        frequency: 'monthly',
        next_run_on: '2026-06-23',
      },
    ]);
    const res = await GET();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.count).toBe(2);
    expect(body.recurrences[0].kind).toBe('expense');
    expect(body.recurrences[0].amountCents).toBe(75000);
    expect(body.recurrences[0].nextRunOn).toBe('2026-06-01');
    expect(body.recurrences[1].frequency).toBe('monthly');
  });

  it('200 sem recorrências na janela — lista vazia', async () => {
    authed();
    mocks.dbExecuteMock.mockResolvedValue([]);
    const res = await GET();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.count).toBe(0);
    expect(body.recurrences).toEqual([]);
  });
});
