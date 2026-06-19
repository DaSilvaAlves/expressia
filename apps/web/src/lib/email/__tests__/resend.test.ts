/**
 * Testes unitários do helper `sendInviteEmail` — Story INVITE-EMAIL AC10.
 *
 * Cenários obrigatórios:
 *   (a) sucesso com Resend mockado → `{ ok: true }`;
 *   (b) Resend lança excepção → `{ ok: false, reason }` (sem re-throw);
 *   (c) `RESEND_API_KEY` ausente → `{ ok: false, reason: 'missing-api-key' }`
 *       sem instanciar/chamar Resend.
 * Mais: smoke de copy PT-PT (assunto + corpo) e tratamento do `error` de negócio.
 *
 * `vi.mock('resend')` substitui o SDK; o construtor `Resend` é uma `vi.fn` que
 * devolve um objecto com `emails.send`. `RESEND_API_KEY` é lida em runtime pelo
 * helper, por isso usamos `vi.stubEnv`/`vi.unstubAllEnvs` para controlar a env.
 */

// `vi.hoisted` garante que estas refs existem quando a factory de `vi.mock`
// (içada para o topo do ficheiro) é avaliada — evita o "Cannot access before
// initialization" que ocorre com `const` normais referenciados na factory.
const { mockSend, ResendCtor } = vi.hoisted(() => {
  const send = vi.fn();
  return { mockSend: send, ResendCtor: vi.fn(() => ({ emails: { send } })) };
});

vi.mock('resend', () => ({
  Resend: ResendCtor,
}));

import { sendInviteEmail } from '@/lib/email/resend';

const VALID_PARAMS = {
  to: 'convidado@expressia.pt',
  inviteUrl: 'https://expressia.pt/aceitar-convite/abc123',
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv('RESEND_API_KEY', 're_test_key');
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('sendInviteEmail', () => {
  it('(a) devolve { ok: true } no path de sucesso com Resend mockado', async () => {
    mockSend.mockResolvedValueOnce({ data: { id: 'email-1' }, error: null });

    const result = await sendInviteEmail(VALID_PARAMS);

    expect(result).toEqual({ ok: true });
    expect(ResendCtor).toHaveBeenCalledWith('re_test_key');
    expect(mockSend).toHaveBeenCalledTimes(1);
  });

  it('(b) devolve { ok: false, reason } quando Resend lança (sem re-throw)', async () => {
    mockSend.mockRejectedValueOnce(new Error('rede indisponível'));

    const result = await sendInviteEmail(VALID_PARAMS);

    expect(result.ok).toBe(false);
    expect(result.reason).toContain('rede indisponível');
  });

  it('(c) devolve { ok: false, reason: "missing-api-key" } sem chamar Resend quando a chave está ausente', async () => {
    vi.stubEnv('RESEND_API_KEY', '');

    const result = await sendInviteEmail(VALID_PARAMS);

    expect(result).toEqual({ ok: false, reason: 'missing-api-key' });
    expect(ResendCtor).not.toHaveBeenCalled();
    expect(mockSend).not.toHaveBeenCalled();
  });

  it('devolve { ok: false } quando a API Resend responde com erro de negócio (best-effort)', async () => {
    mockSend.mockResolvedValueOnce({
      data: null,
      error: { message: 'domínio não verificado', statusCode: 403, name: 'invalid_from_address' },
    });

    const result = await sendInviteEmail(VALID_PARAMS);

    expect(result.ok).toBe(false);
    expect(result.reason).toBe('domínio não verificado');
  });

  it('nunca lança — qualquer erro inesperado é capturado e devolvido como falha', async () => {
    mockSend.mockImplementationOnce(() => {
      throw 'erro não-Error';
    });

    await expect(sendInviteEmail(VALID_PARAMS)).resolves.toMatchObject({ ok: false });
  });

  it('envia com remetente, assunto e corpo PT-PT (smoke de copy)', async () => {
    mockSend.mockResolvedValueOnce({ data: { id: 'email-2' }, error: null });

    await sendInviteEmail(VALID_PARAMS);

    const payload = mockSend.mock.calls[0]?.[0] as {
      from: string;
      to: string;
      subject: string;
      text: string;
      html: string;
    };

    expect(payload.from).toBe('Expressia <convites@euricoalves.pt>');
    expect(payload.to).toBe(VALID_PARAMS.to);
    expect(payload.subject).toBe('Foste convidado para uma família no Expressia');
    // Copy PT-PT europeu — "foste/podes/equipa", nunca "você/pode/time".
    expect(payload.text).toContain('Foste convidado');
    expect(payload.text).toContain('podes ignorá-lo');
    expect(payload.text).toContain('A equipa Expressia');
    expect(payload.text).toContain(VALID_PARAMS.inviteUrl);
    expect(payload.html).toContain(VALID_PARAMS.inviteUrl);
  });
});
