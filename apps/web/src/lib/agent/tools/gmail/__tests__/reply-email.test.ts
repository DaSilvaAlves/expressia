// @vitest-environment node
/**
 * Testes da tool `responder_email` (Story J-8 AC7 + AC14).
 *
 * Cobre: preview PT-PT do rascunho de resposta (assunto `Re: `); execute com mock
 * `fetch` → `sendGmailMessage` chamado com `threadId` + cabeçalhos
 * `In-Reply-To`/`References` correctos; execute sem token → `ToolExecutionError`
 * PT-PT; execute falha HTTP → `ToolExecutionError` com `cause`; validação Zod
 * (`threadId`/`messageId`/`to`/`body` ausentes ou inválidos → erro); `reverse()`
 * → sentinela inerte `_noop`.
 *
 * Mocka `@/lib/google/oauth` (refreshAccessToken) e `global.fetch`.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/google/oauth', () => ({
  refreshAccessToken: vi.fn(),
}));

import type { ToolExecutionContext } from '@meu-jarvis/tools';

import { refreshAccessToken } from '@/lib/google/oauth';

import { responderEmail } from '@/lib/agent/tools/gmail/reply-email';

const HOUSEHOLD_ID = '00000000-0000-0000-0000-0000000000a1';
const USER_ID = '00000000-0000-0000-0000-000000000001';
const TOKEN_ROW = {
  encrypted_refresh_token: 'enc',
  token_iv: 'iv',
  token_auth_tag: 'tag',
};
const MESSAGE_ID = '<orig-123@mail.gmail.com>';

/** Input válido de resposta (threadId/messageId já resolvidos pela AC5). */
const VALID_INPUT = {
  threadId: 'thr-abc',
  messageId: MESSAGE_ID,
  to: 'pedro@example.com',
  subject: 'Jantar de sábado',
  body: 'Confirmo que vou.',
};

function makeCtx(tokenRows: unknown[]): ToolExecutionContext {
  return {
    householdId: HOUSEHOLD_ID,
    userId: USER_ID,
    db: {
      execute: vi.fn().mockResolvedValue(tokenRows),
      insert: vi.fn(),
      transaction: vi.fn(),
    },
    traceId: 'trace-1',
    runId: 'run-1',
  } as unknown as ToolExecutionContext;
}

function fetchResponse(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as unknown as Response;
}

const PROFILE_RESPONSE = { emailAddress: 'euricojsalves@gmail.com' };

/** `ToolExecutionError` esconde a mensagem PT-PT no `.cause`. */
async function causeMessageOf(promise: Promise<unknown>): Promise<string> {
  try {
    await promise;
  } catch (err) {
    const cause = (err as { cause?: unknown }).cause;
    if (cause instanceof Error) {
      return cause.message;
    }
    return err instanceof Error ? err.message : String(err);
  }
  throw new Error('esperava que a promessa rejeitasse, mas resolveu');
}

function decodeRawFromSendCall(body: unknown): string {
  const parsed = JSON.parse(String(body)) as { raw?: string };
  if (typeof parsed.raw !== 'string') {
    throw new Error('POST send sem campo raw');
  }
  return Buffer.from(parsed.raw, 'base64url').toString('utf-8');
}

