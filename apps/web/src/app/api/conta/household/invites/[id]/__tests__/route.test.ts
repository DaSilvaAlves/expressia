import { NextRequest, NextResponse } from 'next/server';
import { beforeEach, describe, expect, it, vi, type Mock } from 'vitest';

/**
 * Testes de `DELETE /api/conta/household/invites/[id]` — Story 6.7 AC4 (revogar).
 *
 * SEC-7 (handler misto): o DELETE de domínio migrou para `withHousehold`; o
 * `insertAuditLog` permanece FORA em `getDb()`. R-2 smoke: o teste 200 confirma
 * que `insertAuditLog` é chamado após a revogação (AC10).
 */

const mockExecute = vi.fn();

vi.mock('@/lib/agent/db-shim', () => ({
  getDb: vi.fn(() => ({ execute: mockExecute })),
  withHousehold: vi.fn((_auth: unknown, fn: (tx: { execute: typeof mockExecute }) => unknown) =>
    fn({ execute: mockExecute }),
  ),
}));
vi.mock('@/lib/api-helpers/auth', () => ({
  requireAuth: vi.fn(),
  resolveHouseholdRole: vi.fn(),
}));
vi.mock('@/lib/api-helpers/audit', () => ({ insertAuditLog: vi.fn(async () => undefined) }));
vi.mock('@meu-jarvis/observability', () => ({
  withSpan: vi.fn((_n, _a, fn) => fn({ setAttribute: vi.fn() })),
  annotateSpan: vi.fn(),
  captureException: vi.fn(),
  childLogger: vi.fn(() => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn() })),
}));

import { requireAuth, resolveHouseholdRole } from '@/lib/api-helpers/auth';
import { insertAuditLog } from '@/lib/api-helpers/audit';

const AUTH = { userId: 'user-1', householdId: 'hh-1' };
const VALID_UUID = '11111111-1111-1111-1111-111111111111';

function makeReq(): NextRequest {
  return new NextRequest('http://localhost:3000/api/conta/household/invites/x', {
    method: 'DELETE',
  });
}
function ctx(id: string) {
  return { params: Promise.resolve({ id }) };
}

describe('DELETE /api/conta/household/invites/[id]', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (requireAuth as Mock).mockResolvedValue(AUTH);
  });

  it('400 com id não-UUID', async () => {
    (resolveHouseholdRole as Mock).mockResolvedValue('owner');
    const { DELETE } = await import('../route');
    const res = await DELETE(makeReq(), ctx('nao-uuid'));
    expect(res.status).toBe(400);
  });

  it('403 para member', async () => {
    (resolveHouseholdRole as Mock).mockResolvedValue('member');
    const { DELETE } = await import('../route');
    const res = await DELETE(makeReq(), ctx(VALID_UUID));
    expect(res.status).toBe(403);
  });

  it('404 quando o convite não existe', async () => {
    (resolveHouseholdRole as Mock).mockResolvedValue('owner');
    mockExecute.mockResolvedValueOnce([]);
    const { DELETE } = await import('../route');
    const res = await DELETE(makeReq(), ctx(VALID_UUID));
    expect(res.status).toBe(404);
  });

  it('200 revoga convite (owner)', async () => {
    (resolveHouseholdRole as Mock).mockResolvedValue('owner');
    mockExecute.mockResolvedValueOnce([{ id: VALID_UUID, email: 'x@b.pt' }]);
    const { DELETE } = await import('../route');
    const res = await DELETE(makeReq(), ctx(VALID_UUID));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.revoked).toBe(true);
    // R-2 smoke (SEC-7 AC10): audit log gravado após o DELETE de domínio.
    expect(insertAuditLog as Mock).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'household_invite_revoked', entityId: VALID_UUID }),
    );
  });

  it('401 quando requireAuth devolve NextResponse', async () => {
    (requireAuth as Mock).mockResolvedValue(NextResponse.json({}, { status: 401 }));
    const { DELETE } = await import('../route');
    const res = await DELETE(makeReq(), ctx(VALID_UUID));
    expect(res.status).toBe(401);
  });
});
