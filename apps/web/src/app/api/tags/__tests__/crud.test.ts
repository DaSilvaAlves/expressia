// @vitest-environment node
/**
 * Testes mockable-friendly — GET/POST/PATCH/DELETE /api/tags
 * (Story 3.2 AC3 — variant `tags_delete_owner_admin` → 403 FORBIDDEN).
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

const { GET, POST } = await import('@/app/api/tags/route');
const idRoute = await import('@/app/api/tags/[id]/route');

const USER_UUID = '00000000-0000-0000-0000-000000000001';
const HOUSEHOLD_UUID = '00000000-0000-0000-0000-000000000002';
const TAG_UUID = '00000000-0000-0000-0000-000000000aaa';

function memberChain(field: string, value: unknown) {
  return {
    select: vi.fn().mockReturnValue({
      eq: vi.fn().mockReturnValue({
        limit: vi.fn().mockReturnValue({
          maybeSingle: vi.fn().mockResolvedValue({ data: value ? { [field]: value } : null, error: null }),
        }),
        eq: vi.fn().mockReturnValue({
          limit: vi.fn().mockReturnValue({
            maybeSingle: vi.fn().mockResolvedValue({ data: value ? { [field]: value } : null, error: null }),
          }),
        }),
      }),
    }),
  };
}

function authedAsOwner() {
  mocks.getUserMock.mockResolvedValue({ data: { user: { id: USER_UUID } }, error: null });
  // First call: resolveHouseholdId → returns household_id
  // Second call (if DELETE): resolveHouseholdRole → returns role: 'owner'
  let callCount = 0;
  mocks.fromMock.mockImplementation(() => {
    callCount++;
    if (callCount === 1) return memberChain('household_id', HOUSEHOLD_UUID);
    return memberChain('role', 'owner');
  });
}

function authedAsMember() {
  mocks.getUserMock.mockResolvedValue({ data: { user: { id: USER_UUID } }, error: null });
  let callCount = 0;
  mocks.fromMock.mockImplementation(() => {
    callCount++;
    if (callCount === 1) return memberChain('household_id', HOUSEHOLD_UUID);
    return memberChain('role', 'member');
  });
}

describe('GET /api/tags', () => {
  beforeEach(() => {
    mocks.getUserMock.mockReset();
    mocks.fromMock.mockReset();
    mocks.dbExecuteMock.mockReset();
  });

  it('401 sem auth', async () => {
    mocks.getUserMock.mockResolvedValue({ data: { user: null }, error: null });
    const res = await GET(new NextRequest(new Request('http://localhost/api/tags')));
    expect(res.status).toBe(401);
  });

  it('200 lista tags ordenadas', async () => {
    authedAsOwner();
    mocks.dbExecuteMock.mockResolvedValue([
      { id: 't1', name: 'casa', color: '#FF0000' },
      { id: 't2', name: 'trabalho', color: '#00FF00' },
    ]);
    const res = await GET(new NextRequest(new Request('http://localhost/api/tags')));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.tags).toHaveLength(2);
  });
});

describe('POST /api/tags', () => {
  beforeEach(() => {
    mocks.getUserMock.mockReset();
    mocks.fromMock.mockReset();
    mocks.dbExecuteMock.mockReset();
  });

  function req(body: unknown) {
    return new NextRequest(
      new Request('http://localhost/api/tags', {
        method: 'POST',
        body: JSON.stringify(body),
        headers: { 'content-type': 'application/json' },
      }),
    );
  }

  it('400 se body inclui household_id (Zod strict)', async () => {
    authedAsOwner();
    const res = await POST(req({ name: 'casa', household_id: 'spoofed' }));
    expect(res.status).toBe(400);
  });

  it('400 se name vazio', async () => {
    authedAsOwner();
    const res = await POST(req({ name: '' }));
    expect(res.status).toBe(400);
  });

  it('400 se color inválido (não hex)', async () => {
    authedAsOwner();
    const res = await POST(req({ name: 'casa', color: 'red' }));
    expect(res.status).toBe(400);
  });

  it('201 cria tag', async () => {
    authedAsOwner();
    mocks.dbExecuteMock
      .mockResolvedValueOnce([{ id: TAG_UUID, name: 'casa', color: '#6B7280' }])
      .mockResolvedValueOnce([]);
    const res = await POST(req({ name: 'casa' }));
    expect(res.status).toBe(201);
  });

  it('409 CONFLICT se unique constraint violation', async () => {
    authedAsOwner();
    mocks.dbExecuteMock.mockRejectedValue(
      new Error('duplicate key value violates unique constraint "tags_unique_name_per_household"'),
    );
    const res = await POST(req({ name: 'casa' }));
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.error.code).toBe('CONFLICT');
  });
});

describe('DELETE /api/tags/[id] — variant tags_delete_owner_admin', () => {
  beforeEach(() => {
    mocks.getUserMock.mockReset();
    mocks.fromMock.mockReset();
    mocks.dbExecuteMock.mockReset();
  });

  const ctx = { params: Promise.resolve({ id: TAG_UUID }) };

  it('403 FORBIDDEN se role=member (não owner/admin — variant enforced)', async () => {
    authedAsMember();
    const res = await idRoute.DELETE(
      new NextRequest(new Request('http://localhost/api/tags/x', { method: 'DELETE' })),
      ctx,
    );
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.error.code).toBe('FORBIDDEN');
    expect(body.error.message).toMatch(/owner ou admin/i);
  });

  it('200 deleted=true se role=owner', async () => {
    authedAsOwner();
    mocks.dbExecuteMock.mockResolvedValueOnce([{ id: TAG_UUID }]).mockResolvedValueOnce([]);
    const res = await idRoute.DELETE(
      new NextRequest(new Request('http://localhost/api/tags/x', { method: 'DELETE' })),
      ctx,
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.deleted).toBe(true);
  });

  it('404 se tag não existe (DELETE rows=0)', async () => {
    authedAsOwner();
    mocks.dbExecuteMock.mockResolvedValue([]);
    const res = await idRoute.DELETE(
      new NextRequest(new Request('http://localhost/api/tags/x', { method: 'DELETE' })),
      ctx,
    );
    expect(res.status).toBe(404);
  });
});
