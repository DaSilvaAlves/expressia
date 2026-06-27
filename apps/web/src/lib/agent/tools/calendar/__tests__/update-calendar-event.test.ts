// @vitest-environment node
/**
 * Testes da tool `reagendar_evento_calendario` (Story J-5 AC7 + AC11).
 *
 * Cobre: preview PT-PT; execute busca evento + PATCH + guarda originalStart/End;
 * 0 eventos → erro PT-PT; reverse_op external_call/restore_event; PATCH falha →
 * lança; sem token → erro PT-PT.
 *
 * Mocka `@/lib/google/oauth` (refreshAccessToken) e `global.fetch`.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/google/oauth', () => ({
  refreshAccessToken: vi.fn(),
}));

import type { ToolExecutionContext } from '@meu-jarvis/tools';

import { refreshAccessToken } from '@/lib/google/oauth';

import { reagendarEventoCalendario } from '@/lib/agent/tools/calendar/update-calendar-event';

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
 * `ToolExecutionError` esconde a mensagem PT-PT no `.cause`. Extrai a mensagem
 * real para asserções.
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

const EVENT_ITEM = {
  id: 'evt_1',
  summary: 'Reunião de equipa',
  start: { dateTime: '2026-06-27T10:00:00+01:00' },
  end: { dateTime: '2026-06-27T11:00:00+01:00' },
};

describe('reagendar_evento_calendario', () => {
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

  it('preview PT-PT com query + novo horário formatado Europe/Lisbon', () => {
    const text = reagendarEventoCalendario.preview(
      { query: 'reunião de amanhã', newStart: '2026-06-29T10:00:00+01:00' },
      makeCtx([TOKEN_ROW]),
    );
    expect(text).toMatch(/Vou reagendar/);
    expect(text).toContain('reunião de amanhã');
    expect(text).toContain('29/06/2026');
    expect(text).toContain('10:00');
  });

  it('execute busca evento + PATCH + devolve originalStart/End (newEnd preserva duração)', async () => {
    fetchMock
      .mockResolvedValueOnce(fetchResponse({ items: [EVENT_ITEM] })) // GET search
      .mockResolvedValueOnce(fetchResponse({ id: 'evt_1' })); // PATCH

    const out = await reagendarEventoCalendario.execute(
      { query: 'reunião', newStart: '2026-06-29T10:00:00+01:00' },
      makeCtx([TOKEN_ROW]),
    );

    expect(out.eventId).toBe('evt_1');
    expect(out.title).toBe('Reunião de equipa');
    // originalStart/End são os valores REAIS da Google (com offset) — usados no undo.
    expect(out.originalStart).toBe('2026-06-27T10:00:00+01:00');
    expect(out.originalEnd).toBe('2026-06-27T11:00:00+01:00');
    // newStart/newEnd reflectem o wall-clock naïve enviado à Google.
    expect(out.newStart).toBe('2026-06-29T10:00:00');
    expect(out.newEnd).toBe('2026-06-29T11:00:00');

    // A 2ª chamada é o PATCH; body com `dateTime` naïve + timeZone Lisboa.
    const patchInit = fetchMock.mock.calls[1]![1] as RequestInit;
    expect(patchInit.method).toBe('PATCH');
    const body = JSON.parse(patchInit.body as string) as {
      start: { dateTime: string; timeZone: string };
      end: { dateTime: string; timeZone: string };
    };
    expect(body.start.dateTime).toBe('2026-06-29T10:00:00');
    expect(body.start.dateTime).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$/);
    expect(body.start.timeZone).toBe('Europe/Lisbon');
    expect(body.end.dateTime).toBe('2026-06-29T11:00:00');
    expect(body.end.timeZone).toBe('Europe/Lisbon');
  });

  it('ANTI-REGRESSÃO: newStart com sufixo Z → PATCH body sem offset, 16h NÃO 17h', async () => {
    fetchMock
      .mockResolvedValueOnce(fetchResponse({ items: [EVENT_ITEM] })) // GET search
      .mockResolvedValueOnce(fetchResponse({ id: 'evt_1' })); // PATCH

    await reagendarEventoCalendario.execute(
      { query: 'reunião', newStart: '2026-06-29T16:00:00Z' },
      makeCtx([TOKEN_ROW]),
    );

    const body = JSON.parse((fetchMock.mock.calls[1]![1] as RequestInit).body as string) as {
      start: { dateTime: string; timeZone: string };
    };
    expect(body.start.dateTime).toBe('2026-06-29T16:00:00'); // 16h, não 17h
    expect(body.start.dateTime).not.toMatch(/Z|[+-]\d{2}:\d{2}$/);
    expect(body.start.timeZone).toBe('Europe/Lisbon');
  });

  it('0 eventos encontrados → lança erro PT-PT', async () => {
    fetchMock.mockResolvedValueOnce(fetchResponse({ items: [] }));
    const msg = await causeMessageOf(
      reagendarEventoCalendario.execute(
        { query: 'inexistente', newStart: '2026-06-29T10:00:00+01:00' },
        makeCtx([TOKEN_ROW]),
      ),
    );
    expect(msg).toMatch(/Não encontrei nenhum evento/);
  });

  it('reverse_op tem kind external_call + operation restore_event com horários originais', async () => {
    const op = await reagendarEventoCalendario.reverse(
      {
        eventId: 'evt_1',
        title: 'R',
        originalStart: '2026-06-27T10:00:00+01:00',
        originalEnd: '2026-06-27T11:00:00+01:00',
        newStart: 'ns',
        newEnd: 'ne',
      },
      makeCtx([TOKEN_ROW]),
    );
    expect(op).toEqual({
      kind: 'external_call',
      provider: 'google_calendar',
      operation: 'restore_event',
      eventId: 'evt_1',
      originalStart: '2026-06-27T10:00:00+01:00',
      originalEnd: '2026-06-27T11:00:00+01:00',
    });
  });

  it('PATCH falha (HTTP 500) → lança e não persiste', async () => {
    fetchMock
      .mockResolvedValueOnce(fetchResponse({ items: [EVENT_ITEM] }))
      .mockResolvedValueOnce(fetchResponse(null, 500));
    await expect(
      reagendarEventoCalendario.execute(
        { query: 'reunião', newStart: '2026-06-29T10:00:00+01:00' },
        makeCtx([TOKEN_ROW]),
      ),
    ).rejects.toThrow();
  });

  it('sem token OAuth em DB → lança erro PT-PT', async () => {
    const msg = await causeMessageOf(
      reagendarEventoCalendario.execute(
        { query: 'reunião', newStart: '2026-06-29T10:00:00+01:00' },
        makeCtx([]),
      ),
    );
    expect(msg).toMatch(/Google Calendar/);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
