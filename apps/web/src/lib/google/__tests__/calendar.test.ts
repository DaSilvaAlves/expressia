/**
 * Testes unitários — calendar.ts (Story J-3 AC7/AC10).
 *
 * Mocka `global.fetch` (não a Google API real). Cobre:
 *   - eventos retornados ordenados por `start`
 *   - fallback `null` quando a API responde não-OK
 *   - fallback `null` quando o fetch lança
 *   - timeMin/timeMax correctos para hoje em Europe/Lisbon (data fixa)
 *   - eventos all-day (campo `date`) parseados
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  getCalendarEventsToday,
  getTodayBoundsLisbon,
  type CalendarEvent,
} from '@/lib/google/calendar';

function jsonResponse(body: unknown, ok = true, status = 200): Response {
  return {
    ok,
    status,
    json: async () => body,
  } as unknown as Response;
}

describe('calendar — getTodayBoundsLisbon', () => {
  it('calcula início/fim do dia em Europe/Lisbon (Verão WEST, UTC+1)', () => {
    // 15 de Julho de 2026 — horário de Verão de Lisboa (WEST = UTC+1).
    const now = new Date('2026-07-15T10:00:00.000Z');
    const { timeMin, timeMax } = getTodayBoundsLisbon(now);

    // 00:00 Lisbon (UTC+1) = 23:00 UTC do dia anterior.
    expect(timeMin).toBe('2026-07-14T23:00:00.000Z');
    // 23:59:59.999 Lisbon (UTC+1) = 22:59:59.999 UTC do mesmo dia.
    expect(timeMax).toBe('2026-07-15T22:59:59.999Z');
  });

  it('calcula início/fim do dia em Europe/Lisbon (Inverno WET, UTC+0)', () => {
    // 15 de Janeiro de 2026 — horário de Inverno de Lisboa (WET = UTC+0).
    const now = new Date('2026-01-15T10:00:00.000Z');
    const { timeMin, timeMax } = getTodayBoundsLisbon(now);

    expect(timeMin).toBe('2026-01-15T00:00:00.000Z');
    expect(timeMax).toBe('2026-01-15T23:59:59.999Z');
  });
});

describe('calendar — getCalendarEventsToday', () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    vi.stubGlobal('fetch', fetchMock);
    fetchMock.mockReset();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('devolve eventos ordenados por start ascendente', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({
        items: [
          {
            summary: 'Reunião tarde',
            start: { dateTime: '2026-07-15T15:00:00+01:00' },
            end: { dateTime: '2026-07-15T16:00:00+01:00' },
            location: 'Sala B',
          },
          {
            summary: 'Café manhã',
            start: { dateTime: '2026-07-15T09:00:00+01:00' },
            end: { dateTime: '2026-07-15T09:30:00+01:00' },
          },
        ],
      }),
    );

    const events = await getCalendarEventsToday('tok', new Date('2026-07-15T10:00:00.000Z'));

    expect(events).not.toBeNull();
    const list = events as CalendarEvent[];
    expect(list).toHaveLength(2);
    expect(list[0]!.summary).toBe('Café manhã');
    expect(list[1]!.summary).toBe('Reunião tarde');
    expect(list[1]!.location).toBe('Sala B');
    expect(list[0]!.location).toBeUndefined();
  });

  it('passa timeMin/timeMax e Authorization correctos', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ items: [] }));

    await getCalendarEventsToday('meu-token', new Date('2026-01-15T10:00:00.000Z'));

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(String(url)).toContain('timeMin=2026-01-15T00%3A00%3A00.000Z');
    expect(String(url)).toContain('timeMax=2026-01-15T23%3A59%3A59.999Z');
    expect(String(url)).toContain('orderBy=startTime');
    expect((init as RequestInit).headers).toMatchObject({
      Authorization: 'Bearer meu-token',
    });
  });

  it('parseia eventos all-day (campo date)', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({
        items: [
          {
            summary: 'Feriado',
            start: { date: '2026-07-15' },
            end: { date: '2026-07-16' },
          },
        ],
      }),
    );

    const events = await getCalendarEventsToday('tok', new Date('2026-07-15T10:00:00.000Z'));
    expect(events).toHaveLength(1);
    expect(events![0]!.summary).toBe('Feriado');
  });

  it('devolve null quando a API responde não-OK', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ error: 'invalid' }, false, 401));
    const events = await getCalendarEventsToday('tok');
    expect(events).toBeNull();
  });

  it('devolve null (fallback) quando o fetch lança', async () => {
    fetchMock.mockRejectedValueOnce(new Error('network down'));
    const events = await getCalendarEventsToday('tok');
    expect(events).toBeNull();
  });

  it('ignora eventos sem start/end válidos', async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse({
        items: [
          { summary: 'Sem datas' },
          {
            summary: 'Válido',
            start: { dateTime: '2026-07-15T09:00:00+01:00' },
            end: { dateTime: '2026-07-15T10:00:00+01:00' },
          },
        ],
      }),
    );

    const events = await getCalendarEventsToday('tok', new Date('2026-07-15T10:00:00.000Z'));
    expect(events).toHaveLength(1);
    expect(events![0]!.summary).toBe('Válido');
  });
});
