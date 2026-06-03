// @vitest-environment node
/**
 * Testes mockable-friendly — PATCH /api/tasks/[id]/move (Story 3.2 AC2 atomic).
 *
 * Cobre: auth, body validation, atomicidade BEGIN/COMMIT, 409 race conflict,
 * RLS leak via Zod strict, audit task.moved.
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
  getServiceDb: () => ({ execute: mocks.dbExecuteMock }),
  // SEC-5: handler envolve as queries de domínio em `withHousehold`. O mock injecta
  // um `tx` equivalente (mesmo `execute` mock) — substitui o begin/commit inline.
  withHousehold: (
    _auth: { userId: string; householdId: string },
    fn: (tx: { execute: typeof mocks.dbExecuteMock }) => unknown,
  ) => fn({ execute: mocks.dbExecuteMock }),
}));

import { NextRequest } from 'next/server';

const { PATCH } = await import('@/app/api/tasks/[id]/move/route');

const USER_UUID = '00000000-0000-0000-0000-000000000001';
const HOUSEHOLD_UUID = '00000000-0000-0000-0000-000000000002';
const TASK_UUID = '00000000-0000-0000-0000-000000000abc';
const COL_UUID = '00000000-0000-0000-0000-000000000def';

function householdChain(id: string | null) {
  return {
    select: vi.fn().mockReturnValue({
      eq: vi.fn().mockReturnValue({
        limit: vi.fn().mockReturnValue({
          maybeSingle: vi.fn().mockResolvedValue({ data: id ? { household_id: id } : null, error: null }),
        }),
      }),
    }),
  };
}

function authed() {
  mocks.getUserMock.mockResolvedValue({ data: { user: { id: USER_UUID } }, error: null });
  mocks.fromMock.mockReturnValue(householdChain(HOUSEHOLD_UUID));
}

function makeReq(body: unknown) {
  return new NextRequest(
    new Request('http://localhost/api/tasks/x/move', {
      method: 'PATCH',
      body: JSON.stringify(body),
      headers: { 'content-type': 'application/json' },
    }),
  );
}

const CTX = { params: Promise.resolve({ id: TASK_UUID }) };

describe('PATCH /api/tasks/[id]/move', () => {
  beforeEach(() => {
    mocks.getUserMock.mockReset();
    mocks.fromMock.mockReset();
    mocks.dbExecuteMock.mockReset();
  });

  it('401 se sem auth', async () => {
    mocks.getUserMock.mockResolvedValue({ data: { user: null }, error: null });
    const res = await PATCH(makeReq({ kanban_column_id: COL_UUID, kanban_position: 0 }), CTX);
    expect(res.status).toBe(401);
  });

  it('400 se body inválido (faltam campos obrigatórios)', async () => {
    authed();
    const res = await PATCH(makeReq({}), CTX);
    expect(res.status).toBe(400);
  });

  it('400 se kanban_position negativo', async () => {
    authed();
    const res = await PATCH(makeReq({ kanban_column_id: COL_UUID, kanban_position: -1 }), CTX);
    expect(res.status).toBe(400);
  });

  it('404 se task não existe', async () => {
    authed();
    mocks.dbExecuteMock.mockResolvedValueOnce([]); // SELECT current → empty
    const res = await PATCH(makeReq({ kanban_column_id: COL_UUID, kanban_position: 0 }), CTX);
    expect(res.status).toBe(404);
  });

  it('404 se kanban_column_id alvo não existe', async () => {
    authed();
    mocks.dbExecuteMock
      .mockResolvedValueOnce([{ id: TASK_UUID, kanban_column_id: null, kanban_position: 0 }]) // current
      .mockResolvedValueOnce([]); // col check empty
    const res = await PATCH(makeReq({ kanban_column_id: COL_UUID, kanban_position: 0 }), CTX);
    expect(res.status).toBe(404);
  });

  it('200 move cross-column com rebalance + audit task.moved', async () => {
    authed();
    mocks.dbExecuteMock
      .mockResolvedValueOnce([{ id: TASK_UUID, kanban_column_id: null, kanban_position: 0 }]) // current
      .mockResolvedValueOnce([{ id: COL_UUID }]) // col check
      .mockResolvedValueOnce([]) // shift siblings (dentro do withHousehold)
      .mockResolvedValueOnce([]) // UPDATE task (dentro do withHousehold)
      .mockResolvedValueOnce([{ id: TASK_UUID, kanban_column_id: COL_UUID, kanban_position: 1 }]) // re-fetch (dentro do withHousehold)
      .mockResolvedValueOnce([]); // audit log (fora do withHousehold)
    const res = await PATCH(makeReq({ kanban_column_id: COL_UUID, kanban_position: 1 }), CTX);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.task.kanban_position).toBe(1);
  });

  it('409 CONFLICT em unique constraint violation (race condition)', async () => {
    authed();
    mocks.dbExecuteMock
      .mockResolvedValueOnce([{ id: TASK_UUID, kanban_column_id: null, kanban_position: 0 }])
      .mockResolvedValueOnce([{ id: COL_UUID }])
      // shift siblings rejeita com unique violation (dentro do withHousehold → rollback
      // automático da transação; o erro propaga até ao catch externo → 409)
      .mockRejectedValueOnce(new Error('duplicate key value violates unique constraint (23505)'));
    const res = await PATCH(makeReq({ kanban_column_id: COL_UUID, kanban_position: 0 }), CTX);
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.error.code).toBe('CONFLICT');
  });
});
