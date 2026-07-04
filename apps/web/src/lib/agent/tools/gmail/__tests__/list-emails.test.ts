// @vitest-environment node
/**
 * Testes da tool `consultar_emails` (Story J-6 AC7 + AC12).
 *
 * Cobre: preview PT-PT sem/com query; execute lista + lê metadados → array
 * GmailMessageMetadata; sem token OAuth → erro PT-PT; resultado vazio → []; falha
 * HTTP → lança; reverse_op `_noop` (R1b v1.1).
 *
 * Mocka `@/lib/google/oauth` (refreshAccessToken) e `global.fetch`.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/google/oauth', () => ({
  refreshAccessToken: vi.fn(),
}));

import type { ToolExecutionContext } from '@meu-jarvis/tools';

import { refreshAccessToken } from '@/lib/google/oauth';

import { consultarEmails } from '@/lib/agent/tools/gmail/list-emails';

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

/** Detalhe mock de uma mensagem da Gmail API (format=metadata). */
function messageDetail(id: string, subject: string, from: string, date: string, snippet: string) {
  return {
    id,
    snippet,
    payload: {
      headers: [
        { name: 'Subject', value: subject },
        { name: 'From', value: from },
        { name: 'Date', value: date },
      ],
    },
  };
}

/**
 * `ToolExecutionError` esconde a mensagem PT-PT no `.cause`. Este helper extrai a
 * mensagem real para os asserts.
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

describe('consultar_emails', () => {
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

  it('preview PT-PT sem query', () => {
    const text = consultarEmails.preview({}, makeCtx([TOKEN_ROW]));
    expect(text).toBe('Vou procurar os teus emails recentes no Gmail.');
  });

  it('preview PT-PT com query', () => {
    const text = consultarEmails.preview({ query: 'from:pedro' }, makeCtx([TOKEN_ROW]));
    expect(text).toBe("Vou procurar emails sobre 'from:pedro' no Gmail.");
  });

  it('execute lista emails e devolve metadados normalizados (subject/from/receivedAt/snippet)', async () => {
    fetchMock
      .mockResolvedValueOnce(fetchResponse({ messages: [{ id: 'm1' }, { id: 'm2' }] }))
      .mockResolvedValueOnce(
        fetchResponse(
          messageDetail(
            'm1',
            'Reunião amanhã',
            'Pedro <pedro@example.com>',
            'Fri, 27 Jun 2026 10:30:00 +0000',
            'Olá, podemos falar amanhã?',
          ),
        ),
      )
      .mockResolvedValueOnce(
        fetchResponse(
          messageDetail(
            'm2',
            'A tua factura',
            'Banco <banco@example.com>',
            'Fri, 27 Jun 2026 09:00:00 +0000',
            'A tua factura está disponível.',
          ),
        ),
      );

    const out = await consultarEmails.execute({}, makeCtx([TOKEN_ROW]));

    expect(out).toHaveLength(2);
    expect(out[0]).toEqual({
      id: 'm1',
      subject: 'Reunião amanhã',
      from: 'Pedro <pedro@example.com>',
      receivedAt: 'Fri, 27 Jun 2026 10:30:00 +0000',
      snippet: 'Olá, podemos falar amanhã?',
    });
    expect(out[1]?.subject).toBe('A tua factura');

    // A primeira chamada é a lista com a pesquisa por defeito (não lidos, inbox).
    const [listUrl, listInit] = fetchMock.mock.calls[0]!;
    expect(String(listUrl)).toContain('/gmail/v1/users/me/messages?');
    expect(String(listUrl)).toContain('is%3Aunread');
    expect((listInit as RequestInit).headers).toMatchObject({
      Authorization: 'Bearer mock-access-token',
    });
  });

  it('execute com query usa o valor como pesquisa Gmail', async () => {
    fetchMock.mockResolvedValueOnce(fetchResponse({ messages: [] }));
    await consultarEmails.execute({ query: 'from:pedro' }, makeCtx([TOKEN_ROW]));
    const [listUrl] = fetchMock.mock.calls[0]!;
    expect(String(listUrl)).toContain('from%3Apedro');
    expect(String(listUrl)).not.toContain('is%3Aunread');
  });

  it('sem token OAuth em DB → lança erro PT-PT e NÃO chama a Gmail API', async () => {
    const msg = await causeMessageOf(consultarEmails.execute({}, makeCtx([])));
    expect(msg).toMatch(/Gmail/);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('resultado vazio da Gmail API → devolve [] sem lançar', async () => {
    fetchMock.mockResolvedValueOnce(fetchResponse({ resultSizeEstimate: 0 }));
    const out = await consultarEmails.execute({}, makeCtx([TOKEN_ROW]));
    expect(out).toEqual([]);
    // Só a chamada de lista — sem leitura de detalhes.
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('falha HTTP na lista (500) → lança ToolExecutionError', async () => {
    fetchMock.mockResolvedValueOnce(fetchResponse(null, 500));
    await expect(consultarEmails.execute({}, makeCtx([TOKEN_ROW]))).rejects.toThrow();
  });

  it('falha HTTP ao ler o detalhe de um email → salta item (skip-on-failure), devolve []', async () => {
    // Após refactor item 4 (parallelização): falhas por-mensagem são silenciosas
    // (null → filter). A lista retorna vazia em vez de lançar — comportamento mais
    // resiliente (um email inacessível não deita abaixo toda a listagem).
    fetchMock
      .mockResolvedValueOnce(fetchResponse({ messages: [{ id: 'm1' }] }))
      .mockResolvedValueOnce(fetchResponse(null, 401));
    const out = await consultarEmails.execute({}, makeCtx([TOKEN_ROW]));
    expect(out).toEqual([]);
  });

  it('reverse() devolve sentinela inerte _noop (R1b v1.1)', async () => {
    const op = await consultarEmails.reverse([], makeCtx([TOKEN_ROW]));
    expect(op).toMatchObject({ kind: 'delete_row', table: '_noop' });
    // id é um UUID válido.
    expect((op as { id: string }).id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
    );
  });
});
