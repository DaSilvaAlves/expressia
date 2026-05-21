// @vitest-environment node
/**
 * Testes mockable-friendly — GET / PATCH / DELETE /api/financas/transacoes/[id]
 * (Story 4.3 AC1 + AC5 + AC10).
 *
 * Cobre: GET single (200/404/400 id inválido), PATCH (200, 409 transacção
 * gerada), DELETE hard (200, 409 transacção gerada, 404 not found).
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

const { GET, PATCH, DELETE } = await import('@/app/api/financas/transacoes/[id]/route');

const USER_UUID = '00000000-0000-0000-0000-000000000001';
const HOUSEHOLD_UUID = '00000000-0000-0000-0000-000000000002';
const TX_UUID = '00000000-0000-0000-0000-0000000000t1'.replace(/t/g, '7');
const REC_UUID = '00000000-0000-0000-0000-0000000000r1'.replace(/r/g, '9');

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

const ctx = { params: Promise.resolve({ id: TX_UUID }) };

function plainReq(method = 'GET') {
  return new NextRequest(new Request('http://localhost/x', { method }));
}

function patchReq(body: unknown) {
  return new NextRequest(
    new Request(`http://localhost/api/financas/transacoes/${TX_UUID}`, {
      method: 'PATCH',
      body: JSON.stringify(body),
      headers: { 'content-type': 'application/json' },
    }),
  );
}

describe('GET /api/financas/transacoes/[id]', () => {
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

  it('200 devolve transacção', async () => {
    authed();
    mocks.dbExecuteMock.mockResolvedValue([{ id: TX_UUID, description: 'Supermercado' }]);
    const res = await GET(plainReq(), ctx);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.transaction.id).toBe(TX_UUID);
  });

  it('404 NOT_FOUND se não existe ou cross-household (RLS)', async () => {
    authed();
    mocks.dbExecuteMock.mockResolvedValue([]);
    const res = await GET(plainReq(), ctx);
    expect(res.status).toBe(404);
  });
});

describe('PATCH /api/financas/transacoes/[id]', () => {
  beforeEach(() => {
    mocks.getUserMock.mockReset();
    mocks.fromMock.mockReset();
    mocks.dbExecuteMock.mockReset();
  });

  it('200 actualiza transacção variável', async () => {
    authed();
    mocks.dbExecuteMock
      .mockResolvedValueOnce([{ id: TX_UUID, recurrence_id: null, installment_id: null }]) // SELECT prévio
      .mockResolvedValueOnce([{ id: TX_UUID, kind: 'expense', amount_cents: 5000 }]) // UPDATE
      .mockResolvedValueOnce([]); // audit
    const res = await PATCH(patchReq({ description: 'Renomeada' }), ctx);
    expect(res.status).toBe(200);
  });

  it('409 CONFLICT se a transacção foi gerada por recorrência (scope variable-only)', async () => {
    authed();
    mocks.dbExecuteMock.mockResolvedValueOnce([
      { id: TX_UUID, recurrence_id: REC_UUID, installment_id: null },
    ]);
    const res = await PATCH(patchReq({ description: 'X' }), ctx);
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.error.code).toBe('CONFLICT');
  });
});

describe('DELETE /api/financas/transacoes/[id]', () => {
  beforeEach(() => {
    mocks.getUserMock.mockReset();
    mocks.fromMock.mockReset();
    mocks.dbExecuteMock.mockReset();
  });

  it('200 deleted=true (hard delete) se transacção variável', async () => {
    authed();
    mocks.dbExecuteMock
      .mockResolvedValueOnce([{ id: TX_UUID, recurrence_id: null, installment_id: null }]) // SELECT prévio
      .mockResolvedValueOnce([]) // DELETE
      .mockResolvedValueOnce([]); // audit
    const res = await DELETE(plainReq('DELETE'), ctx);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.deleted).toBe(true);
  });

  it('409 CONFLICT se a transacção foi gerada por prestação (scope variable-only)', async () => {
    authed();
    mocks.dbExecuteMock.mockResolvedValueOnce([
      { id: TX_UUID, recurrence_id: null, installment_id: REC_UUID },
    ]);
    const res = await DELETE(plainReq('DELETE'), ctx);
    expect(res.status).toBe(409);
  });

  it('404 NOT_FOUND se a transacção não existe', async () => {
    authed();
    mocks.dbExecuteMock.mockResolvedValueOnce([]);
    const res = await DELETE(plainReq('DELETE'), ctx);
    expect(res.status).toBe(404);
  });
});
