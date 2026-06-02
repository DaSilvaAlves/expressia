// @vitest-environment node
/**
 * Testes mockable-friendly — GET / PATCH / DELETE /api/financas/recorrencias/[id]
 * (Story 4.4 AC1 + AC10).
 *
 * Cobre: GET single + 404 RLS, PATCH parcial + immutable field rejeitado +
 * 404 RLS, DELETE soft (`active=false`) + 404 RLS, ID inválido (400).
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
  // SEC-3: a operação principal passou a correr dentro de `withHousehold`. O mock
  // injecta um `tx` equivalente (`execute` é o único exercido pelas queries).
  withHousehold: (
    _auth: { userId: string; householdId: string },
    fn: (tx: { execute: typeof mocks.dbExecuteMock }) => unknown,
  ) => fn({ execute: mocks.dbExecuteMock }),
}));

import { NextRequest } from 'next/server';

const { GET, PATCH, DELETE } = await import(
  '@/app/api/financas/recorrencias/[id]/route'
);

const USER_UUID = '00000000-0000-0000-0000-000000000001';
const HOUSEHOLD_UUID = '00000000-0000-0000-0000-000000000002';
// UUID válido (hex) que NÃO existe no mock — usado para o cenário cross-household.
const MISSING_REC = '00000000-0000-0000-0000-0000000000d9';
const VALID_REC = '00000000-0000-0000-0000-00000000aaa1';

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

function req(method: string, body?: unknown) {
  return new NextRequest(
    new Request(`http://localhost/api/financas/recorrencias/${VALID_REC}`, {
      method,
      ...(body !== undefined && {
        body: JSON.stringify(body),
        headers: { 'content-type': 'application/json' },
      }),
    }),
  );
}

describe('GET /api/financas/recorrencias/[id]', () => {
  beforeEach(() => {
    mocks.getUserMock.mockReset();
    mocks.fromMock.mockReset();
    mocks.dbExecuteMock.mockReset();
  });

  it('401 AUTH_REQUIRED se sem auth', async () => {
    mocks.getUserMock.mockResolvedValue({ data: { user: null }, error: null });
    const res = await GET(req('GET'), ctx(VALID_REC));
    expect(res.status).toBe(401);
  });

  it('400 VALIDATION_ERROR se ID não é UUID', async () => {
    authed();
    const res = await GET(req('GET'), ctx('nao-e-uuid'));
    expect(res.status).toBe(400);
  });

  it('200 devolve recorrência', async () => {
    authed();
    mocks.dbExecuteMock.mockResolvedValue([{ id: VALID_REC, description: 'Renda' }]);
    const res = await GET(req('GET'), ctx(VALID_REC));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.recurrence.id).toBe(VALID_REC);
  });

  it('404 NOT_FOUND se cross-household (RLS-scoped SELECT vazio)', async () => {
    authed();
    mocks.dbExecuteMock.mockResolvedValue([]);
    const res = await GET(req('GET'), ctx(MISSING_REC));
    expect(res.status).toBe(404);
  });
});

describe('PATCH /api/financas/recorrencias/[id]', () => {
  beforeEach(() => {
    mocks.getUserMock.mockReset();
    mocks.fromMock.mockReset();
    mocks.dbExecuteMock.mockReset();
  });

  it('400 VALIDATION_ERROR se body inclui campo immutable next_run_on (Zod strict)', async () => {
    authed();
    const res = await PATCH(req('PATCH', { next_run_on: '2026-07-01' }), ctx(VALID_REC));
    expect(res.status).toBe(400);
  });

  it('404 NOT_FOUND se recorrência cross-household', async () => {
    authed();
    mocks.dbExecuteMock.mockResolvedValueOnce([]); // SELECT prévio vazio
    const res = await PATCH(req('PATCH', { amount_cents: 9000 }), ctx(VALID_REC));
    expect(res.status).toBe(404);
  });

  it('200 actualiza recorrência (active editável)', async () => {
    authed();
    mocks.dbExecuteMock
      .mockResolvedValueOnce([{ id: VALID_REC }]) // SELECT prévio
      .mockResolvedValueOnce([{ id: VALID_REC, active: false, amount_cents: 9000 }]) // UPDATE
      .mockResolvedValueOnce([]); // audit
    const res = await PATCH(req('PATCH', { active: false, amount_cents: 9000 }), ctx(VALID_REC));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.recurrence.active).toBe(false);
  });

  it('400 VALIDATION_ERROR se nenhum campo fornecido', async () => {
    authed();
    mocks.dbExecuteMock.mockResolvedValueOnce([{ id: VALID_REC }]); // SELECT prévio
    const res = await PATCH(req('PATCH', {}), ctx(VALID_REC));
    expect(res.status).toBe(400);
  });
});

describe('DELETE /api/financas/recorrencias/[id]', () => {
  beforeEach(() => {
    mocks.getUserMock.mockReset();
    mocks.fromMock.mockReset();
    mocks.dbExecuteMock.mockReset();
  });

  it('200 soft delete devolve deactivated:true', async () => {
    authed();
    mocks.dbExecuteMock
      .mockResolvedValueOnce([{ id: VALID_REC }]) // UPDATE active=false returning id
      .mockResolvedValueOnce([]); // audit
    const res = await DELETE(req('DELETE'), ctx(VALID_REC));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.deactivated).toBe(true);
    expect(body.id).toBe(VALID_REC);
  });

  it('404 NOT_FOUND se recorrência cross-household (UPDATE returning vazio)', async () => {
    authed();
    mocks.dbExecuteMock.mockResolvedValueOnce([]); // UPDATE returning vazio
    const res = await DELETE(req('DELETE'), ctx(MISSING_REC));
    expect(res.status).toBe(404);
  });

  it('400 VALIDATION_ERROR se ID não é UUID', async () => {
    authed();
    const res = await DELETE(req('DELETE'), ctx('xyz'));
    expect(res.status).toBe(400);
  });
});
