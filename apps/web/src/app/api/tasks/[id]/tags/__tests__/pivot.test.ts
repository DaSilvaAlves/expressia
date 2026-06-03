// @vitest-environment node
/**
 * Testes mockable-friendly — POST/DELETE /api/tasks/[id]/tags (Story 3.2 AC4).
 *
 * Cobre: attach idempotente, cross-household 404, detach 204.
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

const attachRoute = await import('@/app/api/tasks/[id]/tags/route');
const detachRoute = await import('@/app/api/tasks/[id]/tags/[tagId]/route');

const USER_UUID = '00000000-0000-0000-0000-000000000001';
const HOUSEHOLD_UUID = '00000000-0000-0000-0000-000000000002';
const TASK_UUID = '00000000-0000-0000-0000-000000000abc';
const TAG_UUID = '00000000-0000-0000-0000-000000000def';

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

describe('POST /api/tasks/[id]/tags — attach pivot', () => {
  beforeEach(() => {
    mocks.getUserMock.mockReset();
    mocks.fromMock.mockReset();
    mocks.dbExecuteMock.mockReset();
  });

  function req(body: unknown) {
    return new NextRequest(
      new Request('http://localhost/api/tasks/x/tags', {
        method: 'POST',
        body: JSON.stringify(body),
        headers: { 'content-type': 'application/json' },
      }),
    );
  }
  const ctx = { params: Promise.resolve({ id: TASK_UUID }) };

  it('400 se tag_id ausente', async () => {
    authed();
    const res = await attachRoute.POST(req({}), ctx);
    expect(res.status).toBe(400);
  });

  it('404 NOT_FOUND se task ou tag cross-household (RLS filtra ambos)', async () => {
    authed();
    // check query: task_id null OR tag_id null
    mocks.dbExecuteMock.mockResolvedValueOnce([{ task_id: null, tag_id: TAG_UUID }]);
    const res = await attachRoute.POST(req({ tag_id: TAG_UUID }), ctx);
    expect(res.status).toBe(404);
  });

  it('201 attach idempotente (ON CONFLICT DO NOTHING)', async () => {
    authed();
    mocks.dbExecuteMock
      .mockResolvedValueOnce([{ task_id: TASK_UUID, tag_id: TAG_UUID }]) // check both exist
      .mockResolvedValueOnce([]) // INSERT
      .mockResolvedValueOnce([]); // audit_log
    const res = await attachRoute.POST(req({ tag_id: TAG_UUID }), ctx);
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.attached).toBe(true);
  });
});

describe('DELETE /api/tasks/[id]/tags/[tagId] — detach pivot', () => {
  beforeEach(() => {
    mocks.getUserMock.mockReset();
    mocks.fromMock.mockReset();
    mocks.dbExecuteMock.mockReset();
  });

  const ctx = { params: Promise.resolve({ id: TASK_UUID, tagId: TAG_UUID }) };

  it('204 NO_CONTENT se detach successful', async () => {
    authed();
    mocks.dbExecuteMock.mockResolvedValueOnce([{ task_id: TASK_UUID }]).mockResolvedValueOnce([]);
    const res = await detachRoute.DELETE(
      new NextRequest(new Request('http://localhost/api/tasks/x/tags/y', { method: 'DELETE' })),
      ctx,
    );
    expect(res.status).toBe(204);
  });

  it('404 se associação não existe', async () => {
    authed();
    mocks.dbExecuteMock.mockResolvedValue([]);
    const res = await detachRoute.DELETE(
      new NextRequest(new Request('http://localhost/api/tasks/x/tags/y', { method: 'DELETE' })),
      ctx,
    );
    expect(res.status).toBe(404);
  });
});
