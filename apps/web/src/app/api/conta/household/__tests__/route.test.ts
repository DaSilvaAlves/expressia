import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Testes de `/api/conta/household` (GET + PATCH) — Story 6.x.
 *
 * Mock de Supabase auth (resolveHouseholdId via PostgREST) + `withHousehold`
 * (db-shim — SEC-7). Não toca DB real (unit). Cobre auth, papel insuficiente
 * (403), validação e caminhos felizes. O mock de `withHousehold` invoca o
 * callback com o fake db (`fn({ execute: mockExecute })`) — as asserções de
 * número de calls a `mockExecute` mantêm-se válidas após a migração SEC-7.
 *
 * Trace: Story 6.x AC1-AC4; NFR5; SEC-7 AC1/AC10.
 */

const mockGetUser = vi.fn();
const mockFrom = vi.fn();
const mockExecute = vi.fn();

vi.mock('@meu-jarvis/auth/server', () => ({
  createServerSupabaseClient: vi.fn(async () => ({
    auth: { getUser: mockGetUser },
    from: mockFrom,
  })),
}));

vi.mock('@/lib/agent/db-shim', () => ({
  // SEC-7 — `household/route.ts` migrou de `getDb()` para `withHousehold`.
  // O mock invoca o callback com o fake db; o `mockExecute` partilhado mantém
  // a contagem/ordem de calls que as asserções esperam.
  withHousehold: vi.fn((_auth: unknown, fn: (tx: { execute: typeof mockExecute }) => unknown) =>
    fn({ execute: mockExecute }),
  ),
}));

vi.mock('@meu-jarvis/observability', () => ({
  withSpan: vi.fn((_name, _attrs, fn) => fn({ setAttribute: vi.fn() })),
  annotateSpan: vi.fn(),
  captureException: vi.fn(),
  childLogger: vi.fn(() => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn() })),
  hashForCorrelation: vi.fn((s: string) => `hash_${s}`),
  recordSpanError: vi.fn(),
}));

/** Mock de `resolveHouseholdId` → devolve `householdId` (ou null). */
function mockResolveHousehold(householdId: string | null): void {
  mockFrom.mockReturnValue({
    select: vi.fn().mockReturnValue({
      eq: vi.fn().mockReturnValue({
        limit: vi.fn().mockReturnValue({
          maybeSingle: vi.fn().mockResolvedValue({
            data: householdId ? { household_id: householdId } : null,
            error: null,
          }),
        }),
      }),
    }),
  });
}

function makePatchReq(body: unknown): NextRequest {
  return new NextRequest('http://localhost:3000/api/conta/household', {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

describe('/api/conta/household', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('GET', () => {
    it('retorna 401 sem sessão', async () => {
      mockGetUser.mockResolvedValue({ data: { user: null }, error: null });
      const { GET } = await import('../route');
      const res = await GET();
      expect(res.status).toBe(401);
    });

    it('retorna 404 sem household', async () => {
      mockGetUser.mockResolvedValue({
        data: { user: { id: 'user-1', email: 'a@b.pt' } },
        error: null,
      });
      mockResolveHousehold(null);
      const { GET } = await import('../route');
      const res = await GET();
      expect(res.status).toBe(404);
    });

    it('retorna household + membros ordenados + myRole', async () => {
      mockGetUser.mockResolvedValue({
        data: { user: { id: 'user-1', email: 'owner@b.pt' } },
        error: null,
      });
      mockResolveHousehold('hh-1');
      mockExecute
        .mockResolvedValueOnce([
          { id: 'hh-1', name: 'Casa Silva', plan: 'familia' },
        ]) // household
        .mockResolvedValueOnce([
          {
            user_id: 'user-2',
            role: 'member',
            display_name: 'Filho Silva',
            joined_at: '2026-02-01T00:00:00.000Z',
          },
          {
            user_id: 'user-1',
            role: 'owner',
            display_name: 'Mãe Silva',
            joined_at: '2026-01-01T00:00:00.000Z',
          },
        ]); // members (desordenados de propósito)

      const { GET } = await import('../route');
      const res = await GET();
      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.household.name).toBe('Casa Silva');
      expect(json.household.plan).toBe('familia');
      expect(json.myRole).toBe('owner');
      // owner ordenado antes do member
      expect(json.members[0].role).toBe('owner');
      expect(json.members[1].role).toBe('member');
      expect(json.members).toHaveLength(2);
    });
  });

  describe('PATCH', () => {
    it('retorna 401 sem sessão', async () => {
      mockGetUser.mockResolvedValue({ data: { user: null }, error: null });
      const { PATCH } = await import('../route');
      const res = await PATCH(makePatchReq({ name: 'X' }));
      expect(res.status).toBe(401);
    });

    it('retorna 400 com nome vazio', async () => {
      mockGetUser.mockResolvedValue({
        data: { user: { id: 'user-1', email: 'a@b.pt' } },
        error: null,
      });
      mockResolveHousehold('hh-1');
      const { PATCH } = await import('../route');
      const res = await PATCH(makePatchReq({ name: '   ' }));
      expect(res.status).toBe(400);
    });

    it('retorna 403 para papel member', async () => {
      mockGetUser.mockResolvedValue({
        data: { user: { id: 'user-2', email: 'filho@b.pt' } },
        error: null,
      });
      mockResolveHousehold('hh-1');
      mockExecute.mockResolvedValueOnce([{ role: 'member' }]); // role check
      const { PATCH } = await import('../route');
      const res = await PATCH(makePatchReq({ name: 'Nova Casa' }));
      expect(res.status).toBe(403);
    });

    it('renomeia com sucesso para owner', async () => {
      mockGetUser.mockResolvedValue({
        data: { user: { id: 'user-1', email: 'owner@b.pt' } },
        error: null,
      });
      mockResolveHousehold('hh-1');
      mockExecute
        .mockResolvedValueOnce([{ role: 'owner' }]) // role check
        .mockResolvedValueOnce([
          { id: 'hh-1', name: 'Nova Casa', plan: 'familia' },
        ]); // update returning
      const { PATCH } = await import('../route');
      const res = await PATCH(makePatchReq({ name: 'Nova Casa' }));
      expect(res.status).toBe(200);
      const json = await res.json();
      expect(json.household.name).toBe('Nova Casa');
    });
  });
});
