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

// Cenário do bug do Eurico: evento em 28/06 (amanhã), 10:00–11:00.
const EVENT_TOMORROW = {
  id: 'evt_2806',
  summary: 'Reunião de teste',
  start: { dateTime: '2026-06-28T10:00:00+01:00' },
  end: { dateTime: '2026-06-28T11:00:00+01:00' },
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

  it('preview PT-PT com dia explícito (newDate) → mostra dia + hora Europe/Lisbon', () => {
    const text = reagendarEventoCalendario.preview(
      { query: 'reunião de amanhã', newTime: '10:00', newDate: '2026-06-29' },
      makeCtx([TOKEN_ROW]),
    );
    expect(text).toMatch(/Vou reagendar/);
    expect(text).toContain('reunião de amanhã');
    expect(text).toContain('29/06/2026');
    expect(text).toContain('10:00');
  });

  it('preview SEM dia (só newTime) → mostra apenas a hora, sem inventar dia', () => {
    const text = reagendarEventoCalendario.preview(
      { query: 'reunião de equipa', newTime: '15:00' },
      makeCtx([TOKEN_ROW]),
    );
    expect(text).toMatch(/Vou reagendar/);
    expect(text).toContain('reunião de equipa');
    expect(text).toContain('15:00');
    // Não deve conter uma data (não foi resolvida ainda).
    expect(text).not.toMatch(/\d{2}\/\d{2}\/\d{4}/);
  });

  it('CASO-CHAVE (bug Eurico): evento em 28/06, só newTime 15:00 → MANTÉM o dia 28, NÃO salta para hoje', async () => {
    fetchMock
      .mockResolvedValueOnce(fetchResponse({ items: [EVENT_TOMORROW] })) // GET search
      .mockResolvedValueOnce(fetchResponse({ id: 'evt_2806' })); // PATCH

    const out = await reagendarEventoCalendario.execute(
      { query: 'reunião de teste', newTime: '15:00' }, // SEM newDate
      makeCtx([TOKEN_ROW]),
    );

    // O dia do evento (28) é preservado; só a hora muda para 15:00.
    expect(out.newStart).toBe('2026-06-28T15:00:00');
    expect(out.newEnd).toBe('2026-06-28T16:00:00');

    const body = JSON.parse((fetchMock.mock.calls[1]![1] as RequestInit).body as string) as {
      start: { dateTime: string; timeZone: string };
      end: { dateTime: string; timeZone: string };
    };
    expect(body.start.dateTime).toBe('2026-06-28T15:00:00'); // dia 28, não 27 (hoje)
    expect(body.start.dateTime).not.toMatch(/Z|[+-]\d{2}:\d{2}$/);
    expect(body.start.timeZone).toBe('Europe/Lisbon');
    expect(body.end.dateTime).toBe('2026-06-28T16:00:00');
    expect(body.end.timeZone).toBe('Europe/Lisbon');
    // originalStart/End REAIS da Google (com offset) — usados no undo.
    expect(out.originalStart).toBe('2026-06-28T10:00:00+01:00');
    expect(out.originalEnd).toBe('2026-06-28T11:00:00+01:00');
  });

  it('dia explícito (newDate) → move o evento para esse dia à nova hora', async () => {
    fetchMock
      .mockResolvedValueOnce(fetchResponse({ items: [EVENT_ITEM] })) // GET search (evento em 27/06)
      .mockResolvedValueOnce(fetchResponse({ id: 'evt_1' })); // PATCH

    const out = await reagendarEventoCalendario.execute(
      { query: 'reunião', newTime: '15:00', newDate: '2026-06-30' },
      makeCtx([TOKEN_ROW]),
    );

    expect(out.newStart).toBe('2026-06-30T15:00:00');
    expect(out.newEnd).toBe('2026-06-30T16:00:00'); // duração 1h preservada

    const body = JSON.parse((fetchMock.mock.calls[1]![1] as RequestInit).body as string) as {
      start: { dateTime: string; timeZone: string };
    };
    expect(body.start.dateTime).toBe('2026-06-30T15:00:00');
    expect(body.start.timeZone).toBe('Europe/Lisbon');
  });

  it('duração original preservada: evento 10:00–11:30 (90min) → 15:00 dá fim 16:30', async () => {
    const event90 = {
      id: 'evt_90',
      summary: 'Sessão',
      start: { dateTime: '2026-06-28T10:00:00+01:00' },
      end: { dateTime: '2026-06-28T11:30:00+01:00' },
    };
    fetchMock
      .mockResolvedValueOnce(fetchResponse({ items: [event90] })) // GET search
      .mockResolvedValueOnce(fetchResponse({ id: 'evt_90' })); // PATCH

    const out = await reagendarEventoCalendario.execute(
      { query: 'sessão', newTime: '15:00' },
      makeCtx([TOKEN_ROW]),
    );

    expect(out.newStart).toBe('2026-06-28T15:00:00');
    expect(out.newEnd).toBe('2026-06-28T16:30:00'); // 90min após 15:00
  });

  it('0 eventos encontrados → lança erro PT-PT', async () => {
    fetchMock.mockResolvedValueOnce(fetchResponse({ items: [] }));
    const msg = await causeMessageOf(
      reagendarEventoCalendario.execute(
        { query: 'inexistente', newTime: '10:00' },
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
        { query: 'reunião', newTime: '10:00' },
        makeCtx([TOKEN_ROW]),
      ),
    ).rejects.toThrow();
  });

  it('sem token OAuth em DB → lança erro PT-PT', async () => {
    const msg = await causeMessageOf(
      reagendarEventoCalendario.execute(
        { query: 'reunião', newTime: '10:00' },
        makeCtx([]),
      ),
    );
    expect(msg).toMatch(/Google Calendar/);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
