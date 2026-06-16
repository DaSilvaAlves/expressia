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

describe('signUpAction (Story 6.1 AC2)', () => {
  beforeEach(() => {
    mocks.signUpMock.mockReset();
    mocks.redirectMock.mockClear();
    mocks.headerGetMock.mockReset();
    mocks.headerGetMock.mockImplementation((k: string) =>
      k === 'origin' ? 'https://expressia.pt' : null,
    );
    // SEC-9 PO-FIX-1: forçar o ramo B (fallback por headers) por defeito — não
    // confiar no ambiente. Se `SITE_URL` estiver definida no ambiente de
    // execução (CI futura, .env.test), o ramo A activava-se e os testes de
    // fallback falhavam. String vazia cai no fallback (verificação truthy).
    vi.stubEnv('SITE_URL', '');
  });

  // SEC-9 PO-FIX-1: restaurar env vars stubadas entre testes para isolar o
  // ramo A (que faz `vi.stubEnv('SITE_URL', ...)` localmente).
  afterEach(() => {
    vi.unstubAllEnvs();
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

  // SEC-9 ramo A: `SITE_URL` definida → emailRedirectTo usa exactamente esse
  // valor, sem derivar de nenhum header (mesmo que o header `origin` aponte para
  // um domínio hostil — header poisoning fica neutralizado).
  it('SEC-9: SITE_URL definida → emailRedirectTo usa a env var, ignora headers', async () => {
    vi.stubEnv('SITE_URL', 'https://expressia.pt');
    mocks.headerGetMock.mockReset();
    mocks.headerGetMock.mockImplementation((k: string) =>
      k === 'origin' ? 'https://atacante.com' : null,
    );
    mocks.signUpMock.mockResolvedValue({ data: { user: { id: 'u1' }, session: null }, error: null });
    await expect(signUpAction({}, form(VALID))).rejects.toThrow('REDIRECT:/confirm');
    expect(mocks.signUpMock).toHaveBeenCalledWith(
      expect.objectContaining({
        options: { data: { name: 'João' }, emailRedirectTo: 'https://expressia.pt/callback' },
      }),
    );
    // O header envenenado NUNCA é consultado quando SITE_URL existe.
    expect(mocks.headerGetMock).not.toHaveBeenCalled();
  });

  // SEC-9 SEC-001 (robustez de config): `SITE_URL` com barra final é normalizada
  // — o resultado contém exactamente `https://expressia.pt/callback` (uma só
  // barra), nunca `//callback`. Erro de config provável ao colar o URL na Vercel.
  it('SEC-001: SITE_URL com barra final → emailRedirectTo sem barra dupla', async () => {
    vi.stubEnv('SITE_URL', 'https://expressia.pt/');
    mocks.signUpMock.mockResolvedValue({ data: { user: { id: 'u1' }, session: null }, error: null });
    await expect(signUpAction({}, form(VALID))).rejects.toThrow('REDIRECT:/confirm');
    expect(mocks.signUpMock).toHaveBeenCalledWith(
      expect.objectContaining({
        options: { data: { name: 'João' }, emailRedirectTo: 'https://expressia.pt/callback' },
      }),
    );
  });
});

describe('resetPasswordAction (Soft-launch A2)', () => {
  beforeEach(() => {
    mocks.resetPasswordForEmailMock.mockReset();
    mocks.redirectMock.mockClear();
    mocks.headerGetMock.mockReset();
    mocks.headerGetMock.mockImplementation((k: string) =>
      k === 'origin' ? 'https://expressia.pt' : null,
    );
    // SEC-9 PO-FIX-1: forçar o ramo B por defeito (ver nota no describe acima).
    vi.stubEnv('SITE_URL', '');
  });

  afterEach(() => {
    vi.unstubAllEnvs();
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

  // SEC-9 ramo A: `SITE_URL` definida → redirectTo usa exactamente a env var.
  it('SEC-9: SITE_URL definida → redirectTo usa a env var, ignora headers', async () => {
    vi.stubEnv('SITE_URL', 'https://expressia.pt');
    mocks.headerGetMock.mockReset();
    mocks.headerGetMock.mockImplementation((k: string) =>
      k === 'origin' ? 'https://atacante.com' : null,
    );
    mocks.resetPasswordForEmailMock.mockResolvedValue({ error: null });
    const result = await resetPasswordAction({}, form({ email: 'quem@expressia.pt' }));
    expect(result.error).toBeUndefined();
    expect(mocks.resetPasswordForEmailMock).toHaveBeenCalledWith('quem@expressia.pt', {
      redirectTo:
        'https://expressia.pt/callback?next=%2Frecuperar%2Fnova-palavra-passe',
    });
    expect(mocks.headerGetMock).not.toHaveBeenCalled();
  });
});
