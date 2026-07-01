// @vitest-environment node
/**
 * Testes da tool `enviar_email` (Story J-7 AC7 + AC10).
 *
 * Cobre: preview PT-PT do rascunho; execute compose com mock `fetch` →
 * `sendGmailMessage` chamado com MIME correcto (base64url válido, headers
 * `To`/`Subject`); execute sem token → `ToolExecutionError` PT-PT; execute falha
 * HTTP → `ToolExecutionError` com `cause`; validação Zod (`to` inválido / `body`
 * vazio → erro); `reverse()` → sentinela inerte `_noop`.
 *
 * Mocka `@/lib/google/oauth` (refreshAccessToken) e `global.fetch`.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/google/oauth', () => ({
  refreshAccessToken: vi.fn(),
}));

import type { ToolExecutionContext } from '@meu-jarvis/tools';

import { refreshAccessToken } from '@/lib/google/oauth';

import { enviarEmail } from '@/lib/agent/tools/gmail/send-email';

const HOUSEHOLD_ID = '00000000-0000-0000-0000-0000000000a1';
const USER_ID = '00000000-0000-0000-0000-000000000001';
const TOKEN_ROW = {
  encrypted_refresh_token: 'enc',
  token_iv: 'iv',
  token_auth_tag: 'tag',
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

/** Perfil da conta autenticada (GET /profile). */
const PROFILE_RESPONSE = { emailAddress: 'euricojsalves@gmail.com' };

/**
 * `ToolExecutionError` esconde a mensagem PT-PT no `.cause`. Extrai a mensagem
 * real para os asserts.
 */
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

/** Descodifica o `raw` base64url de um POST /messages/send para o MIME original. */
function decodeRawFromSendCall(body: unknown): string {
  const parsed = JSON.parse(String(body)) as { raw?: string };
  if (typeof parsed.raw !== 'string') {
    throw new Error('POST send sem campo raw');
  }
  return Buffer.from(parsed.raw, 'base64url').toString('utf-8');
}

describe('enviar_email', () => {
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

  it('preview PT-PT mostra o rascunho (Para/Assunto/Corpo) para revisão', () => {
    const text = enviarEmail.preview(
      { to: 'ana@example.com', subject: 'Reunião', body: 'Olá Ana, confirmo.' },
      makeCtx([TOKEN_ROW]),
    );
    expect(text).toContain('Para: ana@example.com');
    expect(text).toContain('Assunto: Reunião');
    expect(text).toContain('Olá Ana, confirmo.');
    expect(text).toMatch(/Confirmas\?/);
  });

  it('preview usa "(sem assunto)" quando subject é omitido', () => {
    const text = enviarEmail.preview(
      { to: 'ana@example.com', body: 'Corpo.' },
      makeCtx([TOKEN_ROW]),
    );
    expect(text).toContain('Assunto: (sem assunto)');
  });

  it('execute compose: resolve perfil, envia MIME correcto (headers To/Subject) e devolve id/threadId', async () => {
    fetchMock
      .mockResolvedValueOnce(fetchResponse(PROFILE_RESPONSE)) // GET /profile
      .mockResolvedValueOnce(fetchResponse({ id: 'msg-1', threadId: 'thr-1' })); // POST /send

    const out = await enviarEmail.execute(
      { to: 'ana@example.com', subject: 'Assunto teste', body: 'Corpo do email.' },
      makeCtx([TOKEN_ROW]),
    );

    expect(out).toEqual({ id: 'msg-1', threadId: 'thr-1', to: 'ana@example.com' });

    // A segunda chamada é o POST /messages/send.
    const [sendUrl, sendInit] = fetchMock.mock.calls[1]!;
    expect(String(sendUrl)).toContain('/gmail/v1/users/me/messages/send');
    expect((sendInit as RequestInit).method).toBe('POST');

    // O MIME (raw base64url) contém os headers To/Subject/From correctos.
    const mime = decodeRawFromSendCall((sendInit as RequestInit).body);
    expect(mime).toContain('To: ana@example.com');
    expect(mime).toContain('Subject: Assunto teste');
    expect(mime).toContain('From: euricojsalves@gmail.com');
    expect(mime).toContain('Content-Type: text/plain; charset="UTF-8"');
    expect(mime).toContain('Corpo do email.');
  });

  it('execute com subject acentuado codifica o header em RFC 2047 (=?UTF-8?B?...?=)', async () => {
    fetchMock
      .mockResolvedValueOnce(fetchResponse(PROFILE_RESPONSE))
      .mockResolvedValueOnce(fetchResponse({ id: 'm', threadId: 't' }));

    await enviarEmail.execute(
      { to: 'ana@example.com', subject: 'Reunião de amanhã', body: 'Corpo.' },
      makeCtx([TOKEN_ROW]),
    );

    const [, sendInit] = fetchMock.mock.calls[1]!;
    const mime = decodeRawFromSendCall((sendInit as RequestInit).body);
    expect(mime).toMatch(/Subject: =\?UTF-8\?B\?[A-Za-z0-9+/=]+\?=/);
  });

  it('sem token OAuth em DB → lança erro PT-PT e NÃO chama a Gmail API', async () => {
    const msg = await causeMessageOf(
      enviarEmail.execute({ to: 'ana@example.com', body: 'Corpo.' }, makeCtx([])),
    );
    expect(msg).toMatch(/Gmail/);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('falha HTTP no envio (500) → lança ToolExecutionError com cause descritiva', async () => {
    fetchMock
      .mockResolvedValueOnce(fetchResponse(PROFILE_RESPONSE))
      .mockResolvedValueOnce(fetchResponse(null, 500));

    const msg = await causeMessageOf(
      enviarEmail.execute({ to: 'ana@example.com', body: 'Corpo.' }, makeCtx([TOKEN_ROW])),
    );
    expect(msg).toMatch(/Gmail/);
    expect(msg).toMatch(/500/);
  });

  it('validação Zod: to inválido é rejeitado pelo inputSchema', () => {
    expect(enviarEmail.inputSchema.safeParse({ to: 'nao-e-email', body: 'x' }).success).toBe(false);
  });

  it('validação Zod: body vazio é rejeitado pelo inputSchema', () => {
    expect(enviarEmail.inputSchema.safeParse({ to: 'ana@example.com', body: '' }).success).toBe(
      false,
    );
  });

  it('validação Zod: to ausente é rejeitado (compose-only — to sempre obrigatório)', () => {
    expect(enviarEmail.inputSchema.safeParse({ body: 'x' }).success).toBe(false);
  });

  it('reverse() devolve sentinela inerte _noop (R1b v1.1) — envio irreversível', async () => {
    const op = await enviarEmail.reverse(
      { id: 'm', threadId: 't', to: 'ana@example.com' },
      makeCtx([TOKEN_ROW]),
    );
    expect(op).toMatchObject({ kind: 'delete_row', table: '_noop' });
    expect((op as { id: string }).id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
    );
  });
});
