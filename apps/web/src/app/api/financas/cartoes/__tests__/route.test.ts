// @vitest-environment node
/**
 * Testes mockable-friendly — GET / POST /api/financas/cartoes (Story 4.2 AC2 + AC6 + AC10).
 *
 * Cobre: auth (401), GET list, validação composta credit (refine → 400),
 * `account_id` cross-household (404), `account_id` de conta arquivada (404,
 * PO_FIX F1), happy paths credit + debit, range closing_day (400).
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

const { GET, POST } = await import('@/app/api/financas/cartoes/route');

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
      }),
    }),
  };
}

function authed() {
  mocks.getUserMock.mockResolvedValue({ data: { user: { id: USER_UUID } }, error: null });
  mocks.fromMock.mockReturnValue(memberChain('household_id', HOUSEHOLD_UUID));
}

function getReq(qs = '') {
  return new NextRequest(new Request(`http://localhost/api/financas/cartoes${qs}`));
}

function postReq(body: unknown) {
  return new NextRequest(
    new Request('http://localhost/api/financas/cartoes', {
      method: 'POST',
      body: JSON.stringify(body),
      headers: { 'content-type': 'application/json' },
    }),
  );
}

describe('GET /api/financas/cartoes', () => {
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

  it('200 lista cartões activos', async () => {
    authed();
    mocks.dbExecuteMock.mockResolvedValue([{ id: 'c1', name: 'Visa' }]);
    const res = await GET(getReq());
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.cards).toHaveLength(1);
  });

  it('400 VALIDATION_ERROR se filtro card_type inválido', async () => {
    authed();
    const res = await GET(getReq('?card_type=prepaid'));
    expect(res.status).toBe(400);
  });
});

describe('POST /api/financas/cartoes', () => {
  beforeEach(() => {
    mocks.getUserMock.mockReset();
    mocks.fromMock.mockReset();
    mocks.dbExecuteMock.mockReset();
  });

  it('400 VALIDATION_ERROR — cartão de crédito sem credit_limit_cents (AC6 refine)', async () => {
    authed();
    const res = await POST(
      postReq({ account_id: ACCOUNT_UUID, name: 'Visa', card_type: 'credit' }),
    );
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error.code).toBe('VALIDATION_ERROR');
  });

  it('400 VALIDATION_ERROR — closing_day fora do intervalo 1-28', async () => {
    authed();
    const res = await POST(
      postReq({
        account_id: ACCOUNT_UUID,
        name: 'Visa',
        card_type: 'debit',
        closing_day: 31,
      }),
    );
    expect(res.status).toBe(400);
  });

  it('404 NOT_FOUND — account_id cross-household (RLS-scoped SELECT vazio)', async () => {
    authed();
    mocks.dbExecuteMock.mockResolvedValueOnce([]); // verificação account → 0 rows
    const res = await POST(
      postReq({
        account_id: ACCOUNT_UUID,
        name: 'Visa',
        card_type: 'credit',
        credit_limit_cents: 100000,
      }),
    );
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.error.message).toMatch(/Conta não encontrada/i);
  });

  it('404 NOT_FOUND — account_id de conta arquivada (PO_FIX F1)', async () => {
    authed();
    // SELECT com filtro `archived_at IS NULL` não encontra a conta arquivada.
    mocks.dbExecuteMock.mockResolvedValueOnce([]);
    const res = await POST(
      postReq({
        account_id: ACCOUNT_UUID,
        name: 'Visa',
        card_type: 'debit',
      }),
    );
    expect(res.status).toBe(404);
  });

  it('201 cria cartão de crédito com limite', async () => {
    authed();
    mocks.dbExecuteMock
      .mockResolvedValueOnce([{ id: ACCOUNT_UUID }]) // verificação account OK
      .mockResolvedValueOnce([
        { id: 'new-card', name: 'Visa', card_type: 'credit', account_id: ACCOUNT_UUID },
      ])
      .mockResolvedValueOnce([]); // audit_log
    const res = await POST(
      postReq({
        account_id: ACCOUNT_UUID,
        name: 'Visa',
        card_type: 'credit',
        credit_limit_cents: 250000,
      }),
    );
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.card.card_type).toBe('credit');
  });

  it('201 cria cartão de débito sem limite (refine não exige)', async () => {
    authed();
    mocks.dbExecuteMock
      .mockResolvedValueOnce([{ id: ACCOUNT_UUID }])
      .mockResolvedValueOnce([{ id: 'new-debit', name: 'Multibanco', card_type: 'debit' }])
      .mockResolvedValueOnce([]);
    const res = await POST(
      postReq({ account_id: ACCOUNT_UUID, name: 'Multibanco', card_type: 'debit' }),
    );
    expect(res.status).toBe(201);
  });
});
