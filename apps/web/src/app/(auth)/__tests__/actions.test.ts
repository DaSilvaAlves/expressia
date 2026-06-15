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
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  signUpMock: vi.fn(),
  resetPasswordForEmailMock: vi.fn(),
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
  createServerSupabaseClient: vi.fn(async () => ({
    auth: {
      signUp: mocks.signUpMock,
      resetPasswordForEmail: mocks.resetPasswordForEmailMock,
    },
  })),
}));

const { signUpAction, resetPasswordAction } = await import('@/app/(auth)/actions');

function form(fields: Record<string, string>): FormData {
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields)) fd.set(k, v);
  return fd;
}

const VALID = {
  name: 'João',
  email: 'novo@expressia.pt',
  password: 'segredo123',
  password_confirm: 'segredo123',
};

// `getRequestOrigin` lê `process.env.SITE_URL` — limpamos sempre para isolar o
// path por-headers (default) do path canónico por env var. Sem isto, um valor
// herdado do ambiente do runner contaminaria os testes existentes.
afterEach(() => {
  delete process.env.SITE_URL;
});

describe('signUpAction (Story 6.1 AC2)', () => {
  beforeEach(() => {
    delete process.env.SITE_URL;
    mocks.signUpMock.mockReset();
    mocks.redirectMock.mockClear();
    mocks.headerGetMock.mockReset();
    mocks.headerGetMock.mockImplementation((k: string) =>
      k === 'origin' ? 'https://expressia.pt' : null,
    );
  });

  it('SITE_URL definida tem precedência sobre headers (anti host-header poisoning)', async () => {
    process.env.SITE_URL = 'https://expressia.pt';
    // Header `origin` forjado para um sub-domínio *.vercel.app controlado pelo
    // atacante — tem de ser IGNORADO quando SITE_URL está definida.
    mocks.headerGetMock.mockImplementation((k: string) =>
      k === 'origin' ? 'https://atacante.vercel.app' : null,
    );
    mocks.signUpMock.mockResolvedValue({ data: { user: { id: 'u1' }, session: null }, error: null });
    await expect(signUpAction({}, form(VALID))).rejects.toThrow('REDIRECT:/confirm');
    expect(mocks.signUpMock).toHaveBeenCalledWith(
      expect.objectContaining({
        options: expect.objectContaining({ emailRedirectTo: 'https://expressia.pt/callback' }),
      }),
    );
  });

  it('passa emailRedirectTo a apontar para /callback (origin derivado dos headers)', async () => {
    mocks.signUpMock.mockResolvedValue({ data: { user: { id: 'u1' }, session: null }, error: null });
    await expect(signUpAction({}, form(VALID))).rejects.toThrow('REDIRECT:/confirm');
    expect(mocks.signUpMock).toHaveBeenCalledWith({
      email: VALID.email,
      password: VALID.password,
      options: { data: { name: 'João' }, emailRedirectTo: 'https://expressia.pt/callback' },
    });
  });

  it('passa o nome em options.data (alimenta user_metadata.name + display_name)', async () => {
    mocks.signUpMock.mockResolvedValue({ data: { user: { id: 'u1' }, session: null }, error: null });
    await expect(
      signUpAction({}, form({ ...VALID, name: '  Maria Silva  ' })),
    ).rejects.toThrow('REDIRECT:/confirm');
    expect(mocks.signUpMock).toHaveBeenCalledWith(
      expect.objectContaining({ options: expect.objectContaining({ data: { name: 'Maria Silva' } }) }),
    );
  });

  it('validação local: nome em falta → erro sem chamar signUp', async () => {
    const result = await signUpAction({}, form({ ...VALID, name: '   ' }));
    expect(result.error).toMatch(/nome/i);
    expect(mocks.signUpMock).not.toHaveBeenCalled();
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
        options: { data: { name: 'João' }, emailRedirectTo: 'https://expressia.pt/callback' },
      }),
    );
  });

  it('SITE_URL só com whitespace é tratada como ausente → cai para os headers', async () => {
    process.env.SITE_URL = '   ';
    mocks.signUpMock.mockResolvedValue({ data: { user: { id: 'u1' }, session: null }, error: null });
    await expect(signUpAction({}, form(VALID))).rejects.toThrow('REDIRECT:/confirm');
    expect(mocks.signUpMock).toHaveBeenCalledWith(
      expect.objectContaining({
        options: expect.objectContaining({ emailRedirectTo: 'https://expressia.pt/callback' }),
      }),
    );
  });

  it('SITE_URL ignora também header `host` forjado (não só `origin`)', async () => {
    process.env.SITE_URL = 'https://expressia.pt';
    mocks.headerGetMock.mockImplementation((k: string) => {
      if (k === 'host') return 'atacante.vercel.app';
      if (k === 'x-forwarded-proto') return 'https';
      return null; // sem header `origin` — o atacante só controla o host
    });
    mocks.signUpMock.mockResolvedValue({ data: { user: { id: 'u1' }, session: null }, error: null });
    await expect(signUpAction({}, form(VALID))).rejects.toThrow('REDIRECT:/confirm');
    expect(mocks.signUpMock).toHaveBeenCalledWith(
      expect.objectContaining({
        options: expect.objectContaining({ emailRedirectTo: 'https://expressia.pt/callback' }),
      }),
    );
  });
});

