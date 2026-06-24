// @vitest-environment node
/**
 * Testes do webhook do Telegram — Story J-1 (echo seguro) + J-2 (motor + undo).
 *
 * Cobrem:
 *   J-1 (mantidos):
 *     - AC2: secret token ausente/incorrecto → 401 sem processar o body.
 *     - Corpo JSON inválido / forma inesperada → 400 controlado.
 *   J-2:
 *     - AC6: chat_id em telegram_link → resolve identidade → chama o motor.
 *     - AC6: chat_id NÃO em telegram_link → 200 silencioso (sem chamar o motor).
 *     - AC7: mode 'executed' → sendMessage com botão (Cancelar).
 *     - AC8: mode 'preview' → sendMessage com botões sim/não.
 *     - AC9: callback_query undo:{runId} → executeUndo chamado.
 *     - AC10: callback_query confirm:{runId} → executeConfirm chamado.
 *     - AC6: callback_query cancel:{runId} → "Ok, não fiz nada."
 *     - AC11: sendChatAction('typing') chamado ANTES do motor.
 *     - AC12: message.text NUNCA aparece nos logs.
 *
 * Isolamento de env vars com `vi.stubEnv` / `vi.unstubAllEnvs()` em `afterEach`.
 * O motor (`runAgentForHousehold`), os extractos (`executeUndo`/`executeConfirm`)
 * e o `getServiceDb` (telegram_link) são mockados; o `fetch` da Bot API é mockado
 * globalmente (o cliente Telegram usa fetch nativo).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  serviceDbExecuteMock: vi.fn(),
  runAgentMock: vi.fn(),
  executeUndoMock: vi.fn(),
  executeConfirmMock: vi.fn(),
}));

// telegram_link resolution via getServiceDb.
vi.mock('@/lib/agent/db-shim', () => ({
  getServiceDb: () => ({ execute: mocks.serviceDbExecuteMock }),
  getDb: () => ({ execute: vi.fn() }),
}));

// Motor + extractos chamáveis (sem HTTP interno).
vi.mock('@/lib/agent/run-agent', () => ({
  runAgentForHousehold: mocks.runAgentMock,
}));
vi.mock('@/app/api/agent/prompt/[runId]/undo/route', () => ({
  executeUndo: mocks.executeUndoMock,
}));
vi.mock('@/app/api/agent/prompt/[runId]/confirm/route', () => ({
  executeConfirm: mocks.executeConfirmMock,
}));

import { POST } from '@/app/api/telegram/webhook/route';

const SECRET = 'segredo-webhook-de-teste-1234567890';
const CHAT_ID = 5647753194; // chat_id do Eurico (provado em J-1)
const USER_ID = '00000000-0000-0000-0000-000000000001';
const HOUSEHOLD_ID = '00000000-0000-0000-0000-0000000000a1';
const RUN_ID = '00000000-0000-0000-0000-000000000bbb';

const fetchMock = vi.fn();

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
    options.rawBody !== undefined ? options.rawBody : JSON.stringify(options.body ?? {});
  return new Request('https://expressia.pt/api/telegram/webhook', {
    method: 'POST',
    headers,
    body,
  });
}

function textUpdate(text: string) {
  return {
    update_id: 42,
    message: {
      message_id: 7,
      date: 1_700_000_000,
      chat: { id: CHAT_ID, type: 'private' },
      text,
    },
  };
}

function callbackUpdate(data: string) {
  return {
    update_id: 99,
    callback_query: {
      id: 'cb1',
      data,
      message: {
        message_id: 8,
        date: 1_700_000_000,
        chat: { id: CHAT_ID, type: 'private' },
      },
    },
  };
}

/** Mock de telegram_link: chat_id conhecido → identidade do Eurico. */
function setupIdentityFound(): void {
  mocks.serviceDbExecuteMock.mockResolvedValue([
    { user_id: USER_ID, household_id: HOUSEHOLD_ID },
  ]);
}

/** Mock de telegram_link: chat_id desconhecido → 0 rows. */
function setupIdentityNotFound(): void {
  mocks.serviceDbExecuteMock.mockResolvedValue([]);
}

