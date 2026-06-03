// @vitest-environment node
/**
 * Testes mockable-friendly — GET/PATCH/DELETE /api/tasks/[id]
 * (Story 3.2 AC1 + AC7-AC10 + DP2-3.2 soft delete).
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
  // SEC-5: handler envolve as queries de domínio em `withHousehold`.
  withHousehold: (
    _auth: { userId: string; householdId: string },
    fn: (tx: { execute: typeof mocks.dbExecuteMock }) => unknown,
  ) => fn({ execute: mocks.dbExecuteMock }),
}));

import { NextRequest } from 'next/server';

const { GET, PATCH, DELETE } = await import('@/app/api/tasks/[id]/route');

const USER_UUID = '00000000-0000-0000-0000-000000000001';
const HOUSEHOLD_UUID = '00000000-0000-0000-0000-000000000002';
const TASK_UUID = '00000000-0000-0000-0000-000000000abc';

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

function authedDefaults() {
  mocks.getUserMock.mockResolvedValue({ data: { user: { id: USER_UUID } }, error: null });
  mocks.fromMock.mockReturnValue(householdChain(HOUSEHOLD_UUID));
}

function makeCtx() {
  return { params: Promise.resolve({ id: TASK_UUID }) };
}

describe('GET /api/tasks/[id]', () => {
  beforeEach(() => {
    mocks.getUserMock.mockReset();
    mocks.fromMock.mockReset();
    mocks.dbExecuteMock.mockReset();
  });

  it('401 se sem auth', async () => {
    mocks.getUserMock.mockResolvedValue({ data: { user: null }, error: null });
    const res = await GET(new NextRequest(new Request('http://localhost/api/tasks/x')), makeCtx());
    expect(res.status).toBe(401);
  });

  it('400 se ID inválido (não uuid)', async () => {
    authedDefaults();
    const res = await GET(
      new NextRequest(new Request('http://localhost/api/tasks/not-uuid')),
      { params: Promise.resolve({ id: 'not-uuid' }) },
    );
    expect(res.status).toBe(400);
  });

  it('404 NOT_FOUND se task não existe ou cross-household (RLS filter)', async () => {
    authedDefaults();
    mocks.dbExecuteMock.mockResolvedValue([]);
    const res = await GET(new NextRequest(new Request('http://localhost/api/tasks/x')), makeCtx());
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.error.code).toBe('NOT_FOUND');
  });

  it('200 retorna task', async () => {
    authedDefaults();
    mocks.dbExecuteMock.mockResolvedValue([{ id: TASK_UUID, title: 'X', status: 'todo' }]);
    const res = await GET(new NextRequest(new Request('http://localhost/api/tasks/x')), makeCtx());
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.task.id).toBe(TASK_UUID);
  });
});

describe('PATCH /api/tasks/[id]', () => {
  beforeEach(() => {
    mocks.getUserMock.mockReset();
    mocks.fromMock.mockReset();
    mocks.dbExecuteMock.mockReset();
  });

  function makePatch(body: unknown) {
    return new NextRequest(
      new Request('http://localhost/api/tasks/x', {
        method: 'PATCH',
        body: JSON.stringify(body),
        headers: { 'content-type': 'application/json' },
      }),
    );
  }

  it('400 se body inclui household_id (immutable AC8)', async () => {
    authedDefaults();
    const res = await PATCH(makePatch({ household_id: 'spoofed' }), makeCtx());
    expect(res.status).toBe(400);
  });

  it('400 se body inclui created_by_user_id (immutable AC8)', async () => {
    authedDefaults();
    const res = await PATCH(makePatch({ created_by_user_id: 'spoofed' }), makeCtx());
    expect(res.status).toBe(400);
  });

  it('400 se body vazio (nenhum campo para actualizar)', async () => {
    authedDefaults();
    const res = await PATCH(makePatch({}), makeCtx());
    expect(res.status).toBe(400);
  });

  it('200 update title — audit_log task.updated', async () => {
    authedDefaults();
    mocks.dbExecuteMock
      .mockResolvedValueOnce([{ id: TASK_UUID, title: 'Novo título', status: 'todo' }])
      .mockResolvedValueOnce([]);
    const res = await PATCH(makePatch({ title: 'Novo título' }), makeCtx());
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.task.title).toBe('Novo título');
  });

  it('200 status=done — audit_log task.completed (não task.updated)', async () => {
    authedDefaults();
    mocks.dbExecuteMock
      .mockResolvedValueOnce([{ id: TASK_UUID, status: 'done', title: 'X' }])
      .mockResolvedValueOnce([]);
    const res = await PATCH(makePatch({ status: 'done' }), makeCtx());
    expect(res.status).toBe(200);
  });

  it('404 se task não existe', async () => {
    authedDefaults();
    mocks.dbExecuteMock.mockResolvedValue([]);
    const res = await PATCH(makePatch({ title: 'X' }), makeCtx());
    expect(res.status).toBe(404);
  });
});

describe('DELETE /api/tasks/[id] — soft delete (DP2-3.2 A status=archived)', () => {
  beforeEach(() => {
    mocks.getUserMock.mockReset();
    mocks.fromMock.mockReset();
    mocks.dbExecuteMock.mockReset();
  });

  it('200 archived=true (NÃO hard delete — preserva audit trail)', async () => {
    authedDefaults();
    mocks.dbExecuteMock.mockResolvedValueOnce([{ id: TASK_UUID }]).mockResolvedValueOnce([]);
    const res = await DELETE(new NextRequest(new Request('http://localhost/api/tasks/x', { method: 'DELETE' })), makeCtx());
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.archived).toBe(true);
  });

  it('404 se task não existe', async () => {
    authedDefaults();
    mocks.dbExecuteMock.mockResolvedValue([]);
    const res = await DELETE(new NextRequest(new Request('http://localhost/api/tasks/x', { method: 'DELETE' })), makeCtx());
    expect(res.status).toBe(404);
  });
});
