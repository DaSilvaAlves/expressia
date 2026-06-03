import { NextRequest, NextResponse } from 'next/server';
import { beforeEach, describe, expect, it, vi, type Mock } from 'vitest';

/**
 * Testes de `DELETE /api/conta/household/members/[userId]` — Story 6.7 AC5.
 * Guard inegociável: nunca remover o owner (422).
 *
 * SEC-7 (handler misto): as queries de domínio (role lookup + DELETE) migraram
 * para `withHousehold`; o `insertAuditLog` permanece FORA em `getDb()`. R-2
 * smoke: o teste 200 confirma que `insertAuditLog` é chamado após o DELETE (AC10).
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
const TARGET = '22222222-2222-2222-2222-222222222222';

function makeReq(): NextRequest {
  return new NextRequest('http://localhost:3000/api/conta/household/members/x', {
    method: 'DELETE',
  });
}
function ctx(userId: string) {
  return { params: Promise.resolve({ userId }) };
}

describe('DELETE /api/conta/household/members/[userId]', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (requireAuth as Mock).mockResolvedValue(AUTH);
  });

  it('403 para member', async () => {
    (resolveHouseholdRole as Mock).mockResolvedValue('member');
    const { DELETE } = await import('../route');
    const res = await DELETE(makeReq(), ctx(TARGET));
    expect(res.status).toBe(403);
  });

  it('404 quando o membro-alvo não existe', async () => {
    (resolveHouseholdRole as Mock).mockResolvedValue('owner');
    mockExecute.mockResolvedValueOnce([]); // target role lookup vazio
    const { DELETE } = await import('../route');
    const res = await DELETE(makeReq(), ctx(TARGET));
    expect(res.status).toBe(404);
  });

  it('422 ao tentar remover o owner (guard inegociável)', async () => {
    (resolveHouseholdRole as Mock).mockResolvedValue('owner');
    mockExecute.mockResolvedValueOnce([{ role: 'owner' }]); // target é owner
    const { DELETE } = await import('../route');
    const res = await DELETE(makeReq(), ctx(TARGET));
    expect(res.status).toBe(422);
    const json = await res.json();
    expect(json.error.code).toBe('OWNER_NOT_REMOVABLE');
  });

  it('200 remove membro member (owner/admin)', async () => {
    (resolveHouseholdRole as Mock).mockResolvedValue('owner');
    mockExecute
      .mockResolvedValueOnce([{ role: 'member' }]) // target role
      .mockResolvedValueOnce([{ user_id: TARGET }]); // delete returning
    const { DELETE } = await import('../route');
    const res = await DELETE(makeReq(), ctx(TARGET));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.removed).toBe(true);
    expect(json.userId).toBe(TARGET);
    // R-2 smoke (SEC-7 AC10): audit log gravado após o DELETE de domínio.
    expect(insertAuditLog as Mock).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'household_member_removed', entityId: TARGET }),
    );
  });

  it('400 com userId não-UUID', async () => {
    (resolveHouseholdRole as Mock).mockResolvedValue('owner');
    const { DELETE } = await import('../route');
    const res = await DELETE(makeReq(), ctx('nao-uuid'));
    expect(res.status).toBe(400);
  });

  it('401 quando requireAuth devolve NextResponse', async () => {
    (requireAuth as Mock).mockResolvedValue(NextResponse.json({}, { status: 401 }));
    const { DELETE } = await import('../route');
    const res = await DELETE(makeReq(), ctx(TARGET));
    expect(res.status).toBe(401);
  });
});
