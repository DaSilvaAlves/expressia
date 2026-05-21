// @vitest-environment node
/**
 * Testes mockable-friendly — GET / POST /api/financas/categorias (Story 4.3 AC2 + AC10).
 *
 * Cobre: auth (401), listagem (globais + per-household), filtro `kind`, Zod
 * `.strict()` (400), validação `parent_id` (404 inexistente, 400 sub-categoria),
 * happy path (201), nome duplicado → 409 (PO_FIX F1).
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

const { GET, POST } = await import('@/app/api/financas/categorias/route');

const USER_UUID = '00000000-0000-0000-0000-000000000001';
const HOUSEHOLD_UUID = '00000000-0000-0000-0000-000000000002';
const PARENT_UUID = '00000000-0000-0000-0000-0000000000c1'.replace(/c/g, '5');

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
  return new NextRequest(new Request(`http://localhost/api/financas/categorias${qs}`));
}

function postReq(body: unknown) {
  return new NextRequest(
    new Request('http://localhost/api/financas/categorias', {
      method: 'POST',
      body: JSON.stringify(body),
      headers: { 'content-type': 'application/json' },
    }),
  );
}

describe('GET /api/financas/categorias', () => {
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

  it('200 lista categorias (globais + per-household via RLS)', async () => {
    authed();
    mocks.dbExecuteMock.mockResolvedValue([
      { id: 'c1', name: 'Alimentação', household_id: null },
      { id: 'c2', name: 'Renda', household_id: HOUSEHOLD_UUID },
    ]);
    const res = await GET(getReq());
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.categories).toHaveLength(2);
  });

  it('200 com filtro kind', async () => {
    authed();
    mocks.dbExecuteMock.mockResolvedValue([{ id: 'c3', name: 'Salário', kind: 'income' }]);
    const res = await GET(getReq('?kind=income'));
    expect(res.status).toBe(200);
  });
});

describe('POST /api/financas/categorias', () => {
  beforeEach(() => {
    mocks.getUserMock.mockReset();
    mocks.fromMock.mockReset();
    mocks.dbExecuteMock.mockReset();
  });

  it('400 VALIDATION_ERROR se name ausente', async () => {
    authed();
    const res = await POST(postReq({}));
    expect(res.status).toBe(400);
  });

  it('400 VALIDATION_ERROR se body inclui household_id (Zod strict)', async () => {
    authed();
    const res = await POST(postReq({ name: 'Maliciosa', household_id: HOUSEHOLD_UUID }));
    expect(res.status).toBe(400);
  });

  it('404 NOT_FOUND se parent_id não existe', async () => {
    authed();
    mocks.dbExecuteMock.mockResolvedValueOnce([]); // verificação parent_id
    const res = await POST(postReq({ name: 'Sub', parent_id: PARENT_UUID }));
    expect(res.status).toBe(404);
  });

  it('400 VALIDATION_ERROR se parent_id aponta a uma sub-categoria (1-nível)', async () => {
    authed();
    mocks.dbExecuteMock.mockResolvedValueOnce([{ id: PARENT_UUID, parent_id: 'outra' }]);
    const res = await POST(postReq({ name: 'Sub', parent_id: PARENT_UUID }));
    expect(res.status).toBe(400);
  });

  it('201 cria categoria per-household', async () => {
    authed();
    mocks.dbExecuteMock
      .mockResolvedValueOnce([{ id: 'new-cat', name: 'Combustível', kind: 'expense' }]) // INSERT
      .mockResolvedValueOnce([]); // audit
    const res = await POST(postReq({ name: 'Combustível' }));
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.category.id).toBe('new-cat');
  });

  it('409 CONFLICT se nome duplicado (PO_FIX F1 — categories_unique_global_name)', async () => {
    authed();
    mocks.dbExecuteMock.mockRejectedValueOnce(
      new Error(
        'duplicate key value violates unique constraint "categories_unique_global_name"',
      ),
    );
    const res = await POST(postReq({ name: 'Alimentação' }));
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.error.code).toBe('CONFLICT');
  });
});
