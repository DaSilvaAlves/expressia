// @vitest-environment node
/**
 * Testes do Server Action signUpAction (Story 6.1 AC2/AC10).
 *
 * Foco no novo comportamento de verificação de email (DP1): `emailRedirectTo`
 * derivado do origin + encaminhamento para `/confirm` quando a sessão fica
 * pendente de confirmação. Mockam headers/redirect/cliente Supabase — sem rede.
 *
 * `redirect()` é mockado para lançar (como o real lança NEXT_REDIRECT), de modo
 * a interromper o fluxo no ponto certo e permitir assertar o destino.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  signUpMock: vi.fn(),
  redirectMock: vi.fn((url: string) => {
    throw new Error(`REDIRECT:${url}`);
  }),
  headerGetMock: vi.fn(),
}));

vi.mock('next/headers', () => ({
  headers: vi.fn(async () => ({ get: mocks.headerGetMock })),
}));
vi.mock('next/navigation', () => ({ redirect: mocks.redirectMock }));
vi.mock('@meu-jarvis/auth/server', () => ({
  createServerSupabaseClient: vi.fn(async () => ({ auth: { signUp: mocks.signUpMock } })),
}));

const { signUpAction } = await import('@/app/(auth)/actions');

function form(fields: Record<string, string>): FormData {
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields)) fd.set(k, v);
  return fd;
}

const VALID = { email: 'novo@expressia.pt', password: 'segredo123', password_confirm: 'segredo123' };

describe('signUpAction (Story 6.1 AC2)', () => {
  beforeEach(() => {
    mocks.signUpMock.mockReset();
    mocks.redirectMock.mockClear();
    mocks.headerGetMock.mockReset();
    mocks.headerGetMock.mockImplementation((k: string) =>
      k === 'origin' ? 'https://expressia.pt' : null,
    );
  });

  it('passa emailRedirectTo a apontar para /callback (origin derivado dos headers)', async () => {
    mocks.signUpMock.mockResolvedValue({ data: { user: { id: 'u1' }, session: null }, error: null });
    await expect(signUpAction({}, form(VALID))).rejects.toThrow('REDIRECT:/confirm');
    expect(mocks.signUpMock).toHaveBeenCalledWith({
      email: VALID.email,
      password: VALID.password,
      options: { emailRedirectTo: 'https://expressia.pt/callback' },
    });
  });

  it('confirmação pendente (user sem session) → redirect /confirm', async () => {
    mocks.signUpMock.mockResolvedValue({ data: { user: { id: 'u1' }, session: null }, error: null });
    await expect(signUpAction({}, form(VALID))).rejects.toThrow('REDIRECT:/confirm');
  });

  it('sessão activa imediata (confirm OFF) → redirect /visao (fallback)', async () => {
    mocks.signUpMock.mockResolvedValue({
      data: { user: { id: 'u1' }, session: { access_token: 't' } },
      error: null,
    });
    await expect(signUpAction({}, form(VALID))).rejects.toThrow('REDIRECT:/visao');
  });

  it('erro do Supabase → devolve mensagem PT-PT, sem redirect', async () => {
    mocks.signUpMock.mockResolvedValue({ data: {}, error: { code: 'weak_password' } });
    const result = await signUpAction({}, form(VALID));
    expect(result.error).toMatch(/palavra-passe/i);
    expect(mocks.redirectMock).not.toHaveBeenCalled();
  });

  it('validação local: palavras-passe não coincidem → erro sem chamar signUp', async () => {
    const result = await signUpAction(
      {},
      form({ ...VALID, password_confirm: 'diferente' }),
    );
    expect(result.error).toMatch(/não coincidem/i);
    expect(mocks.signUpMock).not.toHaveBeenCalled();
  });

  it('fallback de origin: sem header origin usa host + x-forwarded-proto', async () => {
    mocks.headerGetMock.mockImplementation((k: string) => {
      if (k === 'host') return 'expressia.pt';
      if (k === 'x-forwarded-proto') return 'https';
      return null;
    });
    mocks.signUpMock.mockResolvedValue({ data: { user: { id: 'u1' }, session: null }, error: null });
    await expect(signUpAction({}, form(VALID))).rejects.toThrow('REDIRECT:/confirm');
    expect(mocks.signUpMock).toHaveBeenCalledWith(
      expect.objectContaining({
        options: { emailRedirectTo: 'https://expressia.pt/callback' },
      }),
    );
  });
});
