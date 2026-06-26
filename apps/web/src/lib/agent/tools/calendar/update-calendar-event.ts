/**
 * Tool `reagendar_evento_calendario` — reagenda (PATCH) um evento existente no
 * Google Calendar (Story J-5).
 *
 * Domínio: `calendar`. Resolve o evento mais provável por correspondência ao
 * `query` (eventos futuros próximos de hoje, ordenados por proximidade temporal,
 * primeiro resultado) e altera o horário. Sempre `needs_confirmation: true` no
 * classifier (modificar um evento existente é irreversível sem o undo de 30s).
 *
 * **Excepção justificada à regra "no HTTP in execute" (Dev Notes):** ver
 * `create-calendar-event.ts`. O undo é um PATCH de volta aos `originalStart`/
 * `originalEnd` capturados antes da alteração.
 *
 * RLS (NFR5): `ctx.db` é cliente authenticated. NUNCA usa `getServiceDb()`.
 *
 * Trace: Story J-5 AC7 + AC10, PRD-Jarvis §9.
 */
import { formatInTimeZone } from 'date-fns-tz';
import { z } from 'zod';

import {
  ToolExecutionError,
  type ReverseOpPayload,
  type ToolDefinition,
  type ToolExecutionContext,
} from '@meu-jarvis/tools';

import {
  CALENDAR_EVENTS_ENDPOINT,
  CALENDAR_TZ,
  getCalendarAccessToken,
  isGoogleCalendarItem,
  boundToIso,
  type GoogleCalendarItem,
} from './calendar-api';

const TOOL_NAME = 'reagendar_evento_calendario';

// ─────────────────────────────────────────────────────────────────────────────
// Schemas
// ─────────────────────────────────────────────────────────────────────────────

const ReagendarEventoCalendarioInputSchema = z.object({
  query: z.string().min(1),
  newStart: z.string().datetime({ offset: true }),
  newEnd: z.string().datetime({ offset: true }).optional(),
});

export type ReagendarEventoCalendarioInput = z.infer<
  typeof ReagendarEventoCalendarioInputSchema
>;

const ReagendarEventoCalendarioOutputSchema = z.object({
  eventId: z.string().min(1),
  title: z.string(),
  originalStart: z.string(),
  originalEnd: z.string(),
  newStart: z.string(),
  newEnd: z.string(),
});

export type ReagendarEventoCalendarioOutput = z.infer<
  typeof ReagendarEventoCalendarioOutputSchema
>;

// ─────────────────────────────────────────────────────────────────────────────
// Helpers internos
// ─────────────────────────────────────────────────────────────────────────────

interface GoogleEventsListResponse {
  readonly items?: unknown;
}

