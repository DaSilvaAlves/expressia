// @vitest-environment node
/**
 * Testes — `GET /api/tags?with_counts=true` (Story 3.6 AC6 + T3.3).
 *
 * Cobre: G2.1 boolean parse estrito (apenas literal 'true' aceite) +
 * default sem param vs com param + 401 sem auth.
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
  // SEC-5: o GET envolve o SELECT em `withHousehold`.
  withHousehold: (
    _auth: { userId: string; householdId: string },
    fn: (tx: { execute: typeof mocks.dbExecuteMock }) => unknown,
  ) => fn({ execute: mocks.dbExecuteMock }),
}));

import { NextRequest } from 'next/server';

const { GET } = await import('@/app/api/tags/route');

const USER_UUID = '00000000-0000-0000-0000-000000000001';
const HOUSEHOLD_UUID = '00000000-0000-0000-0000-000000000002';

function authedAsOwner() {
  mocks.getUserMock.mockResolvedValue({ data: { user: { id: USER_UUID } }, error: null });
  mocks.fromMock.mockReturnValue({
    select: vi.fn().mockReturnValue({
      eq: vi.fn().mockReturnValue({
        limit: vi.fn().mockReturnValue({
          maybeSingle: vi.fn().mockResolvedValue({
            data: { household_id: HOUSEHOLD_UUID },
            error: null,
          }),
        }),
      }),
    }),
  });
}

function req(qs: string = '') {
  return new NextRequest(new Request(`http://localhost/api/tags${qs}`));
}

describe('GET /api/tags ?with_counts=true', () => {
  beforeEach(() => {
    mocks.getUserMock.mockReset();
    mocks.fromMock.mockReset();
    mocks.dbExecuteMock.mockReset();
  });

  it('sem param retorna tags sem task_count (backward compat)', async () => {
    authedAsOwner();
    mocks.dbExecuteMock.mockResolvedValue([
      { id: 't1', name: 'casa', color: '#FF0000' },
    ]);
    const res = await GET(req());
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.tags[0]).not.toHaveProperty('task_count');
  });

  it('?with_counts=true retorna task_count', async () => {
    authedAsOwner();
    mocks.dbExecuteMock.mockResolvedValue([
      { id: 't1', name: 'casa', color: '#FF0000', task_count: 3 },
    ]);
    const res = await GET(req('?with_counts=true'));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.tags[0].task_count).toBe(3);
  });

  it('?with_counts=false NÃO activa counts (G2.1 parse estrito)', async () => {
    authedAsOwner();
    mocks.dbExecuteMock.mockResolvedValue([
      { id: 't1', name: 'casa', color: '#FF0000' },
    ]);
    const res = await GET(req('?with_counts=false'));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.tags[0]).not.toHaveProperty('task_count');
  });

  it('?with_counts=1 NÃO activa counts (G2.1 parse estrito — só "true" literal)', async () => {
    authedAsOwner();
    mocks.dbExecuteMock.mockResolvedValue([
      { id: 't1', name: 'casa', color: '#FF0000' },
    ]);
    const res = await GET(req('?with_counts=1'));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.tags[0]).not.toHaveProperty('task_count');
  });

  it('401 sem auth', async () => {
    mocks.getUserMock.mockResolvedValue({ data: { user: null }, error: null });
    const res = await GET(req('?with_counts=true'));
    expect(res.status).toBe(401);
  });
});
