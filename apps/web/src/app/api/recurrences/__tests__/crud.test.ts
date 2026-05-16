// @vitest-environment node
/**
 * Testes mockable-friendly — GET/POST/PATCH/DELETE /api/recurrences (Story 3.2 AC5).
 *
 * Cobre F2 MEDIUM: PATCH com frequency='custom' retorna 422 UNPROCESSABLE_ENTITY
 * (deferred Story 3.7 quando rrule lib instalada per Epic plan ED7).
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
}));

import { NextRequest } from 'next/server';

const listRoute = await import('@/app/api/recurrences/route');
const idRoute = await import('@/app/api/recurrences/[id]/route');

const USER_UUID = '00000000-0000-0000-0000-000000000001';
const HOUSEHOLD_UUID = '00000000-0000-0000-0000-000000000002';
const REC_UUID = '00000000-0000-0000-0000-000000000abc';

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

describe('GET /api/recurrences', () => {
  beforeEach(() => {
    mocks.getUserMock.mockReset();
    mocks.fromMock.mockReset();
    mocks.dbExecuteMock.mockReset();
  });

  it('401 sem auth', async () => {
    mocks.getUserMock.mockResolvedValue({ data: { user: null }, error: null });
    const res = await listRoute.GET(new NextRequest(new Request('http://localhost/api/recurrences')));
    expect(res.status).toBe(401);
  });

  it('200 lista recurrences', async () => {
    authed();
    mocks.dbExecuteMock.mockResolvedValue([
      { id: 'r1', frequency: 'weekly', interval: 1, active: true },
    ]);
    const res = await listRoute.GET(new NextRequest(new Request('http://localhost/api/recurrences')));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.recurrences).toHaveLength(1);
  });
});

describe('POST /api/recurrences', () => {
  beforeEach(() => {
    mocks.getUserMock.mockReset();
    mocks.fromMock.mockReset();
    mocks.dbExecuteMock.mockReset();
  });

  function req(body: unknown) {
    return new NextRequest(
      new Request('http://localhost/api/recurrences', {
        method: 'POST',
        body: JSON.stringify(body),
        headers: { 'content-type': 'application/json' },
      }),
    );
  }

  it('400 se frequency=custom sem custom_rrule', async () => {
    authed();
    const res = await listRoute.POST(
      req({ frequency: 'custom', starts_on: '2026-05-20', title: 'X' }),
    );
    expect(res.status).toBe(400);
  });

  it('400 se template_task_id null e title ausente', async () => {
    authed();
    const res = await listRoute.POST(req({ frequency: 'weekly', starts_on: '2026-05-20' }));
    expect(res.status).toBe(400);
  });

  it('201 atomicidade cria task template + recurrence', async () => {
    authed();
    mocks.dbExecuteMock
      .mockResolvedValueOnce([]) // BEGIN
      .mockResolvedValueOnce([{ id: 'task-uuid' }]) // INSERT task template
      .mockResolvedValueOnce([
        {
          id: REC_UUID,
          frequency: 'weekly',
          interval: 1,
          starts_on: '2026-05-20',
          template_task_id: 'task-uuid',
        },
      ]) // INSERT recurrence
      .mockResolvedValueOnce([]) // COMMIT
      .mockResolvedValueOnce([]); // audit_log
    const res = await listRoute.POST(
      req({ frequency: 'weekly', starts_on: '2026-05-20', title: 'Limpar casa' }),
    );
    expect(res.status).toBe(201);
  });
});

describe('PATCH /api/recurrences/[id] — F2 MEDIUM 422 UNPROCESSABLE_ENTITY', () => {
  beforeEach(() => {
    mocks.getUserMock.mockReset();
    mocks.fromMock.mockReset();
    mocks.dbExecuteMock.mockReset();
  });

  const ctx = { params: Promise.resolve({ id: REC_UUID }) };

  function req(body: unknown) {
    return new NextRequest(
      new Request('http://localhost/api/recurrences/x', {
        method: 'PATCH',
        body: JSON.stringify(body),
        headers: { 'content-type': 'application/json' },
      }),
    );
  }

  it('422 UNPROCESSABLE_ENTITY se PATCH frequency=custom (F2 deferred Story 3.7)', async () => {
    authed();
    mocks.dbExecuteMock.mockResolvedValueOnce([
      { frequency: 'weekly', interval: 1, next_run_on: '2026-05-20', starts_on: '2026-05-20' },
    ]); // current state
    const res = await idRoute.PATCH(req({ frequency: 'custom', custom_rrule: 'FREQ=WEEKLY' }), ctx);
    expect(res.status).toBe(422);
    const body = await res.json();
    expect(body.error.code).toBe('UNPROCESSABLE_ENTITY');
    expect(body.error.message).toMatch(/Story 3\.7/i);
  });

  it('200 PATCH frequency=daily (preset) re-compute next_run_on', async () => {
    authed();
    mocks.dbExecuteMock
      .mockResolvedValueOnce([
        { frequency: 'weekly', interval: 1, next_run_on: '2026-05-20', starts_on: '2026-05-20' },
      ]) // current
      .mockResolvedValueOnce([{ id: REC_UUID, frequency: 'daily', interval: 1 }]) // UPDATE
      .mockResolvedValueOnce([]); // audit
    const res = await idRoute.PATCH(req({ frequency: 'daily' }), ctx);
    expect(res.status).toBe(200);
  });

  it('400 se body inclui template_task_id (immutable)', async () => {
    authed();
    mocks.dbExecuteMock.mockResolvedValueOnce([
      { frequency: 'weekly', interval: 1, next_run_on: null, starts_on: '2026-05-20' },
    ]);
    const res = await idRoute.PATCH(req({ template_task_id: 'spoofed' }), ctx);
    expect(res.status).toBe(400);
  });
});

describe('DELETE /api/recurrences/[id] — soft delete active=false', () => {
  beforeEach(() => {
    mocks.getUserMock.mockReset();
    mocks.fromMock.mockReset();
    mocks.dbExecuteMock.mockReset();
  });

  const ctx = { params: Promise.resolve({ id: REC_UUID }) };

  it('200 deactivated=true (preserva data)', async () => {
    authed();
    mocks.dbExecuteMock.mockResolvedValueOnce([{ id: REC_UUID }]).mockResolvedValueOnce([]);
    const res = await idRoute.DELETE(
      new NextRequest(new Request('http://localhost/api/recurrences/x', { method: 'DELETE' })),
      ctx,
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.deactivated).toBe(true);
  });

  it('404 se recurrence não existe', async () => {
    authed();
    mocks.dbExecuteMock.mockResolvedValue([]);
    const res = await idRoute.DELETE(
      new NextRequest(new Request('http://localhost/api/recurrences/x', { method: 'DELETE' })),
      ctx,
    );
    expect(res.status).toBe(404);
  });
});
