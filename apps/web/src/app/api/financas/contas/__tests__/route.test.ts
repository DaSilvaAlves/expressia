// @vitest-environment node
/**
 * Testes mockable-friendly — GET / POST /api/financas/contas (Story 4.2 AC1 + AC10).
 *
 * Cobre: auth (401), Zod `.strict()` (400 household_id rejeitado), happy path
 * (201 com balance_cents = initial_balance_cents), filtro `archived`.
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

// Apenas `getDb` é mockado — os route handlers de Finanças NUNCA usam o cliente
// service-role (AC4 / R-4.7), portanto o factory não o fornece.
vi.mock('@/lib/agent/db-shim', () => ({
  getDb: () => ({ execute: mocks.dbExecuteMock }),
}));

import { NextRequest } from 'next/server';

const { GET, POST } = await import('@/app/api/financas/contas/route');

const USER_UUID = '00000000-0000-0000-0000-000000000001';
const HOUSEHOLD_UUID = '00000000-0000-0000-0000-000000000002';

function memberChain(field: string, value: unknown) {
  return {
    select: vi.fn().mockReturnValue({
      eq: vi.fn().mockReturnValue({
        limit: vi.fn().mockReturnValue({
          maybeSingle: vi
            .fn()
            .mockResolvedValue({ data: value ? { [field]: value } : null, error: null }),
        }),
      }),
    }),
  };
}

function authed() {
  mocks.getUserMock.mockResolvedValue({ data: { user: { id: USER_UUID } }, error: null });
  mocks.fromMock.mockReturnValue(memberChain('household_id', HOUSEHOLD_UUID));
}

function getReq(qs = '') {
  return new NextRequest(new Request(`http://localhost/api/financas/contas${qs}`));
}

function postReq(body: unknown) {
  return new NextRequest(
    new Request('http://localhost/api/financas/contas', {
      method: 'POST',
      body: JSON.stringify(body),
      headers: { 'content-type': 'application/json' },
    }),
  );
}

describe('GET /api/financas/contas', () => {
  beforeEach(() => {
    mocks.getUserMock.mockReset();
    mocks.fromMock.mockReset();
    mocks.dbExecuteMock.mockReset();
  });

  it('401 AUTH_REQUIRED se sem auth', async () => {
    mocks.getUserMock.mockResolvedValue({ data: { user: null }, error: null });
    const res = await GET(getReq());
    expect(res.status).toBe(401);
  });

  it('200 lista contas activas (archived_at IS NULL)', async () => {
    authed();
    mocks.dbExecuteMock.mockResolvedValue([
      { id: 'a1', name: 'CGD', balance_cents: 1000 },
      { id: 'a2', name: 'Revolut', balance_cents: 500 },
    ]);
    const res = await GET(getReq());
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.accounts).toHaveLength(2);
  });

  it('200 com archived=true devolve contas arquivadas', async () => {
    authed();
    mocks.dbExecuteMock.mockResolvedValue([{ id: 'a3', name: 'Conta velha' }]);
    const res = await GET(getReq('?archived=true'));
    expect(res.status).toBe(200);
  });
});

describe('POST /api/financas/contas', () => {
  beforeEach(() => {
    mocks.getUserMock.mockReset();
    mocks.fromMock.mockReset();
    mocks.dbExecuteMock.mockReset();
  });

  it('400 VALIDATION_ERROR se name ausente', async () => {
    authed();
    const res = await POST(postReq({}));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error.code).toBe('VALIDATION_ERROR');
  });

  it('400 VALIDATION_ERROR se body inclui household_id (Zod strict — RLS leak defense)', async () => {
    authed();
    const res = await POST(
      postReq({ name: 'Maliciosa', household_id: '99999999-9999-9999-9999-999999999999' }),
    );
    expect(res.status).toBe(400);
  });

  it('400 VALIDATION_ERROR se body inclui currency (immutable)', async () => {
    authed();
    const res = await POST(postReq({ name: 'X', currency: 'USD' }));
    expect(res.status).toBe(400);
  });

  it('201 cria conta — balance_cents inicializado = initial_balance_cents', async () => {
    authed();
    mocks.dbExecuteMock
      .mockResolvedValueOnce([
        {
          id: 'new-account',
          name: 'CGD',
          account_type: 'corrente',
          balance_cents: 5000,
          initial_balance_cents: 5000,
          currency: 'EUR',
        },
      ])
      .mockResolvedValueOnce([]);
    const res = await POST(postReq({ name: 'CGD', initial_balance_cents: 5000 }));
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.account.balance_cents).toBe(5000);
    expect(body.account.initial_balance_cents).toBe(5000);
  });
});
