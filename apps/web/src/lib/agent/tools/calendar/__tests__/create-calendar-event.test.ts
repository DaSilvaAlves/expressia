// @vitest-environment node
/**
 * Testes da tool `criar_evento_calendario` (Story J-5 AC6 + AC11).
 *
 * Cobre: preview PT-PT formatado; execute cria evento + devolve eventId; sem
 * token OAuth → erro PT-PT; reverse_op external_call/delete_event; Calendar API
 * falha → lança; default end (1h) quando omitido.
 *
 * Mocka `@/lib/google/oauth` (refreshAccessToken) e `global.fetch`.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/google/oauth', () => ({
  refreshAccessToken: vi.fn(),
}));

import type { ToolExecutionContext } from '@meu-jarvis/tools';

import { refreshAccessToken } from '@/lib/google/oauth';

import { criarEventoCalendario } from '@/lib/agent/tools/calendar/create-calendar-event';

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

/**
 * `ToolExecutionError` esconde a mensagem PT-PT no `.cause` (o seu `.message` é
 * `Tool '...' execute() threw: Error`). Este helper extrai a mensagem real.
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

describe('criar_evento_calendario', () => {
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

  it('preview PT-PT formatado com título + data/hora Europe/Lisbon', () => {
    const text = criarEventoCalendario.preview(
      { title: 'Reunião com a Ana', start: '2026-06-27T15:00:00+01:00' },
      makeCtx([TOKEN_ROW]),
    );
    expect(text).toMatch(/Vou criar o evento/);
    expect(text).toContain('Reunião com a Ana');
    expect(text).toContain('27/06/2026');
    expect(text).toContain('15:00');
  });

  it('execute cria evento e devolve eventId (POST ao endpoint correcto)', async () => {
    fetchMock.mockResolvedValueOnce(
      fetchResponse({
        id: 'evt_123',
        summary: 'Reunião com a Ana',
        start: { dateTime: '2026-06-27T15:00:00+01:00' },
        end: { dateTime: '2026-06-27T16:00:00+01:00' },
      }),
    );

    const out = await criarEventoCalendario.execute(
      { title: 'Reunião com a Ana', start: '2026-06-27T15:00:00+01:00' },
      makeCtx([TOKEN_ROW]),
    );

    expect(out.eventId).toBe('evt_123');
    expect(out.title).toBe('Reunião com a Ana');
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(String(url)).toContain('/calendars/primary/events');
    expect((init as RequestInit).method).toBe('POST');
    expect((init as RequestInit).headers).toMatchObject({
      Authorization: 'Bearer mock-access-token',
    });

    // Bug-fix timezone: o body enviado à Google tem `dateTime` wall-clock LOCAL
    // (sem 'Z' nem offset) + `timeZone: 'Europe/Lisbon'`. Input '+01:00' → naïve.
    const body = JSON.parse((init as RequestInit).body as string) as {
      start: { dateTime: string; timeZone: string };
      end: { dateTime: string; timeZone: string };
    };
    expect(body.start.dateTime).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$/);
    expect(body.start.dateTime).toBe('2026-06-27T15:00:00');
    expect(body.start.timeZone).toBe('Europe/Lisbon');
    expect(body.end.dateTime).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$/);
    expect(body.end.timeZone).toBe('Europe/Lisbon');
  });

  it('ANTI-REGRESSÃO (bug do Eurico): start com sufixo Z → body sem offset, 10h NÃO 11h', async () => {
    fetchMock.mockResolvedValueOnce(
      fetchResponse({
        id: 'evt_z',
        summary: 'Reunião de teste',
        start: { dateTime: '2026-06-28T10:00:00+01:00' },
        end: { dateTime: '2026-06-28T11:00:00+01:00' },
      }),
    );

    // O gpt-4o-mini escrevia a hora literal com 'Z' (UTC). Antes do fix, a Google
    // usava o instante 10:00Z → 11:00 Lisboa (horário de verão). Agora strippamos.
    await criarEventoCalendario.execute(
      { title: 'Reunião de teste', start: '2026-06-28T10:00:00Z' },
      makeCtx([TOKEN_ROW]),
    );

    const body = JSON.parse((fetchMock.mock.calls[0]![1] as RequestInit).body as string) as {
      start: { dateTime: string; timeZone: string };
    };
    expect(body.start.dateTime).toBe('2026-06-28T10:00:00'); // 10h, não 11h
    expect(body.start.dateTime).not.toMatch(/Z|[+-]\d{2}:\d{2}$/);
    expect(body.start.timeZone).toBe('Europe/Lisbon');
  });

  it('sem token OAuth em DB → lança erro PT-PT e NÃO chama a Calendar API', async () => {
    const msg = await causeMessageOf(
      criarEventoCalendario.execute(
        { title: 'X', start: '2026-06-27T15:00:00+01:00' },
        makeCtx([]),
      ),
    );
    expect(msg).toMatch(/Google Calendar/);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('reverse_op tem kind external_call + operation delete_event', async () => {
    const op = await criarEventoCalendario.reverse(
      { eventId: 'evt_123', title: 'R', start: 's', end: 'e' },
      makeCtx([TOKEN_ROW]),
    );
    expect(op).toEqual({
      kind: 'external_call',
      provider: 'google_calendar',
      operation: 'delete_event',
      eventId: 'evt_123',
    });
  });

  it('Calendar API falha (HTTP 500) → lança e não devolve evento', async () => {
    fetchMock.mockResolvedValueOnce(fetchResponse(null, 500));
    await expect(
      criarEventoCalendario.execute(
        { title: 'X', start: '2026-06-27T15:00:00+01:00' },
        makeCtx([TOKEN_ROW]),
      ),
    ).rejects.toThrow();
  });

  it('end omitido (DST-safe) → end = start +1h em wall-clock naïve de Lisboa', async () => {
    fetchMock.mockResolvedValueOnce(
      fetchResponse({
        id: 'evt_9',
        summary: 'X',
        start: { dateTime: '2026-06-27T15:00:00+01:00' },
        end: { dateTime: '2026-06-27T16:00:00+01:00' },
      }),
    );
    await criarEventoCalendario.execute(
      { title: 'X', start: '2026-06-27T15:00:00.000Z' },
      makeCtx([TOKEN_ROW]),
    );
    const body = JSON.parse((fetchMock.mock.calls[0]![1] as RequestInit).body as string) as {
      start: { dateTime: string };
      end: { dateTime: string };
    };
    // Ambos naïve (sem 'Z'/offset); 15:00 local → 16:00 local.
    expect(body.start.dateTime).toBe('2026-06-27T15:00:00');
    expect(body.end.dateTime).toBe('2026-06-27T16:00:00');
  });
});
