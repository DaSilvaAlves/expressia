// @vitest-environment node
/**
 * Testes mockable-friendly — GET / PATCH / DELETE /api/financas/categorias/[id]
 * (Story 4.3 AC2 + AC5 + AC10).
 *
 * Cobre: GET single (200/404/400 id inválido), PATCH (200, 409 nome duplicado),
 * DELETE soft-delete via `archived_at` (200, 404 categoria global / inexistente).
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

const { GET, PATCH, DELETE } = await import('@/app/api/financas/categorias/[id]/route');

const USER_UUID = '00000000-0000-0000-0000-000000000001';
const HOUSEHOLD_UUID = '00000000-0000-0000-0000-000000000002';
const CATEGORY_UUID = '00000000-0000-0000-0000-0000000000c1'.replace(/c/g, '5');

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

const ctx = { params: Promise.resolve({ id: CATEGORY_UUID }) };

function plainReq(method = 'GET') {
  return new NextRequest(new Request('http://localhost/x', { method }));
}

function patchReq(body: unknown) {
  return new NextRequest(
    new Request(`http://localhost/api/financas/categorias/${CATEGORY_UUID}`, {
      method: 'PATCH',
      body: JSON.stringify(body),
      headers: { 'content-type': 'application/json' },
    }),
  );
}

describe('GET /api/financas/categorias/[id]', () => {
  beforeEach(() => {
    mocks.getUserMock.mockReset();
    mocks.fromMock.mockReset();
    mocks.dbExecuteMock.mockReset();
  });

  it('400 VALIDATION_ERROR se id não é UUID', async () => {
    authed();
    const res = await GET(plainReq(), { params: Promise.resolve({ id: 'nao-uuid' }) });
    expect(res.status).toBe(400);
  });

  it('200 devolve categoria', async () => {
    authed();
    mocks.dbExecuteMock.mockResolvedValue([{ id: CATEGORY_UUID, name: 'Alimentação' }]);
    const res = await GET(plainReq(), ctx);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.category.id).toBe(CATEGORY_UUID);
  });

  it('404 NOT_FOUND se não existe ou cross-household (RLS)', async () => {
    authed();
    mocks.dbExecuteMock.mockResolvedValue([]);
    const res = await GET(plainReq(), ctx);
    expect(res.status).toBe(404);
  });
});

describe('PATCH /api/financas/categorias/[id]', () => {
  beforeEach(() => {
    mocks.getUserMock.mockReset();
    mocks.fromMock.mockReset();
    mocks.dbExecuteMock.mockReset();
  });

  it('200 actualiza categoria', async () => {
    authed();
    mocks.dbExecuteMock
      .mockResolvedValueOnce([{ id: CATEGORY_UUID, name: 'Renomeada', kind: 'expense' }]) // UPDATE
      .mockResolvedValueOnce([]); // audit
    const res = await PATCH(patchReq({ name: 'Renomeada' }), ctx);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.category.name).toBe('Renomeada');
  });

  it('409 CONFLICT se renomear para nome duplicado (PO_FIX F1)', async () => {
    authed();
    mocks.dbExecuteMock.mockRejectedValueOnce(
      new Error(
        'duplicate key value violates unique constraint "categories_unique_global_name"',
      ),
    );
    const res = await PATCH(patchReq({ name: 'Alimentação' }), ctx);
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.error.code).toBe('CONFLICT');
  });
});

describe('DELETE /api/financas/categorias/[id]', () => {
  beforeEach(() => {
    mocks.getUserMock.mockReset();
    mocks.fromMock.mockReset();
    mocks.dbExecuteMock.mockReset();
  });

  it('200 archived=true (soft delete via archived_at)', async () => {
    authed();
    mocks.dbExecuteMock
      .mockResolvedValueOnce([{ id: CATEGORY_UUID }]) // UPDATE archived_at
      .mockResolvedValueOnce([]); // audit
    const res = await DELETE(plainReq('DELETE'), ctx);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.archived).toBe(true);
  });

  it('404 NOT_FOUND se categoria global ou inexistente (UPDATE rows=0)', async () => {
    authed();
    mocks.dbExecuteMock.mockResolvedValueOnce([]);
    const res = await DELETE(plainReq('DELETE'), ctx);
    expect(res.status).toBe(404);
  });
});
