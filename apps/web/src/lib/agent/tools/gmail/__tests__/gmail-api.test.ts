// @vitest-environment node
/**
 * Testes dos helpers de envio do `gmail-api.ts` (Story J-7 AC6 + AC10) —
 * compose-only (reply em v2).
 *
 * Cobre: `buildRawMimeMessage` produz base64url sem padding com headers
 * correctos; `isGmailSendResponse` type guard; `sendGmailMessage` resolve o
 * perfil e faz `POST .../messages/send` com o MIME no campo `raw`.
 *
 * Mocka `global.fetch`. Não toca em `@/lib/google/oauth` (as funções testadas
 * recebem o `accessToken` já resolvido).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  buildRawMimeMessage,
  isGmailSendResponse,
  sendGmailMessage,
} from '@/lib/agent/tools/gmail/gmail-api';

function fetchResponse(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as unknown as Response;
}

describe('buildRawMimeMessage', () => {
  it('produz base64url SEM padding (RFC 4648 §5)', () => {
    const raw = buildRawMimeMessage({
      to: 'ana@example.com',
      from: 'eu@example.com',
      subject: 'Assunto',
      body: 'Corpo do email.',
    });
    // base64url usa - e _ em vez de + e /, e não tem padding '='.
    expect(raw).not.toContain('=');
    expect(raw).not.toContain('+');
    expect(raw).not.toContain('/');
    expect(raw).toMatch(/^[A-Za-z0-9_-]+$/);
  });

  it('inclui os headers RFC 2822 (To/From/Subject/Content-Type/MIME-Version) e o corpo', () => {
    const raw = buildRawMimeMessage({
      to: 'ana@example.com',
      from: 'eu@example.com',
      subject: 'Assunto',
      body: 'Linha 1\nLinha 2',
    });
    const mime = Buffer.from(raw, 'base64url').toString('utf-8');
    expect(mime).toContain('To: ana@example.com');
    expect(mime).toContain('From: eu@example.com');
    expect(mime).toContain('Subject: Assunto');
    expect(mime).toContain('Content-Type: text/plain; charset="UTF-8"');
    expect(mime).toContain('MIME-Version: 1.0');
    // Cabeçalhos separados do corpo por linha em branco (CRLF CRLF).
    expect(mime).toContain('\r\n\r\n');
    // Corpo normalizado para CRLF.
    expect(mime).toContain('Linha 1\r\nLinha 2');
  });

  it('codifica Subject com acentos em RFC 2047 encoded-word', () => {
    const raw = buildRawMimeMessage({
      to: 'ana@example.com',
      from: 'eu@example.com',
      subject: 'Reunião amanhã',
      body: 'x',
    });
    const mime = Buffer.from(raw, 'base64url').toString('utf-8');
    expect(mime).toMatch(/Subject: =\?UTF-8\?B\?[A-Za-z0-9+/=]+\?=/);
    // O encoded-word descodifica para o assunto original.
    const encoded = mime.match(/Subject: =\?UTF-8\?B\?([A-Za-z0-9+/=]+)\?=/)?.[1] ?? '';
    expect(Buffer.from(encoded, 'base64').toString('utf-8')).toBe('Reunião amanhã');
  });

  it('NÃO inclui cabeçalhos de reply (compose-only — In-Reply-To/References em v2)', () => {
    const raw = buildRawMimeMessage({
      to: 'ana@example.com',
      from: 'eu@example.com',
      subject: 'Assunto',
      body: 'x',
    });
    const mime = Buffer.from(raw, 'base64url').toString('utf-8');
    expect(mime).not.toContain('In-Reply-To');
    expect(mime).not.toContain('References');
  });
});

describe('isGmailSendResponse', () => {
  it('true para { id, threadId } com strings não-vazias', () => {
    expect(isGmailSendResponse({ id: 'm', threadId: 't' })).toBe(true);
  });

  it('false para valores inválidos', () => {
    expect(isGmailSendResponse(null)).toBe(false);
    expect(isGmailSendResponse({})).toBe(false);
    expect(isGmailSendResponse({ id: 'm' })).toBe(false);
    expect(isGmailSendResponse({ id: '', threadId: 't' })).toBe(false);
    expect(isGmailSendResponse({ id: 1, threadId: 't' })).toBe(false);
  });
});

describe('sendGmailMessage', () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    vi.stubGlobal('fetch', fetchMock);
    fetchMock.mockReset();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('resolve o perfil (GET /profile) e faz POST /messages/send com o MIME no raw', async () => {
    fetchMock
      .mockResolvedValueOnce(fetchResponse({ emailAddress: 'eu@example.com' }))
      .mockResolvedValueOnce(fetchResponse({ id: 'msg-9', threadId: 'thr-9' }));

    const out = await sendGmailMessage('tok', {
      to: 'ana@example.com',
      subject: 'Oi',
      body: 'Olá',
    });

    expect(out).toEqual({ id: 'msg-9', threadId: 'thr-9' });

    // Primeira chamada: GET /profile com Bearer.
    const [profileUrl, profileInit] = fetchMock.mock.calls[0]!;
    expect(String(profileUrl)).toContain('/gmail/v1/users/me/profile');
    expect((profileInit as RequestInit).headers).toMatchObject({ Authorization: 'Bearer tok' });

    // Segunda chamada: POST /messages/send com { raw }.
    const [sendUrl, sendInit] = fetchMock.mock.calls[1]!;
    expect(String(sendUrl)).toContain('/gmail/v1/users/me/messages/send');
    expect((sendInit as RequestInit).method).toBe('POST');
    const parsed = JSON.parse(String((sendInit as RequestInit).body)) as { raw?: string };
    expect(typeof parsed.raw).toBe('string');
    const mime = Buffer.from(parsed.raw as string, 'base64url').toString('utf-8');
    expect(mime).toContain('To: ana@example.com');
    expect(mime).toContain('From: eu@example.com');
  });

  it('falha HTTP no envio → lança (ToolExecutionError com cause)', async () => {
    fetchMock
      .mockResolvedValueOnce(fetchResponse({ emailAddress: 'eu@example.com' }))
      .mockResolvedValueOnce(fetchResponse(null, 403));

    await expect(
      sendGmailMessage('tok', { to: 'ana@example.com', subject: 'x', body: 'y' }),
    ).rejects.toThrow();
  });

  it('resposta de envio sem id/threadId → lança', async () => {
    fetchMock
      .mockResolvedValueOnce(fetchResponse({ emailAddress: 'eu@example.com' }))
      .mockResolvedValueOnce(fetchResponse({ unexpected: true }));

    await expect(
      sendGmailMessage('tok', { to: 'ana@example.com', subject: 'x', body: 'y' }),
    ).rejects.toThrow();
  });
});
