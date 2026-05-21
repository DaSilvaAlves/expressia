// @vitest-environment node
/**
 * Testes mockable-friendly — GET / DELETE /api/financas/prestacoes/[id]
 * (Story 4.4 AC2 + AC10).
 *
 * Cobre: GET single + 404 RLS, DELETE cascata (transactions + installment) +
 * `transactions_deleted` count + 404 RLS, ID inválido (400).
 *
 * O mock de `db-shim` expõe `transaction` (além de `execute`).
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

vi.mock('@/lib/agent/db-shim', () => {
  const dbStub = {
    execute: mocks.dbExecuteMock,
    transaction: async (fn: (tx: unknown) => Promise<unknown>) =>
      fn({ execute: mocks.dbExecuteMock }),
  };
  return { getDb: () => dbStub };
});

import { NextRequest } from 'next/server';

const { GET, DELETE } = await import('@/app/api/financas/prestacoes/[id]/route');

const USER_UUID = '00000000-0000-0000-0000-000000000001';
const HOUSEHOLD_UUID = '00000000-0000-0000-0000-000000000002';
const INSTALLMENT_UUID = '00000000-0000-0000-0000-00000000aaa1';
// UUID válido (hex) que NÃO existe no mock — usado para o cenário cross-household.
const MISSING_UUID = '00000000-0000-0000-0000-0000000000d9';

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

function ctx(id: string) {
  return { params: Promise.resolve({ id }) };
}

function req(method: string) {
  return new NextRequest(
    new Request(`http://localhost/api/financas/prestacoes/${INSTALLMENT_UUID}`, { method }),
  );
}

describe('GET /api/financas/prestacoes/[id]', () => {
  beforeEach(() => {
    mocks.getUserMock.mockReset();
    mocks.fromMock.mockReset();
    mocks.dbExecuteMock.mockReset();
  });

  it('401 AUTH_REQUIRED se sem auth', async () => {
    mocks.getUserMock.mockResolvedValue({ data: { user: null }, error: null });
    const res = await GET(req('GET'), ctx(INSTALLMENT_UUID));
    expect(res.status).toBe(401);
  });

  it('400 VALIDATION_ERROR se ID não é UUID', async () => {
    authed();
    const res = await GET(req('GET'), ctx('nao-uuid'));
    expect(res.status).toBe(400);
  });

  it('200 devolve prestação', async () => {
    authed();
    mocks.dbExecuteMock.mockResolvedValue([
      { id: INSTALLMENT_UUID, description: 'Portátil' },
    ]);
    const res = await GET(req('GET'), ctx(INSTALLMENT_UUID));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.installment.id).toBe(INSTALLMENT_UUID);
  });

  it('404 NOT_FOUND se cross-household (RLS-scoped SELECT vazio)', async () => {
    authed();
    mocks.dbExecuteMock.mockResolvedValue([]);
    const res = await GET(req('GET'), ctx(MISSING_UUID));
    expect(res.status).toBe(404);
  });
});

describe('DELETE /api/financas/prestacoes/[id]', () => {
  beforeEach(() => {
    mocks.getUserMock.mockReset();
    mocks.fromMock.mockReset();
    mocks.dbExecuteMock.mockReset();
  });

  it('404 NOT_FOUND se prestação cross-household (SELECT prévio vazio)', async () => {
    authed();
    mocks.dbExecuteMock.mockResolvedValueOnce([]); // SELECT prévio vazio
    const res = await DELETE(req('DELETE'), ctx(MISSING_UUID));
    expect(res.status).toBe(404);
  });

  it('200 hard delete cascata — transactions + installment', async () => {
    authed();
    mocks.dbExecuteMock
      .mockResolvedValueOnce([{ id: INSTALLMENT_UUID }]) // SELECT prévio
      .mockResolvedValueOnce([{ id: 't1' }, { id: 't2' }, { id: 't3' }]) // DELETE transactions returning
      .mockResolvedValueOnce([]) // DELETE installment
      .mockResolvedValueOnce([]); // audit
    const res = await DELETE(req('DELETE'), ctx(INSTALLMENT_UUID));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.deleted).toBe(true);
    expect(body.id).toBe(INSTALLMENT_UUID);
    expect(body.transactions_deleted).toBe(3);
  });

  it('400 VALIDATION_ERROR se ID não é UUID', async () => {
    authed();
    const res = await DELETE(req('DELETE'), ctx('xyz'));
    expect(res.status).toBe(400);
  });
});
