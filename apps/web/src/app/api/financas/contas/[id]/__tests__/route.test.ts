// @vitest-environment node
/**
 * Testes mockable-friendly — GET / PATCH / DELETE /api/financas/contas/[id]
 * (Story 4.2 AC1 + AC5 + AC10).
 *
 * Cobre: GET single (200/404/400 id inválido), PATCH (200, 400 currency immutable),
 * DELETE soft-delete via `archived_at` + variant `accounts_delete_owner_admin`
 * (403 member, 200 owner).
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
  // SEC-3: a operação principal passou a correr dentro de `withHousehold`. O mock
  // injecta um `tx` equivalente (`execute` é o único exercido pelas queries).
  withHousehold: (
    _auth: { userId: string; householdId: string },
    fn: (tx: { execute: typeof mocks.dbExecuteMock }) => unknown,
  ) => fn({ execute: mocks.dbExecuteMock }),
}));

import { NextRequest } from 'next/server';

const { GET, PATCH, DELETE } = await import('@/app/api/financas/contas/[id]/route');

const USER_UUID = '00000000-0000-0000-0000-000000000001';
const HOUSEHOLD_UUID = '00000000-0000-0000-0000-000000000002';
const ACCOUNT_UUID = '00000000-0000-0000-0000-0000000000a1';

function memberChain(field: string, value: unknown) {
  return {
    select: vi.fn().mockReturnValue({
      eq: vi.fn().mockReturnValue({
        limit: vi.fn().mockReturnValue({
          maybeSingle: vi
            .fn()
            .mockResolvedValue({ data: value ? { [field]: value } : null, error: null }),
        }),
        eq: vi.fn().mockReturnValue({
          limit: vi.fn().mockReturnValue({
            maybeSingle: vi
              .fn()
              .mockResolvedValue({ data: value ? { [field]: value } : null, error: null }),
          }),
        }),
      }),
    }),
  };
}

function authedAs(role: 'owner' | 'admin' | 'member') {
  mocks.getUserMock.mockResolvedValue({ data: { user: { id: USER_UUID } }, error: null });
  let callCount = 0;
  mocks.fromMock.mockImplementation(() => {
    callCount++;
    if (callCount === 1) return memberChain('household_id', HOUSEHOLD_UUID);
    return memberChain('role', role);
  });
}

const ctx = { params: Promise.resolve({ id: ACCOUNT_UUID }) };

function patchReq(body: unknown) {
  return new NextRequest(
    new Request(`http://localhost/api/financas/contas/${ACCOUNT_UUID}`, {
      method: 'PATCH',
      body: JSON.stringify(body),
      headers: { 'content-type': 'application/json' },
    }),
  );
}

describe('GET /api/financas/contas/[id]', () => {
  beforeEach(() => {
    mocks.getUserMock.mockReset();
    mocks.fromMock.mockReset();
    mocks.dbExecuteMock.mockReset();
  });

  it('400 VALIDATION_ERROR se id não é UUID', async () => {
    authedAs('owner');
    const res = await GET(new NextRequest(new Request('http://localhost/x')), {
      params: Promise.resolve({ id: 'nao-uuid' }),
    });
    expect(res.status).toBe(400);
  });

  it('200 devolve conta', async () => {
    authedAs('owner');
    mocks.dbExecuteMock.mockResolvedValue([{ id: ACCOUNT_UUID, name: 'CGD' }]);
    const res = await GET(new NextRequest(new Request('http://localhost/x')), ctx);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.account.id).toBe(ACCOUNT_UUID);
  });

  it('404 NOT_FOUND se não existe ou cross-household (RLS)', async () => {
    authedAs('owner');
    mocks.dbExecuteMock.mockResolvedValue([]);
    const res = await GET(new NextRequest(new Request('http://localhost/x')), ctx);
    expect(res.status).toBe(404);
  });
});

describe('PATCH /api/financas/contas/[id]', () => {
  beforeEach(() => {
    mocks.getUserMock.mockReset();
    mocks.fromMock.mockReset();
    mocks.dbExecuteMock.mockReset();
  });

  it('400 VALIDATION_ERROR se body inclui currency (immutable — Zod strict)', async () => {
    authedAs('owner');
    const res = await PATCH(patchReq({ currency: 'USD' }), ctx);
    expect(res.status).toBe(400);
  });

  it('200 actualiza nome da conta', async () => {
    authedAs('owner');
    mocks.dbExecuteMock
      .mockResolvedValueOnce([{ id: ACCOUNT_UUID, name: 'CGD Renomeada', account_type: 'corrente' }])
      .mockResolvedValueOnce([]);
    const res = await PATCH(patchReq({ name: 'CGD Renomeada' }), ctx);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.account.name).toBe('CGD Renomeada');
  });
});

describe('DELETE /api/financas/contas/[id] — variant accounts_delete_owner_admin', () => {
  beforeEach(() => {
    mocks.getUserMock.mockReset();
    mocks.fromMock.mockReset();
    mocks.dbExecuteMock.mockReset();
  });

  it('403 FORBIDDEN se role=member', async () => {
    authedAs('member');
    const res = await DELETE(
      new NextRequest(new Request('http://localhost/x', { method: 'DELETE' })),
      ctx,
    );
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.error.code).toBe('FORBIDDEN');
    expect(body.error.message).toMatch(/owner ou admin/i);
  });

  it('200 archived=true se role=owner (soft delete via archived_at)', async () => {
    authedAs('owner');
    mocks.dbExecuteMock
      .mockResolvedValueOnce([{ id: ACCOUNT_UUID }])
      .mockResolvedValueOnce([]);
    const res = await DELETE(
      new NextRequest(new Request('http://localhost/x', { method: 'DELETE' })),
      ctx,
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.archived).toBe(true);
  });

  it('404 NOT_FOUND se conta não existe (UPDATE rows=0)', async () => {
    authedAs('admin');
    mocks.dbExecuteMock.mockResolvedValue([]);
    const res = await DELETE(
      new NextRequest(new Request('http://localhost/x', { method: 'DELETE' })),
      ctx,
    );
    expect(res.status).toBe(404);
  });
});
