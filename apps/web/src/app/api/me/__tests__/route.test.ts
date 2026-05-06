// @vitest-environment node
/**
 * Testes unitários para `GET /api/me` (Story 1.6 Task 3, AC1-AC3).
 *
 * Estratégia (Story 1.6 — decisão C2): mock do `createServerSupabaseClient`
 * em vez de Testcontainers. Story 1.4 (RLS Test Suite com Postgres real) é
 * complementar — quando estabilizar, considerar migração para integração real.
 *
 * Cobertura:
 *   - AC1: 200 com household correcto
 *   - AC2: 401 sem JWT
 *   - AC3: 404 com utilizador sem household
 *   - Defensive: 500 quando query Postgres falha
 *
 * Ambiente: `node` (override do default `jsdom` do projecto) — Route Handlers
 * dependem de globais Web (Response, Headers) que jsdom polui.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

// Spies partilhados pelos testes — permitem cada teste configurar a sua
// resposta sem reconstruir todo o cliente mock.
const mockGetUser = vi.fn();
const mockMaybeSingle = vi.fn();

vi.mock('@meu-jarvis/auth/server', () => ({
  createServerSupabaseClient: vi.fn(async () => ({
    auth: { getUser: mockGetUser },
    from: vi.fn(() => ({
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      limit: vi.fn().mockReturnThis(),
      maybeSingle: mockMaybeSingle,
    })),
  })),
}));

// Import depois do vi.mock — ESM hoisting garante que o mock está activo.
import { GET } from '@/app/api/me/route';

describe('GET /api/me', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('AC2 — devolve 401 quando user é null (sem JWT)', async () => {
    mockGetUser.mockResolvedValueOnce({ data: { user: null }, error: null });

    const response = await GET();

    expect(response.status).toBe(401);
    const body = (await response.json()) as { error: { code: string; message: string } };
    expect(body.error.code).toBe('AUTH_REQUIRED');
    expect(body.error.message).toContain('Sessão inválida');
    expect(typeof body.error).toBe('object');
  });

  it('AC2 — devolve 401 quando supabase.auth.getUser retorna error', async () => {
    mockGetUser.mockResolvedValueOnce({
      data: { user: null },
      error: new Error('JWT expired'),
    });

    const response = await GET();

    expect(response.status).toBe(401);
    const body = (await response.json()) as { error: { code: string } };
    expect(body.error.code).toBe('AUTH_REQUIRED');
  });

  it('AC3 — devolve 404 quando JWT válido mas sem household', async () => {
    mockGetUser.mockResolvedValueOnce({
      data: { user: { id: 'user-1', email: 'novato@expressia.pt' } },
      error: null,
    });
    mockMaybeSingle.mockResolvedValueOnce({ data: null, error: null });

    const response = await GET();

    expect(response.status).toBe(404);
    const body = (await response.json()) as { error: { code: string; message: string } };
    expect(body.error.code).toBe('HOUSEHOLD_NOT_FOUND');
    expect(body.error.message).toContain('Household não encontrado');
  });

  it('AC3 — devolve 404 quando row existe mas households relação é null', async () => {
    mockGetUser.mockResolvedValueOnce({
      data: { user: { id: 'user-1', email: 'a@b.pt' } },
      error: null,
    });
    mockMaybeSingle.mockResolvedValueOnce({
      data: { role: 'member', households: null },
      error: null,
    });

    const response = await GET();

    expect(response.status).toBe(404);
    const body = (await response.json()) as { error: { code: string } };
    expect(body.error.code).toBe('HOUSEHOLD_NOT_FOUND');
  });

  it('AC1 — devolve 200 com user, household e role quando tudo válido', async () => {
    mockGetUser.mockResolvedValueOnce({
      data: { user: { id: 'user-1', email: 'eurico@expressia.pt' } },
      error: null,
    });
    mockMaybeSingle.mockResolvedValueOnce({
      data: {
        role: 'owner',
        households: { id: 'h-1', name: 'Casa do Eurico', plan: 'familia' },
      },
      error: null,
    });

    const response = await GET();

    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      user: { id: string; email: string };
      household: { id: string; name: string; plan: string };
      role: string;
    };
    expect(body).toEqual({
      user: { id: 'user-1', email: 'eurico@expressia.pt' },
      household: { id: 'h-1', name: 'Casa do Eurico', plan: 'familia' },
      role: 'owner',
    });
  });

  it('AC1 — preserva email null quando Supabase retorna user sem email', async () => {
    mockGetUser.mockResolvedValueOnce({
      data: { user: { id: 'user-1', email: null } },
      error: null,
    });
    mockMaybeSingle.mockResolvedValueOnce({
      data: {
        role: 'member',
        households: { id: 'h-1', name: 'Casa', plan: 'free' },
      },
      error: null,
    });

    const response = await GET();

    expect(response.status).toBe(200);
    const body = (await response.json()) as { user: { email: string | null } };
    expect(body.user.email).toBeNull();
  });

  it('Defensive — devolve 500 quando query Postgres falha', async () => {
    mockGetUser.mockResolvedValueOnce({
      data: { user: { id: 'user-1', email: 'a@b.pt' } },
      error: null,
    });
    mockMaybeSingle.mockResolvedValueOnce({
      data: null,
      error: { message: 'connection refused', code: 'PGRST500' },
    });

    const response = await GET();

    expect(response.status).toBe(500);
    const body = (await response.json()) as { error: { code: string; message: string } };
    expect(body.error.code).toBe('HOUSEHOLD_QUERY_FAILED');
    // Garantir que a mensagem interna NUNCA fica visível ao cliente
    expect(body.error.message).not.toContain('connection refused');
    expect(body.error.message).not.toContain('PGRST500');
  });

  it('AC8 — todas as respostas de erro incluem requestId UUID + timestamp ISO', async () => {
    mockGetUser.mockResolvedValueOnce({ data: { user: null }, error: null });

    const response = await GET();
    const body = (await response.json()) as {
      error: { requestId: string; timestamp: string };
    };

    // requestId deve ser UUID v4 (ou similar canónico).
    expect(body.error.requestId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
    );
    // timestamp ISO-8601 com timezone (Z ou ±hh:mm).
    expect(body.error.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
    // Verificar que é parseável como Date.
    expect(Number.isNaN(new Date(body.error.timestamp).getTime())).toBe(false);
  });
});
