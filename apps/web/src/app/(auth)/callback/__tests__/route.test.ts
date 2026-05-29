// @vitest-environment node
/**
 * Testes da callback route da confirmação de email (Story 6.1 AC3/AC10).
 *
 * Mockam o cliente Supabase (`@meu-jarvis/auth/server`) — não tocam Postgres.
 * Verificam o encaminhamento:
 *   - sem `code` → /entrar
 *   - exchange ok → /confirm?status=ok
 *   - exchange erro → /confirm?status=error
 *
 * Pattern: vi.hoisted + vi.mock (consistente com os testes RSC de finanças).
 */
import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  exchangeCodeForSessionMock: vi.fn(),
}));

vi.mock('@meu-jarvis/auth/server', () => ({
  createServerSupabaseClient: vi.fn(async () => ({
    auth: { exchangeCodeForSession: mocks.exchangeCodeForSessionMock },
  })),
}));

const { GET } = await import('@/app/(auth)/callback/route');

function locationOf(response: Response): string {
  return new URL(response.headers.get('location') ?? '').pathname + (new URL(response.headers.get('location') ?? '').search);
}

describe('/callback route', () => {
  beforeEach(() => {
    mocks.exchangeCodeForSessionMock.mockReset();
  });

  it('sem code → redirect para /entrar (acesso directo)', async () => {
    const res = await GET(new NextRequest('https://expressia.pt/callback'));
    expect(res.status).toBe(307);
    expect(locationOf(res)).toBe('/entrar');
    expect(mocks.exchangeCodeForSessionMock).not.toHaveBeenCalled();
  });

  it('code válido (exchange ok) → /confirm?status=ok', async () => {
    mocks.exchangeCodeForSessionMock.mockResolvedValue({ error: null });
    const res = await GET(new NextRequest('https://expressia.pt/callback?code=abc123'));
    expect(mocks.exchangeCodeForSessionMock).toHaveBeenCalledWith('abc123');
    expect(locationOf(res)).toBe('/confirm?status=ok');
  });

  it('code inválido (exchange erro) → /confirm?status=error', async () => {
    mocks.exchangeCodeForSessionMock.mockResolvedValue({ error: { message: 'invalid' } });
    const res = await GET(new NextRequest('https://expressia.pt/callback?code=expired'));
    expect(mocks.exchangeCodeForSessionMock).toHaveBeenCalledWith('expired');
    expect(locationOf(res)).toBe('/confirm?status=error');
  });
});