/** Pesquisa o evento candidato mais próximo de agora por `query`. */
async function searchEvent(
  accessToken: string,
  query: string,
): Promise<GoogleCalendarItem | null> {
  const params = new URLSearchParams({
    q: query,
    timeMin: new Date().toISOString(),
    maxResults: '5',
    singleEvents: 'true',
    orderBy: 'startTime',
    timeZone: CALENDAR_TZ,
  });

  let res: Response;
  try {
    res = await fetch(`${CALENDAR_EVENTS_ENDPOINT}?${params.toString()}`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
  } catch (err) {
    throw new ToolExecutionError(
      TOOL_NAME,
      new Error(
        `Falha de rede ao pesquisar eventos na Google Calendar API: ${err instanceof Error ? err.message : 'erro desconhecido'}.`,
      ),
    );
  }

  if (!res.ok) {
    throw new ToolExecutionError(
      TOOL_NAME,
      new Error(`A Google Calendar API recusou a pesquisa de eventos (HTTP ${res.status}).`),
    );
  }

  const data: unknown = await res.json().catch(() => null);
  if (typeof data !== 'object' || data === null) {
    return null;
  }
  const items = (data as GoogleEventsListResponse).items;
  if (!Array.isArray(items)) {
    return null;
  }
  // Primeiro resultado (mais próximo de agora — orderBy=startTime + timeMin=agora).
  const first = items.find((it) => isGoogleCalendarItem(it) && typeof it.id === 'string');
  return first ? (first as GoogleCalendarItem) : null;
}

// ─────────────────────────────────────────────────────────────────────────────
// Tool definition
// ─────────────────────────────────────────────────────────────────────────────

export const reagendarEventoCalendario: ToolDefinition<
  ReagendarEventoCalendarioInput,
  ReagendarEventoCalendarioOutput
> = {
  name: TOOL_NAME,
  domain: 'calendar',
  description:
    'Usa esta tool quando o utilizador quer mover ou alterar o horário de um evento existente na agenda do Google Calendar. Recebe uma descrição do evento (query), um novo horário de início (ISO-8601) e, opcionalmente, um novo horário de fim. Se o fim for omitido, mantém a duração original.',
  inputSchema: ReagendarEventoCalendarioInputSchema,
  outputSchema: ReagendarEventoCalendarioOutputSchema,
  estimatedTokens: 140,

  preview(input) {
    const quando = formatInTimeZone(new Date(input.newStart), CALENDAR_TZ, "dd/MM/yyyy 'às' HH:mm");
    return `Vou reagendar '${input.query}' para ${quando}.`;
  },

  async execute(input, ctx: ToolExecutionContext): Promise<ReagendarEventoCalendarioOutput> {
    const accessToken = await getCalendarAccessToken(ctx, TOOL_NAME);

    const event = await searchEvent(accessToken, input.query);
    if (!event || typeof event.id !== 'string') {
      throw new ToolExecutionError(
        TOOL_NAME,
        new Error(`Não encontrei nenhum evento com '${input.query}'. Podes ser mais específico?`),
      );
    }

    const originalStart = boundToIso(event.start);
    const originalEnd = boundToIso(event.end);
    if (!originalStart || !originalEnd) {
      throw new ToolExecutionError(
        TOOL_NAME,
        new Error(
          `O evento '${event.summary ?? input.query}' não tem horários definidos que possa reagendar.`,
        ),
      );
    }

    // Se `newEnd` omitido, preserva a duração original.
    let newEnd = input.newEnd;
    if (!newEnd) {
      const durationMs = Date.parse(originalEnd) - Date.parse(originalStart);
      const newStartMs = Date.parse(input.newStart);
      const safeDuration = Number.isFinite(durationMs) && durationMs > 0 ? durationMs : 60 * 60 * 1000;
      newEnd = new Date((Number.isNaN(newStartMs) ? Date.now() : newStartMs) + safeDuration).toISOString();
    }

    let res: Response;
    try {
      res = await fetch(`${CALENDAR_EVENTS_ENDPOINT}/${encodeURIComponent(event.id)}`, {
        method: 'PATCH',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          start: { dateTime: input.newStart, timeZone: CALENDAR_TZ },
          end: { dateTime: newEnd, timeZone: CALENDAR_TZ },
        }),
      });
    } catch (err) {
      throw new ToolExecutionError(
        TOOL_NAME,
        new Error(
          `Falha de rede ao reagendar o evento na Google Calendar API: ${err instanceof Error ? err.message : 'erro desconhecido'}.`,
        ),
      );
    }

    if (!res.ok) {
      throw new ToolExecutionError(
        TOOL_NAME,
        new Error(`A Google Calendar API recusou reagendar o evento (HTTP ${res.status}).`),
      );
    }

    return {
      eventId: event.id,
      title: typeof event.summary === 'string' ? event.summary : input.query,
      originalStart,
      originalEnd,
      newStart: input.newStart,
      newEnd,
    };
  },

  async reverse(output): Promise<ReverseOpPayload> {
    return {
      kind: 'external_call',
      provider: 'google_calendar',
      operation: 'restore_event',
      eventId: output.eventId,
      originalStart: output.originalStart,
      originalEnd: output.originalEnd,
    };
  },
};
