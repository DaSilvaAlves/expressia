import { NextRequest, NextResponse } from 'next/server';
import { beforeEach, describe, expect, it, vi, type Mock } from 'vitest';

/**
 * Testes de `/api/conta/household/invites` (POST + GET) — Story 6.7 AC2/AC3.
 *
 * Mocks: helpers de auth (requireAuth/resolveHouseholdRole), db-shim, audit,
 * observability. Não toca DB real (unit). Cobre autorização owner/admin (403),
 * criação com link (201), unique (409), validação (400) e listagem (200).
 *
 * SEC-7 (handler misto): a operação de domínio migrou para `withHousehold`; o
 * `insertAuditLog` permanece FORA do wrapper em `getDb()` (best-effort). O mock
 * expõe ambos. R-2 smoke: o teste 201 confirma que `insertAuditLog` é chamado
 * após a operação de domínio (AC10).
 */

const mockExecute = vi.fn();

vi.mock('@/lib/agent/db-shim', () => ({
  getDb: vi.fn(() => ({ execute: mockExecute })),
  // SEC-7 — INSERT/SELECT de domínio dentro de `withHousehold`; o mock invoca
  // o callback com o mesmo fake db (`mockExecute` partilhado).
  withHousehold: vi.fn((_auth: unknown, fn: (tx: { execute: typeof mockExecute }) => unknown) =>
    fn({ execute: mockExecute }),
  ),
}));

vi.mock('@/lib/api-helpers/auth', () => ({
  requireAuth: vi.fn(),
  resolveHouseholdRole: vi.fn(),
}));

vi.mock('@/lib/api-helpers/audit', () => ({
  insertAuditLog: vi.fn(async () => undefined),
}));

// Story INVITE-EMAIL — o handler POST agora envia email best-effort via este
// helper. Mockamo-lo para não importar o cliente Resend real e manter o teste
// 201 isolado da camada de email (sucesso por defeito; falha é best-effort).
vi.mock('@/lib/email/resend', () => ({
  sendInviteEmail: vi.fn(async () => ({ ok: true })),
}));

vi.mock('@meu-jarvis/observability', () => ({
  withSpan: vi.fn((_name, _attrs, fn) => fn({ setAttribute: vi.fn() })),
  annotateSpan: vi.fn(),
  captureException: vi.fn(),
  childLogger: vi.fn(() => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn() })),
  hashForCorrelation: vi.fn((s: string) => `hash_${s}`),
}));

import { requireAuth, resolveHouseholdRole } from '@/lib/api-helpers/auth';
import { insertAuditLog } from '@/lib/api-helpers/audit';

const AUTH = { userId: 'user-1', householdId: 'hh-1' };

function makePostReq(body: unknown): NextRequest {
  return new NextRequest('http://localhost:3000/api/conta/household/invites', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

describe('/api/conta/household/invites', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (requireAuth as Mock).mockResolvedValue(AUTH);
  });

  describe('POST', () => {
    it('401 quando requireAuth devolve NextResponse', async () => {
      (requireAuth as Mock).mockResolvedValue(NextResponse.json({}, { status: 401 }));
      const { POST } = await import('../route');
      const res = await POST(makePostReq({ email: 'a@b.pt' }));
      expect(res.status).toBe(401);
    });

    it('403 para papel member', async () => {
      (resolveHouseholdRole as Mock).mockResolvedValue('member');
      const { POST } = await import('../route');
      const res = await POST(makePostReq({ email: 'novo@b.pt' }));
      expect(res.status).toBe(403);
    });

    it('400 com email inválido', async () => {
      (resolveHouseholdRole as Mock).mockResolvedValue('owner');
      const { POST } = await import('../route');
      const res = await POST(makePostReq({ email: 'nao-e-email' }));
      expect(res.status).toBe(400);
    });

    it('201 cria convite e devolve acceptPath (owner)', async () => {
      (resolveHouseholdRole as Mock).mockResolvedValue('owner');
      mockExecute.mockResolvedValueOnce([
        {
          id: 'inv-1',
          email: 'novo@b.pt',
          role: 'member',
          expires_at: '2026-06-08T00:00:00.000Z',
          created_at: '2026-06-01T00:00:00.000Z',
        },
      ]);
      const { POST } = await import('../route');
      const res = await POST(makePostReq({ email: 'novo@b.pt', role: 'member' }));
      expect(res.status).toBe(201);
      const json = await res.json();
      expect(json.invite.email).toBe('novo@b.pt');
      expect(json.acceptPath).toMatch(/^\/aceitar-convite\/[a-f0-9]{64}$/);
      // R-2 smoke (SEC-7 AC10): audit log gravado após a operação de domínio.
      expect(insertAuditLog as Mock).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'household_invite_sent', entityId: 'inv-1' }),
      );
    });

    it('409 quando há convite pendente duplicado (unique)', async () => {
      (resolveHouseholdRole as Mock).mockResolvedValue('admin');
      mockExecute.mockRejectedValueOnce(
        Object.assign(new Error('duplicate key value violates unique constraint'), {
          code: '23505',
        }),
      );
      const { POST } = await import('../route');
      const res = await POST(makePostReq({ email: 'dup@b.pt' }));
      expect(res.status).toBe(409);
    });
  });

  describe('GET', () => {
    it('200 lista convites pendentes', async () => {
      mockExecute.mockResolvedValueOnce([
        {
          id: 'inv-1',
          email: 'novo@b.pt',
          role: 'member',
          expires_at: '2026-06-08T00:00:00.000Z',
          created_at: '2026-06-01T00:00:00.000Z',
        },
      ]);
      const { GET } = await import('../route');
      const res = await GET();
      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.invites).toHaveLength(1);
      // token NUNCA exposto na listagem
      expect(json.invites[0].token).toBeUndefined();
    });
  });
});
