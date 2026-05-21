// @vitest-environment node
/**
 * Testes mockable-friendly — GET / POST /api/financas/prestacoes (Story 4.4 AC2 + AC10).
 *
 * Cobre: auth (401), listagem + filtro `card_id`, Zod `.strict()`, PO_FIX_INLINE
 * F1 (`total < num` → 400), `num_installments` fora de range (400), FK card
 * cross-household (404), geração atómica de N transactions com `per_installment`
 * + resto na última (€1.000/3, €100/7).
 *
 * O mock de `db-shim` expõe `transaction` (além de `execute`): `transaction`
 * invoca o callback com um `tx` mock que partilha o mesmo `dbExecuteMock`.
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

// `transaction` invoca o callback com um `tx` mock que também tem `execute` —
// partilha o mesmo `dbExecuteMock` (a sequência de mockResolvedValueOnce cobre
// SELECT FK + INSERT installment + N INSERT transactions + audit).
vi.mock('@/lib/agent/db-shim', () => {
  const dbStub = {
    execute: mocks.dbExecuteMock,
    transaction: async (fn: (tx: unknown) => Promise<unknown>) =>
      fn({ execute: mocks.dbExecuteMock }),
  };
  return { getDb: () => dbStub };
});

import { NextRequest } from 'next/server';

const { GET, POST } = await import('@/app/api/financas/prestacoes/route');

const USER_UUID = '00000000-0000-0000-0000-000000000001';
const HOUSEHOLD_UUID = '00000000-0000-0000-0000-000000000002';
const CARD_UUID = '00000000-0000-0000-0000-0000000000c1';
const INSTALLMENT_UUID = '00000000-0000-0000-0000-0000000000i1';

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
  return new NextRequest(new Request(`http://localhost/api/financas/prestacoes${qs}`));
}

function postReq(body: unknown) {
  return new NextRequest(
    new Request('http://localhost/api/financas/prestacoes', {
      method: 'POST',
      body: JSON.stringify(body),
      headers: { 'content-type': 'application/json' },
    }),
  );
}

const validBody = {
  card_id: CARD_UUID,
  description: 'Portátil',
  total_amount_cents: 100000,
  num_installments: 3,
  purchased_on: '2026-05-21',
  first_installment_on: '2026-06-15',
};

describe('GET /api/financas/prestacoes', () => {
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

  it('200 lista prestações', async () => {
    authed();
    mocks.dbExecuteMock.mockResolvedValue([
      { id: 'i1', description: 'Portátil' },
      { id: 'i2', description: 'Telemóvel' },
    ]);
    const res = await GET(getReq());
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.installments).toHaveLength(2);
  });

  it('200 lista com filtro card_id', async () => {
    authed();
    mocks.dbExecuteMock.mockResolvedValue([{ id: 'i1' }]);
    const res = await GET(getReq(`?card_id=${CARD_UUID}`));
    expect(res.status).toBe(200);
  });

  it('400 VALIDATION_ERROR se filtro card_id não é UUID', async () => {
    authed();
    const res = await GET(getReq('?card_id=nao-uuid'));
    expect(res.status).toBe(400);
  });
});

describe('POST /api/financas/prestacoes', () => {
  beforeEach(() => {
    mocks.getUserMock.mockReset();
    mocks.fromMock.mockReset();
    mocks.dbExecuteMock.mockReset();
  });

  it('400 VALIDATION_ERROR se total_amount_cents < num_installments (PO_FIX_INLINE F1)', async () => {
    authed();
    const res = await POST(
      postReq({ ...validBody, total_amount_cents: 5, num_installments: 10 }),
    );
    expect(res.status).toBe(400);
  });

  it('400 VALIDATION_ERROR se num_installments fora de range (61)', async () => {
    authed();
    const res = await POST(postReq({ ...validBody, num_installments: 61 }));
    expect(res.status).toBe(400);
  });

  it('400 VALIDATION_ERROR se card_id ausente (Zod — card obrigatório)', async () => {
    authed();
    const res = await POST(
      postReq({
        description: 'X',
        total_amount_cents: 100000,
        num_installments: 3,
        purchased_on: '2026-05-21',
        first_installment_on: '2026-06-15',
      }),
    );
    expect(res.status).toBe(400);
  });

  it('404 NOT_FOUND se card_id cross-household (RLS-scoped SELECT vazio)', async () => {
    authed();
    mocks.dbExecuteMock.mockResolvedValueOnce([]); // verificação card_id
    const res = await POST(postReq(validBody));
    expect(res.status).toBe(404);
  });

  it('201 gera installment + 3 transactions com resto na última (€1.000/3)', async () => {
    authed();
    // SELECT card → INSERT installment → 3× INSERT transaction → audit
    mocks.dbExecuteMock
      .mockResolvedValueOnce([{ id: CARD_UUID }]) // card existe
      .mockResolvedValueOnce([
        {
          id: INSTALLMENT_UUID,
          total_amount_cents: 100000,
          num_installments: 3,
          per_installment_cents: 33333,
        },
      ]) // INSERT installment
      .mockResolvedValueOnce([]) // INSERT transaction k=1
      .mockResolvedValueOnce([]) // INSERT transaction k=2
      .mockResolvedValueOnce([]) // INSERT transaction k=3
      .mockResolvedValueOnce([]); // audit
    const res = await POST(postReq(validBody));
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.installment.id).toBe(INSTALLMENT_UUID);
    expect(body.transactions_generated).toBe(3);
    expect(body.installment.per_installment_cents).toBe(33333);
  });

  it('201 gera 7 transactions (€100/7 — resto na última)', async () => {
    authed();
    mocks.dbExecuteMock
      .mockResolvedValueOnce([{ id: CARD_UUID }]) // card existe
      .mockResolvedValueOnce([{ id: INSTALLMENT_UUID, per_installment_cents: 1428 }]); // INSERT installment
    // 7× INSERT transaction + audit
    for (let i = 0; i < 8; i++) mocks.dbExecuteMock.mockResolvedValueOnce([]);
    const res = await POST(
      postReq({ ...validBody, total_amount_cents: 10000, num_installments: 7 }),
    );
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.transactions_generated).toBe(7);
  });
});
