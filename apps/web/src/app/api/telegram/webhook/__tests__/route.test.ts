// @vitest-environment node
/**
 * Testes do webhook do Telegram (Story J-1 — echo seguro).
 *
 * Cobrem:
 *   - AC2: secret token ausente/incorrecto → 401 sem processar o body.
 *   - AC3: chat_id fora da allowlist → 200 silencioso, sem sendMessage.
 *   - AC4: mensagem de texto do Eurico → sendMessage("Echo: ...") + 200.
 *   - AC7: falha de sendMessage → 500 sem expor detalhes.
 *   - SHOULD-FIX-2: corpo JSON inválido com secret correcto → 400 controlado,
 *     sem 500/stack trace e sem processar o update.
 *
 * Isolamento de env vars com `vi.stubEnv` / `vi.unstubAllEnvs()` em `afterEach`
 * — padrão SEC-9 (`apps/web/src/app/(auth)/__tests__/actions.test.ts`).
 * O `fetch` da Bot API é mockado globalmente (`sendMessage` usa fetch nativo).
 *
 * O fixture usa `chat.id` NUMÉRICO (não string) para exercer a coerção
 * numérica→string da allowlist a sério (NICE).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { POST } from '@/app/api/telegram/webhook/route';

const SECRET = 'segredo-webhook-de-teste-1234567890';
const ALLOWED_CHAT_ID = '999000111'; // env var é sempre string
const ALLOWED_CHAT_ID_NUM = 999000111; // chat.id chega como número no JSON

const fetchMock = vi.fn();

/** Constrói um Request POST para o webhook com cabeçalhos e corpo dados. */
function makeRequest(options: {
  secret?: string | null;
  body?: unknown;
  rawBody?: string;
}): Request {
  const headers = new Headers({ 'content-type': 'application/json' });
  if (options.secret !== null && options.secret !== undefined) {
    headers.set('x-telegram-bot-api-secret-token', options.secret);
  }
  const body =
    options.rawBody !== undefined
      ? options.rawBody
      : JSON.stringify(options.body ?? {});
  return new Request('https://expressia.pt/api/telegram/webhook', {
    method: 'POST',
    headers,
    body,
  });
}

/** Update válido de texto vindo do Eurico (chat.id numérico). */
function textUpdate(text: string) {
  return {
    update_id: 42,
    message: {
      message_id: 7,
      date: 1_700_000_000,
      chat: { id: ALLOWED_CHAT_ID_NUM, type: 'private' },
      text,
    },
  };
}

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal('fetch', fetchMock);
  vi.stubEnv('TELEGRAM_BOT_TOKEN', '12345:fake-bot-token');
  vi.stubEnv('TELEGRAM_WEBHOOK_SECRET', SECRET);
  vi.stubEnv('TELEGRAM_ALLOWED_CHAT_ID', ALLOWED_CHAT_ID);
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('POST /api/telegram/webhook — secret token (AC2)', () => {
  it('rejeita com 401 quando o cabeçalho do secret está ausente', async () => {
    const res = await POST(
      makeRequest({ secret: null, body: textUpdate('olá') }) as never,
    );
    expect(res.status).toBe(401);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('rejeita com 401 quando o secret está incorrecto', async () => {
    const res = await POST(
      makeRequest({ secret: 'errado', body: textUpdate('olá') }) as never,
    );
    expect(res.status).toBe(401);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('rejeita com 401 quando TELEGRAM_WEBHOOK_SECRET não está definido', async () => {
    vi.stubEnv('TELEGRAM_WEBHOOK_SECRET', '');
    const res = await POST(
      makeRequest({ secret: SECRET, body: textUpdate('olá') }) as never,
    );
    expect(res.status).toBe(401);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe('POST /api/telegram/webhook — corpo malformado (SHOULD-FIX-2)', () => {
  it('com secret correcto mas JSON inválido devolve 400 controlado (sem 500, sem processar)', async () => {
    const res = await POST(
      makeRequest({ secret: SECRET, rawBody: '{ isto não é json' }) as never,
    );
    expect(res.status).toBe(400);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('com secret correcto mas update com forma inesperada devolve 400', async () => {
    const res = await POST(
      makeRequest({ secret: SECRET, body: { foo: 'bar' } }) as never,
    );
    expect(res.status).toBe(400);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe('POST /api/telegram/webhook — allowlist do chat_id (AC3)', () => {
  it('ignora silenciosamente (200, sem sendMessage) chat_id fora da allowlist', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const update = textUpdate('intruso');
    update.message.chat.id = 555; // chat_id diferente do permitido

    const res = await POST(makeRequest({ secret: SECRET, body: update }) as never);

    expect(res.status).toBe(200);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(warnSpy).toHaveBeenCalled();
  });
});

describe('POST /api/telegram/webhook — echo (AC4)', () => {
  it('responde com "Echo: {texto}" via sendMessage e devolve 200', async () => {
    fetchMock.mockResolvedValue(new Response(null, { status: 200 }));

    const res = await POST(
      makeRequest({ secret: SECRET, body: textUpdate('bom dia') }) as never,
    );

    expect(res.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toContain('/sendMessage');
    expect(init.method).toBe('POST');
    const sent = JSON.parse(init.body as string) as {
      chat_id: number;
      text: string;
    };
    expect(sent.chat_id).toBe(ALLOWED_CHAT_ID_NUM);
    expect(sent.text).toBe('Echo: bom dia');
  });

  it('ignora graciosamente (200) updates sem texto sem chamar sendMessage', async () => {
    const update = {
      update_id: 99,
      callback_query: {
        id: 'cb1',
        data: 'algo',
        message: {
          message_id: 8,
          date: 1_700_000_000,
          chat: { id: ALLOWED_CHAT_ID_NUM, type: 'private' },
        },
      },
    };
    const res = await POST(makeRequest({ secret: SECRET, body: update }) as never);
    expect(res.status).toBe(200);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe('POST /api/telegram/webhook — falha de envio (AC7)', () => {
  it('devolve 500 quando a Bot API responde não-2xx, sem expor detalhes', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    fetchMock.mockResolvedValue(new Response(null, { status: 500 }));

    const res = await POST(
      makeRequest({ secret: SECRET, body: textUpdate('falha') }) as never,
    );

    expect(res.status).toBe(500);
    // Corpo da resposta ao Telegram é vazio — sem stack trace nem detalhes.
    expect(await res.text()).toBe('');
    expect(errorSpy).toHaveBeenCalled();
  });
});
