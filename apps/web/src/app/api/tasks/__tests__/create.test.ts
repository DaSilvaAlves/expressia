// @vitest-environment node
/**
 * Testes mockable-friendly — POST /api/tasks (Story 3.2 AC1 + AC7 + AC8 + AC10).
 *
 * Cobre: auth (401), Zod strict (400 com household_id rejected), happy path (201),
 * audit_log INSERT best-effort, 500 fallback.
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
  // SEC-5: handler envolve a operação de domínio em `withHousehold`.
  withHousehold: (
    _auth: { userId: string; householdId: string },
    fn: (tx: { execute: typeof mocks.dbExecuteMock }) => unknown,
  ) => fn({ execute: mocks.dbExecuteMock }),
}));

import { NextRequest } from 'next/server';

const { POST } = await import('@/app/api/tasks/route');

function makeReq(body: unknown) {
  return new NextRequest(
    new Request('http://localhost/api/tasks', {
      method: 'POST',
      body: JSON.stringify(body),
      headers: { 'content-type': 'application/json' },
    }),
  );
}

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

const USER_UUID = '00000000-0000-0000-0000-000000000001';
const HOUSEHOLD_UUID = '00000000-0000-0000-0000-000000000002';

describe('POST /api/tasks', () => {
  beforeEach(() => {
    mocks.getUserMock.mockReset();
    mocks.fromMock.mockReset();
    mocks.dbExecuteMock.mockReset();
  });

  it('401 AUTH_REQUIRED se sem auth', async () => {
    mocks.getUserMock.mockResolvedValue({ data: { user: null }, error: null });
    const res = await POST(makeReq({ title: 'X' }));
    expect(res.status).toBe(401);
  });

  it('400 VALIDATION_ERROR se body sem title', async () => {
    mocks.getUserMock.mockResolvedValue({ data: { user: { id: USER_UUID } }, error: null });
    mocks.fromMock.mockReturnValue(householdChain(HOUSEHOLD_UUID));
    const res = await POST(makeReq({}));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error.code).toBe('VALIDATION_ERROR');
  });

  it('400 VALIDATION_ERROR se body inclui household_id (Zod strict — AC8 defense-in-depth)', async () => {
    mocks.getUserMock.mockResolvedValue({ data: { user: { id: USER_UUID } }, error: null });
    mocks.fromMock.mockReturnValue(householdChain(HOUSEHOLD_UUID));
    const res = await POST(
      makeReq({
        title: 'Tarefa maliciosa',
        household_id: '99999999-9999-9999-9999-999999999999',
      }),
    );
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error.code).toBe('VALIDATION_ERROR');
  });

  it('400 VALIDATION_ERROR se body inclui created_by_user_id (Zod strict)', async () => {
    mocks.getUserMock.mockResolvedValue({ data: { user: { id: USER_UUID } }, error: null });
    mocks.fromMock.mockReturnValue(householdChain(HOUSEHOLD_UUID));
    const res = await POST(makeReq({ title: 'X', created_by_user_id: 'spoofed' }));
    expect(res.status).toBe(400);
  });

  it('400 VALIDATION_ERROR se title vazio (min 1)', async () => {
    mocks.getUserMock.mockResolvedValue({ data: { user: { id: USER_UUID } }, error: null });
    mocks.fromMock.mockReturnValue(householdChain(HOUSEHOLD_UUID));
    const res = await POST(makeReq({ title: '' }));
    expect(res.status).toBe(400);
  });

  it('201 criada — task com defaults + audit_log best-effort', async () => {
    mocks.getUserMock.mockResolvedValue({ data: { user: { id: USER_UUID } }, error: null });
    mocks.fromMock.mockReturnValue(householdChain(HOUSEHOLD_UUID));
    // First execute = INSERT task; second = audit_log
    mocks.dbExecuteMock
      .mockResolvedValueOnce([
        {
          id: 'new-task-uuid',
          household_id: HOUSEHOLD_UUID,
          title: 'Comprar leite',
          status: 'todo',
          priority: 'medium',
        },
      ])
      .mockResolvedValueOnce([]);
    const res = await POST(makeReq({ title: 'Comprar leite' }));
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.task.title).toBe('Comprar leite');
    expect(body.task.status).toBe('todo');
  });

  it('201 mesmo se audit_log INSERT falhar (best-effort)', async () => {
    mocks.getUserMock.mockResolvedValue({ data: { user: { id: USER_UUID } }, error: null });
    mocks.fromMock.mockReturnValue(householdChain(HOUSEHOLD_UUID));
    mocks.dbExecuteMock
      .mockResolvedValueOnce([{ id: 't1', title: 'X', status: 'todo' }])
      .mockRejectedValueOnce(new Error('audit_log table locked'));
    const res = await POST(makeReq({ title: 'X' }));
    expect(res.status).toBe(201);
  });

  it('500 INTERNAL_ERROR se INSERT principal falhar', async () => {
    mocks.getUserMock.mockResolvedValue({ data: { user: { id: USER_UUID } }, error: null });
    mocks.fromMock.mockReturnValue(householdChain(HOUSEHOLD_UUID));
    mocks.dbExecuteMock.mockRejectedValueOnce(new Error('connection lost'));
    const res = await POST(makeReq({ title: 'X' }));
    expect(res.status).toBe(500);
  });
});
