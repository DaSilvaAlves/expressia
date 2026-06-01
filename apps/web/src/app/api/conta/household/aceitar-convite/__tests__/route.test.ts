import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Testes de `POST /api/conta/household/aceitar-convite` — Story 6.7 AC6.
 * Cobre o mapeamento de erros tipados de `accept_invite()` + caminhos felizes.
 */

const mockGetUser = vi.fn();
const mockExecute = vi.fn();

vi.mock('@meu-jarvis/auth/server', () => ({
  createServerSupabaseClient: vi.fn(async () => ({ auth: { getUser: mockGetUser } })),
}));
vi.mock('@/lib/agent/db-shim', () => ({ getDb: vi.fn(() => ({ execute: mockExecute })) }));
vi.mock('@meu-jarvis/observability', () => ({
  withSpan: vi.fn((_n, _a, fn) => fn({ setAttribute: vi.fn() })),
  annotateSpan: vi.fn(),
  captureException: vi.fn(),
  childLogger: vi.fn(() => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn() })),
}));

import { mapAcceptInviteError } from '@/app/api/conta/household/aceitar-convite/route';

function makeReq(body: unknown): NextRequest {
  return new NextRequest('http://localhost:3000/api/conta/household/aceitar-convite', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

describe('mapAcceptInviteError', () => {
  const cases: Array<[string, string, number]> = [
    ['INVITE_NOT_FOUND', 'INVITE_NOT_FOUND', 404],
    ['INVITE_EXPIRED', 'INVITE_EXPIRED', 410],
    ['INVITE_ALREADY_ACCEPTED', 'INVITE_ALREADY_ACCEPTED', 409],
    ['INVITE_EMAIL_MISMATCH', 'INVITE_EMAIL_MISMATCH', 403],
    ['ALREADY_MEMBER', 'ALREADY_MEMBER', 409],
    ['MEMBER_LIMIT_REACHED', 'MEMBER_LIMIT_REACHED', 409],
    ['AUTH_REQUIRED', 'AUTH_REQUIRED', 401],
    ['algo inesperado', 'INTERNAL_ERROR', 500],
  ];

  it.each(cases)('mapeia "%s" → %s (%i)', (raw, code, status) => {
    const mapped = mapAcceptInviteError(new Error(`erro: ${raw}`));
    expect(mapped.code).toBe(code);
    expect(mapped.status).toBe(status);
    expect(mapped.message.length).toBeGreaterThan(0);
  });
});

describe('POST /api/conta/household/aceitar-convite', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('401 sem sessão', async () => {
    mockGetUser.mockResolvedValue({ data: { user: null }, error: null });
    const { POST } = await import('../route');
    const res = await POST(makeReq({ token: 'abc' }));
    expect(res.status).toBe(401);
  });

  it('400 sem token', async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: 'u1' } }, error: null });
    const { POST } = await import('../route');
    const res = await POST(makeReq({}));
    expect(res.status).toBe(400);
  });

  it('200 aceita convite e devolve householdId', async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: 'u1' } }, error: null });
    mockExecute.mockResolvedValueOnce([{ household_id: 'hh-2' }]);
    const { POST } = await import('../route');
    const res = await POST(makeReq({ token: 'tok123' }));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.accepted).toBe(true);
    expect(json.householdId).toBe('hh-2');
  });

  it('410 quando o convite expirou', async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: 'u1' } }, error: null });
    mockExecute.mockRejectedValueOnce(new Error('... INVITE_EXPIRED ...'));
    const { POST } = await import('../route');
    const res = await POST(makeReq({ token: 'tok123' }));
    expect(res.status).toBe(410);
  });

  it('409 quando o limite de membros foi atingido', async () => {
    mockGetUser.mockResolvedValue({ data: { user: { id: 'u1' } }, error: null });
    mockExecute.mockRejectedValueOnce(new Error('MEMBER_LIMIT_REACHED'));
    const { POST } = await import('../route');
    const res = await POST(makeReq({ token: 'tok123' }));
    expect(res.status).toBe(409);
  });
});
