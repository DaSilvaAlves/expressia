// @vitest-environment node
/**
 * Testes da callback route da confirmação de email (Story 6.1 AC3/AC10 + fix
 * EMAIL-CONFIRM token_hash).
 *
 * Mockam o cliente Supabase (`@meu-jarvis/auth/server`) — não tocam Postgres.
 * Verificam o encaminhamento dos dois fluxos:
 *   token_hash:
 *     - verifyOtp ok    → /confirm?status=ok
 *     - verifyOtp erro  → /confirm?status=error
 *     - type inválido   → normaliza para 'email'
 *   code (retrocompat):
 *     - exchange ok     → /confirm?status=ok
 *     - exchange erro   → /confirm?status=error
 *   sem token nem code  → /entrar
 *
 * Pattern: vi.hoisted + vi.mock (consistente com os testes RSC de finanças).
 */
import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  exchangeCodeForSessionMock: vi.fn(),
  verifyOtpMock: vi.fn(),
}));

vi.mock('@meu-jarvis/auth/server', () => ({
  createServerSupabaseClient: vi.fn(async () => ({
    auth: {
      exchangeCodeForSession: mocks.exchangeCodeForSessionMock,
      verifyOtp: mocks.verifyOtpMock,
    },
  })),
}));

const { GET } = await import('@/app/(auth)/callback/route');

function locationOf(response: Response): string {
  const url = new URL(response.headers.get('location') ?? '');
  return url.pathname + url.search;
}

describe('/callback route', () => {
  beforeEach(() => {
    mocks.exchangeCodeForSessionMock.mockReset();
    mocks.verifyOtpMock.mockReset();
  });

  it('sem token_hash nem code → redirect para /entrar (acesso directo)', async () => {
    const res = await GET(new NextRequest('https://expressia.pt/callback'));
    expect(res.status).toBe(307);
    expect(locationOf(res)).toBe('/entrar');
    expect(mocks.verifyOtpMock).not.toHaveBeenCalled();
    expect(mocks.exchangeCodeForSessionMock).not.toHaveBeenCalled();
  });

  // --- Fluxo 1: token_hash + verifyOtp (preferido) ---

  it('token_hash válido (verifyOtp ok) → /confirm?status=ok', async () => {
    mocks.verifyOtpMock.mockResolvedValue({ error: null });
    const res = await GET(
      new NextRequest('https://expressia.pt/callback?token_hash=h123&type=email'),
    );
    expect(mocks.verifyOtpMock).toHaveBeenCalledWith({ type: 'email', token_hash: 'h123' });
    expect(mocks.exchangeCodeForSessionMock).not.toHaveBeenCalled();
    expect(locationOf(res)).toBe('/confirm?status=ok');
  });

  it('token_hash inválido (verifyOtp erro) → /confirm?status=error', async () => {
    mocks.verifyOtpMock.mockResolvedValue({ error: { message: 'expired' } });
    const res = await GET(
      new NextRequest('https://expressia.pt/callback?token_hash=expired&type=signup'),
    );
    expect(mocks.verifyOtpMock).toHaveBeenCalledWith({ type: 'signup', token_hash: 'expired' });
    expect(locationOf(res)).toBe('/confirm?status=error');
  });

  it('token_hash com type ausente/inválido → normaliza para email', async () => {
    mocks.verifyOtpMock.mockResolvedValue({ error: null });
    const res = await GET(
      new NextRequest('https://expressia.pt/callback?token_hash=h456&type=lixo'),
    );
    expect(mocks.verifyOtpMock).toHaveBeenCalledWith({ type: 'email', token_hash: 'h456' });
    expect(locationOf(res)).toBe('/confirm?status=ok');
  });

  it('token_hash tem precedência sobre code', async () => {
    mocks.verifyOtpMock.mockResolvedValue({ error: null });
    const res = await GET(
      new NextRequest('https://expressia.pt/callback?token_hash=h789&code=abc'),
    );
    expect(mocks.verifyOtpMock).toHaveBeenCalledOnce();
    expect(mocks.exchangeCodeForSessionMock).not.toHaveBeenCalled();
    expect(locationOf(res)).toBe('/confirm?status=ok');
  });

  // --- Fluxo 2: code + exchangeCodeForSession (retrocompat) ---

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