describe('resetPasswordAction (Soft-launch A2)', () => {
  beforeEach(() => {
    delete process.env.SITE_URL;
    mocks.resetPasswordForEmailMock.mockReset();
    mocks.redirectMock.mockClear();
    mocks.headerGetMock.mockReset();
    mocks.headerGetMock.mockImplementation((k: string) =>
      k === 'origin' ? 'https://expressia.pt' : null,
    );
  });

  it('SITE_URL definida tem precedência sobre headers (anti host-header poisoning)', async () => {
    // SITE_URL com barra final — o origin canónico tem de ser normalizado.
    process.env.SITE_URL = 'https://expressia.pt/';
    mocks.headerGetMock.mockImplementation((k: string) =>
      k === 'origin' ? 'https://atacante.vercel.app' : null,
    );
    mocks.resetPasswordForEmailMock.mockResolvedValue({ error: null });
    await resetPasswordAction({}, form({ email: 'quem@expressia.pt' }));
    expect(mocks.resetPasswordForEmailMock).toHaveBeenCalledWith('quem@expressia.pt', {
      redirectTo:
        'https://expressia.pt/callback?next=%2Frecuperar%2Fnova-palavra-passe',
    });
  });

  it('passa redirectTo a apontar para /callback com next=/recuperar/nova-palavra-passe', async () => {
    mocks.resetPasswordForEmailMock.mockResolvedValue({ error: null });
    const result = await resetPasswordAction({}, form({ email: 'quem@expressia.pt' }));
    expect(result.error).toBeUndefined();
    expect(mocks.resetPasswordForEmailMock).toHaveBeenCalledWith('quem@expressia.pt', {
      redirectTo:
        'https://expressia.pt/callback?next=%2Frecuperar%2Fnova-palavra-passe',
    });
  });

  it('email em falta → erro PT-PT sem chamar Supabase', async () => {
    const result = await resetPasswordAction({}, form({ email: '   ' }));
    expect(result.error).toMatch(/email/i);
    expect(mocks.resetPasswordForEmailMock).not.toHaveBeenCalled();
  });

  it('erro do Supabase → mensagem neutra (anti-enumeration)', async () => {
    mocks.resetPasswordForEmailMock.mockResolvedValue({ error: { message: 'rate limit' } });
    const result = await resetPasswordAction({}, form({ email: 'quem@expressia.pt' }));
    expect(result.error).toMatch(/não foi possível/i);
  });

  it('fallback de origin: sem header origin usa host + x-forwarded-proto', async () => {
    mocks.headerGetMock.mockImplementation((k: string) => {
      if (k === 'host') return 'expressia.pt';
      if (k === 'x-forwarded-proto') return 'https';
      return null;
    });
    mocks.resetPasswordForEmailMock.mockResolvedValue({ error: null });
    await resetPasswordAction({}, form({ email: 'quem@expressia.pt' }));
    expect(mocks.resetPasswordForEmailMock).toHaveBeenCalledWith('quem@expressia.pt', {
      redirectTo:
        'https://expressia.pt/callback?next=%2Frecuperar%2Fnova-palavra-passe',
    });
  });
});