beforeEach(() => {
  vi.clearAllMocks();
  fetchMock.mockReset();
  fetchMock.mockResolvedValue(new Response(null, { status: 200 }));
  vi.stubGlobal('fetch', fetchMock);
  vi.stubEnv('TELEGRAM_BOT_TOKEN', '12345:fake-bot-token');
  vi.stubEnv('TELEGRAM_WEBHOOK_SECRET', SECRET);
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('POST /api/telegram/webhook — secret token (AC2)', () => {
  it('rejeita com 401 quando o cabeçalho do secret está ausente', async () => {
    const res = await POST(makeRequest({ secret: null, body: textUpdate('olá') }) as never);
    expect(res.status).toBe(401);
    expect(mocks.runAgentMock).not.toHaveBeenCalled();
  });

  it('rejeita com 401 quando o secret está incorrecto', async () => {
    const res = await POST(makeRequest({ secret: 'errado', body: textUpdate('olá') }) as never);
    expect(res.status).toBe(401);
    expect(mocks.runAgentMock).not.toHaveBeenCalled();
  });

  it('rejeita com 401 quando TELEGRAM_WEBHOOK_SECRET não está definido', async () => {
    vi.stubEnv('TELEGRAM_WEBHOOK_SECRET', '');
    const res = await POST(makeRequest({ secret: SECRET, body: textUpdate('olá') }) as never);
    expect(res.status).toBe(401);
  });
});

describe('POST /api/telegram/webhook — corpo malformado', () => {
  it('JSON inválido devolve 400 controlado (sem 500, sem processar)', async () => {
    const res = await POST(makeRequest({ secret: SECRET, rawBody: '{ isto não é json' }) as never);
    expect(res.status).toBe(400);
    expect(mocks.runAgentMock).not.toHaveBeenCalled();
  });

  it('update com forma inesperada devolve 400', async () => {
    const res = await POST(makeRequest({ secret: SECRET, body: { foo: 'bar' } }) as never);
    expect(res.status).toBe(400);
    expect(mocks.runAgentMock).not.toHaveBeenCalled();
  });
});

describe('POST /api/telegram/webhook — resolução de identidade (AC6)', () => {
  it('chat_id NÃO registado em telegram_link → 200 silencioso sem chamar o motor', async () => {
    setupIdentityNotFound();
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    const res = await POST(makeRequest({ secret: SECRET, body: textUpdate('olá') }) as never);

    expect(res.status).toBe(200);
    expect(mocks.runAgentMock).not.toHaveBeenCalled();
    expect(warnSpy).toHaveBeenCalled();
  });

  it('chat_id registado → resolve identidade e chama runAgentForHousehold', async () => {
    setupIdentityFound();
    mocks.runAgentMock.mockResolvedValue({
      status: 'executed',
      kind: 'pipeline',
      runId: RUN_ID,
      summary: 'Criei a tarefa.',
      results: { success: true, results: [] },
      undoExpiresAt: new Date().toISOString(),
    });

    const res = await POST(makeRequest({ secret: SECRET, body: textUpdate('cria tarefa') }) as never);

    expect(res.status).toBe(200);
    expect(mocks.runAgentMock).toHaveBeenCalledTimes(1);
    expect(mocks.runAgentMock).toHaveBeenCalledWith(
      expect.objectContaining({ userId: USER_ID, householdId: HOUSEHOLD_ID, prompt: 'cria tarefa' }),
    );
  });
});

describe('POST /api/telegram/webhook — tradução de resultados (AC7/AC8)', () => {
  it('AC7 — executed → sendMessage com botão (Cancelar) callback undo:{runId}', async () => {
    setupIdentityFound();
    mocks.runAgentMock.mockResolvedValue({
      status: 'executed',
      kind: 'pipeline',
      runId: RUN_ID,
      summary: "Criei a tarefa 'comprar pão'.",
      results: { success: true, results: [] },
      undoExpiresAt: new Date().toISOString(),
    });

    await POST(makeRequest({ secret: SECRET, body: textUpdate('cria tarefa comprar pão') }) as never);

    const sendCall = sentMessageCalls()[0];
    expect(sendCall).toBeDefined();
    expect(sendCall!.text).toContain('Feito');
    expect(sendCall!.reply_markup?.inline_keyboard[0]![0]!.callback_data).toBe(`undo:${RUN_ID}`);
    expect(sendCall!.reply_markup?.inline_keyboard[0]![0]!.text).toBe('(Cancelar)');
  });

  it('AC8 — preview → sendMessage com botões sim/não (confirm/cancel)', async () => {
    setupIdentityFound();
    mocks.runAgentMock.mockResolvedValue({
      status: 'preview',
      runId: RUN_ID,
      planSummary: ['criar_tarefa (50%)'],
      confidence: 0.5,
      expiresAt: new Date().toISOString(),
    });

    await POST(makeRequest({ secret: SECRET, body: textUpdate('faz qualquer coisa') }) as never);

    const sendCall = sentMessageCalls()[0];
    expect(sendCall).toBeDefined();
    const row = sendCall!.reply_markup?.inline_keyboard[0];
    expect(row?.[0]?.text).toBe('sim');
    expect(row?.[0]?.callback_data).toBe(`confirm:${RUN_ID}`);
    expect(row?.[1]?.text).toBe('não');
    expect(row?.[1]?.callback_data).toBe(`cancel:${RUN_ID}`);
  });
});

describe('POST /api/telegram/webhook — callbacks (AC9/AC10/cancel)', () => {
  it('AC9 — callback undo:{runId} chama executeUndo e responde ao utilizador', async () => {
    setupIdentityFound();
    mocks.executeUndoMock.mockResolvedValue({ ok: true, runId: RUN_ID, opsCount: 1, message: 'Operação revertida.' });

    const res = await POST(makeRequest({ secret: SECRET, body: callbackUpdate(`undo:${RUN_ID}`) }) as never);

    expect(res.status).toBe(200);
    expect(mocks.executeUndoMock).toHaveBeenCalledWith(
      expect.objectContaining({ runId: RUN_ID, householdId: HOUSEHOLD_ID, userId: USER_ID }),
    );
    expect(mocks.runAgentMock).not.toHaveBeenCalled();
    // answerCallbackQuery + sendMessage foram chamados via fetch.
    expect(urlsCalled().some((u) => u.includes('/answerCallbackQuery'))).toBe(true);
  });

  it('AC10 — callback confirm:{runId} chama executeConfirm', async () => {
    setupIdentityFound();
    mocks.executeConfirmMock.mockResolvedValue({
      ok: true,
      runId: RUN_ID,
      summary: 'Confirmado.',
      results: { success: true, results: [] },
      undoExpiresAt: new Date().toISOString(),
    });

    const res = await POST(makeRequest({ secret: SECRET, body: callbackUpdate(`confirm:${RUN_ID}`) }) as never);

    expect(res.status).toBe(200);
    expect(mocks.executeConfirmMock).toHaveBeenCalledWith(
      expect.objectContaining({ runId: RUN_ID, householdId: HOUSEHOLD_ID, userId: USER_ID }),
    );
    // Confirmação executada → novo botão (Cancelar).
    const sendCall = sentMessageCalls()[0];
    expect(sendCall!.reply_markup?.inline_keyboard[0]![0]!.callback_data).toBe(`undo:${RUN_ID}`);
  });

  it('cancel:{runId} → "Ok, não fiz nada." sem chamar undo/confirm', async () => {
    setupIdentityFound();

    const res = await POST(makeRequest({ secret: SECRET, body: callbackUpdate(`cancel:${RUN_ID}`) }) as never);

    expect(res.status).toBe(200);
    expect(mocks.executeUndoMock).not.toHaveBeenCalled();
    expect(mocks.executeConfirmMock).not.toHaveBeenCalled();
    const sendCall = sentMessageCalls()[0];
    expect(sendCall!.text).toBe('Ok, não fiz nada.');
  });
});

describe('POST /api/telegram/webhook — UX + privacidade (AC11/AC12)', () => {
  it('AC11 — sendChatAction(typing) é chamado ANTES de runAgentForHousehold', async () => {
    setupIdentityFound();
    const order: string[] = [];
    fetchMock.mockImplementation(async (url: string) => {
      if (url.includes('/sendChatAction')) order.push('chatAction');
      return new Response(null, { status: 200 });
    });
    mocks.runAgentMock.mockImplementation(async () => {
      order.push('motor');
      return {
        status: 'executed',
        kind: 'pipeline',
        runId: RUN_ID,
        summary: 'ok',
        results: { success: true, results: [] },
        undoExpiresAt: new Date().toISOString(),
      };
    });

    await POST(makeRequest({ secret: SECRET, body: textUpdate('cria tarefa') }) as never);

    expect(order[0]).toBe('chatAction');
    expect(order).toContain('motor');
    expect(order.indexOf('chatAction')).toBeLessThan(order.indexOf('motor'));
  });

  it('AC12 — message.text NUNCA aparece nos logs', async () => {
    setupIdentityFound();
    const secretText = 'paguei 50 euros ao Joao no IBAN PT50';
    mocks.runAgentMock.mockResolvedValue({
      status: 'executed',
      kind: 'pipeline',
      runId: RUN_ID,
      summary: 'ok',
      results: { success: true, results: [] },
      undoExpiresAt: new Date().toISOString(),
    });
    const infoSpy = vi.spyOn(console, 'info').mockImplementation(() => {});
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    await POST(makeRequest({ secret: SECRET, body: textUpdate(secretText) }) as never);

    const allLogs = [...infoSpy.mock.calls, ...warnSpy.mock.calls, ...errorSpy.mock.calls]
      .flat()
      .map((a) => String(a))
      .join(' | ');
    expect(allLogs).not.toContain(secretText);
    expect(allLogs).not.toContain('IBAN');
  });
});

// ─── Helpers de inspecção do fetch (Bot API) ─────────────────────────────────

function urlsCalled(): string[] {
  return fetchMock.mock.calls.map((c) => String(c[0]));
}

interface SentMessage {
  chat_id: number;
  text: string;
  reply_markup?: {
    inline_keyboard: Array<Array<{ text: string; callback_data?: string }>>;
  };
}

function sentMessageCalls(): SentMessage[] {
  return fetchMock.mock.calls
    .filter((c) => String(c[0]).includes('/sendMessage'))
    .map((c) => JSON.parse((c[1] as RequestInit).body as string) as SentMessage);
}
