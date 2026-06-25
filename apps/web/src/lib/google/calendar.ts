/**
 * Google Calendar API — leitura dos eventos de hoje (Story J-3 AC7).
 *
 * `getCalendarEventsToday(accessToken)` chama a Google Calendar API
 * (`GET /calendars/primary/events`) com `timeMin`/`timeMax` correspondentes ao
 * início e fim do dia de HOJE em `Europe/Lisbon` (calculados com `date-fns-tz`,
 * já existente no projecto — sem dependência nova). Devolve os eventos ordenados
 * por `start` ascendente.
 *
 * FALLBACK: qualquer falha (rede, token expirado não recuperável, quota, parse)
 * devolve `null` — o chamador (brief J-4) trata `null` como "agenda
 * indisponível" e omite a secção. Esta função NUNCA lança excepção não tratada.
 *
 * Privacidade: títulos e localização dos eventos NUNCA são logados (constraint
 * J-3). Esta função não loga conteúdo de eventos — o chamador, se logar, deve
 * logar apenas contagens.
 *
 * Trace: Story J-3 AC7, PRD-Jarvis §4.4 (fallback), FR-J9.
 */
import { fromZonedTime } from 'date-fns-tz';

/** Fuso horário do mercado PT-PT (CON — Portugal continental). */
const TZ = 'Europe/Lisbon';
const CALENDAR_EVENTS_ENDPOINT =
  'https://www.googleapis.com/calendar/v3/calendars/primary/events';

/** Shape mínima de um evento de calendário consumido pelo brief. */
export interface CalendarEvent {
  summary: string;
  start: Date;
  end: Date;
  location?: string;
}

/**
 * Calcula `timeMin` (início do dia) e `timeMax` (fim do dia) de HOJE em
 * `Europe/Lisbon`, em ISO 8601 com offset (RFC3339 — exigido pela API). Recebe
 * `now` injectável para determinismo nos testes.
 *
 * Estratégia DST-safe: deriva a data de calendário local (YYYY-MM-DD em Lisbon)
 * e constrói os limites do dia (`00:00:00` / `23:59:59.999`) como wall-clock
 * Lisbon, convertidos para instante UTC via `fromZonedTime` (resolve o offset
 * WET/WEST correcto do dia).
 */
export function getTodayBoundsLisbon(now: Date = new Date()): { timeMin: string; timeMax: string } {
  // Data de calendário local em Lisbon (YYYY-MM-DD), independente do TZ do host.
  const ymd = new Intl.DateTimeFormat('en-CA', {
    timeZone: TZ,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now);

  const startUtc = fromZonedTime(`${ymd}T00:00:00.000`, TZ);
  const endUtc = fromZonedTime(`${ymd}T23:59:59.999`, TZ);

  return { timeMin: startUtc.toISOString(), timeMax: endUtc.toISOString() };
}

/** Shape parcial da resposta da Google Calendar API que consumimos. */
interface GoogleCalendarItem {
  summary?: string;
  location?: string;
  start?: { dateTime?: string; date?: string };
  end?: { dateTime?: string; date?: string };
}

interface GoogleCalendarListResponse {
  items?: GoogleCalendarItem[];
}

/** Resolve a `Date` de um limite de evento (`dateTime` ou `date` all-day). */
function parseBound(bound: { dateTime?: string; date?: string } | undefined): Date | null {
  if (!bound) return null;

  // `dateTime` já traz offset (RFC3339) — `new Date` resolve o instante exacto.
  if (bound.dateTime) {
    const parsed = new Date(bound.dateTime);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }

  // `date` (all-day, YYYY-MM-DD) não tem hora nem fuso. Interpretamos como
  // meia-noite wall-clock em Europe/Lisbon (não UTC) — `fromZonedTime` resolve
  // o offset WET/WEST correcto do dia (DST-safe), evitando que um evento
  // all-day apareça no dia errado.
  if (bound.date) {
    const parsed = fromZonedTime(`${bound.date}T00:00:00.000`, TZ);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }

  return null;
}

/**
 * Lê os eventos de hoje (Europe/Lisbon) do calendário `primary`.
 *
 * @param accessToken - access token OAuth Google válido.
 * @param now - injectável para testes (default `new Date()`).
 * @returns array de eventos ordenados por `start` asc, ou `null` em falha.
 */
export async function getCalendarEventsToday(
  accessToken: string,
  now: Date = new Date(),
): Promise<CalendarEvent[] | null> {
  try {
    const { timeMin, timeMax } = getTodayBoundsLisbon(now);
    const params = new URLSearchParams({
      timeMin,
      timeMax,
      singleEvents: 'true',
      orderBy: 'startTime',
      maxResults: '50',
      timeZone: TZ,
    });

    const res = await fetch(`${CALENDAR_EVENTS_ENDPOINT}?${params.toString()}`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });

    if (!res.ok) {
      return null;
    }

    const data: unknown = await res.json();
    if (typeof data !== 'object' || data === null) {
      return null;
    }

    const items = (data as GoogleCalendarListResponse).items ?? [];

    const events: CalendarEvent[] = [];
    for (const item of items) {
      const start = parseBound(item.start);
      const end = parseBound(item.end);
      if (!start || !end) {
        continue;
      }
      events.push({
        summary: item.summary ?? '(sem título)',
        start,
        end,
        ...(item.location ? { location: item.location } : {}),
      });
    }

    events.sort((a, b) => a.start.getTime() - b.start.getTime());
    return events;
  } catch {
    // Fallback silencioso — agenda indisponível (rede, parse, etc.).
    return null;
  }
}
