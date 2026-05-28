// @vitest-environment node
/**
 * Testes — GET /api/visao/briefing (Story 5.5 AC7 + AC9).
 *
 * Stub forward-compatible (`version: 1` — D-5.5.5 / OBS-5).
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  getUserMock: vi.fn(),
  fromMock: vi.fn(),
}));

vi.mock('@meu-jarvis/auth/server', () => ({
  createServerSupabaseClient: vi.fn(async () => ({
    auth: { getUser: mocks.getUserMock },
    from: mocks.fromMock,
  })),
}));

vi.mock('@/lib/agent/db-shim', () => ({
  // Não usado mas necessário para evitar load failure.
  getDb: () => ({ execute: vi.fn() }),
}));

const { GET } = await import('@/app/api/visao/briefing/route');

function memberChain(householdId: string | null) {
  return {
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
  };
}

function authed() {
  mocks.getUserMock.mockResolvedValue({
    data: { user: { id: '00000000-0000-0000-0000-000000000001' } },
    error: null,
  });
  mocks.fromMock.mockReturnValue(memberChain('00000000-0000-0000-0000-000000000002'));
}

describe('GET /api/visao/briefing', () => {
  beforeEach(() => {
    mocks.getUserMock.mockReset();
    mocks.fromMock.mockReset();
  });

  it('401 AUTH_REQUIRED se sem sessão', async () => {
    mocks.getUserMock.mockResolvedValue({ data: { user: null }, error: null });
    const res = await GET();
    expect(res.status).toBe(401);
  });

  it('200 stub forward-compatible', async () => {
    authed();
    const res = await GET();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.version).toBe(1);
    expect(body.available).toBe(false);
    expect(body.message).toBe('Briefing diário disponível em breve.');
    expect(body.generatedAt).toBeNull();
  });

  it('200 schema shape estável (não inventa campos extra)', async () => {
    authed();
    const res = await GET();
    const body = await res.json();
    expect(Object.keys(body).sort()).toEqual([
      'available',
      'generatedAt',
      'message',
      'version',
    ]);
  });
});
