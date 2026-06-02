// @vitest-environment node
/**
 * Testes mockable-friendly — GET / PATCH / DELETE /api/financas/cartoes/[id]
 * (Story 4.2 AC2 + AC5 + AC10).
 *
 * Cobre: GET single (200/404), PATCH (200, 400 account_id immutable, 400 via
 * CHECK cards_credit_needs_limit), DELETE soft-delete + variant
 * `cards_delete_owner_admin` (403 member, 200 owner).
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

const { GET, PATCH, DELETE } = await import('@/app/api/financas/cartoes/[id]/route');

const USER_UUID = '00000000-0000-0000-0000-000000000001';
const HOUSEHOLD_UUID = '00000000-0000-0000-0000-000000000002';
const CARD_UUID = '00000000-0000-0000-0000-0000000000c1';

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

const ctx = { params: Promise.resolve({ id: CARD_UUID }) };

function patchReq(body: unknown) {
  return new NextRequest(
    new Request(`http://localhost/api/financas/cartoes/${CARD_UUID}`, {
      method: 'PATCH',
      body: JSON.stringify(body),
      headers: { 'content-type': 'application/json' },
    }),
  );
}

describe('GET /api/financas/cartoes/[id]', () => {
  beforeEach(() => {
    mocks.getUserMock.mockReset();
    mocks.fromMock.mockReset();
    mocks.dbExecuteMock.mockReset();
  });

  it('200 devolve cartão', async () => {
    authedAs('owner');
    mocks.dbExecuteMock.mockResolvedValue([{ id: CARD_UUID, name: 'Visa' }]);
    const res = await GET(new NextRequest(new Request('http://localhost/x')), ctx);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.card.id).toBe(CARD_UUID);
  });

  it('404 NOT_FOUND se não existe ou cross-household (RLS)', async () => {
    authedAs('owner');
    mocks.dbExecuteMock.mockResolvedValue([]);
    const res = await GET(new NextRequest(new Request('http://localhost/x')), ctx);
    expect(res.status).toBe(404);
  });
});

describe('PATCH /api/financas/cartoes/[id]', () => {
  beforeEach(() => {
    mocks.getUserMock.mockReset();
    mocks.fromMock.mockReset();
    mocks.dbExecuteMock.mockReset();
  });

  it('400 VALIDATION_ERROR se body inclui account_id (immutable — Zod strict)', async () => {
    authedAs('owner');
    const res = await PATCH(patchReq({ account_id: HOUSEHOLD_UUID }), ctx);
    expect(res.status).toBe(400);
  });

  it('200 actualiza nome do cartão', async () => {
    authedAs('owner');
    mocks.dbExecuteMock
      .mockResolvedValueOnce([{ id: CARD_UUID, name: 'Visa Gold', card_type: 'credit' }])
      .mockResolvedValueOnce([]);
    const res = await PATCH(patchReq({ name: 'Visa Gold' }), ctx);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.card.name).toBe('Visa Gold');
  });

  it('400 VALIDATION_ERROR se CHECK cards_credit_needs_limit violado', async () => {
    authedAs('owner');
    mocks.dbExecuteMock.mockRejectedValueOnce(
      new Error('new row violates check constraint "cards_credit_needs_limit"'),
    );
    const res = await PATCH(patchReq({ card_type: 'credit' }), ctx);
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error.code).toBe('VALIDATION_ERROR');
  });
});

describe('DELETE /api/financas/cartoes/[id] — variant cards_delete_owner_admin', () => {
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
  });

  it('200 archived=true se role=owner (soft delete via archived_at)', async () => {
    authedAs('owner');
    mocks.dbExecuteMock
      .mockResolvedValueOnce([{ id: CARD_UUID }])
      .mockResolvedValueOnce([]);
    const res = await DELETE(
      new NextRequest(new Request('http://localhost/x', { method: 'DELETE' })),
      ctx,
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.archived).toBe(true);
  });
});