describe('responder_email', () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    vi.stubGlobal('fetch', fetchMock);
    fetchMock.mockReset();
    vi.mocked(refreshAccessToken).mockResolvedValue({
      accessToken: 'mock-access-token',
      expiry: new Date(),
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  it('preview PT-PT mostra o rascunho da resposta com assunto Re:', () => {
    const text = responderEmail.preview(VALID_INPUT, makeCtx([TOKEN_ROW]));
    expect(text).toContain('Vou responder a este email');
    expect(text).toContain('Para: pedro@example.com');
    expect(text).toContain('Assunto: Re: Jantar de sábado');
    expect(text).toContain('Confirmo que vou.');
    expect(text).toMatch(/Confirmas\?/);
  });

  it('preview NÃO duplica o Re: quando o assunto já começa por Re:', () => {
    const text = responderEmail.preview(
      { ...VALID_INPUT, subject: 'Re: Jantar de sábado' },
      makeCtx([TOKEN_ROW]),
    );
    expect(text).toContain('Assunto: Re: Jantar de sábado');
    expect(text).not.toContain('Re: Re:');
  });

  it('execute responde na thread: threadId no POST + In-Reply-To/References com o Message-ID', async () => {
    fetchMock
      .mockResolvedValueOnce(fetchResponse(PROFILE_RESPONSE)) // GET /profile
      .mockResolvedValueOnce(fetchResponse({ id: 'msg-r', threadId: 'thr-abc' })); // POST /send

    const out = await responderEmail.execute(VALID_INPUT, makeCtx([TOKEN_ROW]));
    expect(out).toEqual({ id: 'msg-r', threadId: 'thr-abc', to: 'pedro@example.com' });

    const [sendUrl, sendInit] = fetchMock.mock.calls[1]!;
    expect(String(sendUrl)).toContain('/gmail/v1/users/me/messages/send');
    const parsedBody = JSON.parse(String((sendInit as RequestInit).body)) as {
      raw: string;
      threadId?: string;
    };
    // threadId reforçado no corpo do POST.
    expect(parsedBody.threadId).toBe('thr-abc');
    // Cabeçalhos de threading apontam para o Message-ID do original.
    const mime = decodeRawFromSendCall((sendInit as RequestInit).body);
    expect(mime).toContain(`In-Reply-To: ${MESSAGE_ID}`);
    expect(mime).toContain(`References: ${MESSAGE_ID}`);
    expect(mime).toContain('To: pedro@example.com');
  });

  it('sem token OAuth em DB → lança erro PT-PT e NÃO chama a Gmail API', async () => {
    const msg = await causeMessageOf(responderEmail.execute(VALID_INPUT, makeCtx([])));
    expect(msg).toMatch(/Gmail/);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('falha HTTP no envio (500) → lança ToolExecutionError com cause descritiva', async () => {
    fetchMock
      .mockResolvedValueOnce(fetchResponse(PROFILE_RESPONSE))
      .mockResolvedValueOnce(fetchResponse(null, 500));

    const msg = await causeMessageOf(responderEmail.execute(VALID_INPUT, makeCtx([TOKEN_ROW])));
    expect(msg).toMatch(/Gmail/);
    expect(msg).toMatch(/500/);
  });

  it('validação Zod: threadId ausente é rejeitado', () => {
    const { threadId: _omit, ...noThread } = VALID_INPUT;
    expect(responderEmail.inputSchema.safeParse(noThread).success).toBe(false);
  });

  it('validação Zod: messageId ausente é rejeitado', () => {
    const { messageId: _omit, ...noMsg } = VALID_INPUT;
    expect(responderEmail.inputSchema.safeParse(noMsg).success).toBe(false);
  });

  it('validação Zod: to com "Nome <email>" é rejeitado (tem de ser endereço nu)', () => {
    expect(
      responderEmail.inputSchema.safeParse({ ...VALID_INPUT, to: 'Pedro <pedro@example.com>' })
        .success,
    ).toBe(false);
  });

  it('validação Zod: body vazio é rejeitado', () => {
    expect(responderEmail.inputSchema.safeParse({ ...VALID_INPUT, body: '' }).success).toBe(false);
  });

  it('reverse() devolve sentinela inerte _noop (R1b v1.1) — envio irreversível', async () => {
    const op = await responderEmail.reverse(
      { id: 'm', threadId: 't', to: 'pedro@example.com' },
      makeCtx([TOKEN_ROW]),
    );
    expect(op).toMatchObject({ kind: 'delete_row', table: '_noop' });
    expect((op as { id: string }).id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
    );
  });
});
