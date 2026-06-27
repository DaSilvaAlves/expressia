/**
 * Tool `criar_evento_calendario` — cria um evento no Google Calendar (Story J-5).
 *
 * Domínio: `calendar`. Primeira capacidade de ESCRITA externa do Jarvis.
 *
 * **Excepção justificada à regra "no HTTP in execute" (Dev Notes):** a Google
 * Calendar API é externa ao Postgres — não participa na transacção. A chamada
 * HTTP ocorre dentro de `execute()` por necessidade arquitectural. A operação não
 * é 100% atómica (se o HTTP tiver sucesso mas o Postgres falhar depois, o evento
 * fica órfão no Calendar), mas o trade-off é aceitável para v1.1: baixa frequência
 * + undo de 30s disponível (DELETE do evento criado).
 *
 * RLS (NFR5): `ctx.db` é cliente authenticated — a leitura de `google_oauth_tokens`
 * é filtrada por `household_id` via RLS/app-enforced. NUNCA usa `getServiceDb()`.
 *
 * Trace: Story J-5 AC6 + AC10, PRD-Jarvis §9 (roadmap v1.1 Calendar escrita).
 */
import { formatInTimeZone, fromZonedTime } from 'date-fns-tz';
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
  stripToLisbonNaive,
  addMsToLisbonNaive,
} from './calendar-api';

const TOOL_NAME = 'criar_evento_calendario';

/** Duração padrão (1h) quando `end` é omitido. */
const DEFAULT_DURATION_MS = 60 * 60 * 1000;

// ─────────────────────────────────────────────────────────────────────────────
// Schemas
// ─────────────────────────────────────────────────────────────────────────────

// Schema permissivo: aceita wall-clock LOCAL naïve (`YYYY-MM-DDTHH:MM:SS`, o
// formato que o Planner v7 produz) E, por robustez, strings com 'Z'/offset ou
// fracção de segundo. O `execute`/`preview` normalizam tudo para naïve Lisboa via
// `stripToLisbonNaive` antes de enviar à Google (ver calendar-api.ts).
const CALENDAR_DATETIME_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?(\.\d+)?(Z|[+-]\d{2}:\d{2})?$/;
const calendarDateTime = z
  .string()
  .regex(CALENDAR_DATETIME_RE, 'Horário inválido — esperava ISO YYYY-MM-DDTHH:MM:SS.');

const CriarEventoCalendarioInputSchema = z.object({
  title: z.string().min(1),
  start: calendarDateTime,
  end: calendarDateTime.optional(),
  description: z.string().optional(),
});

export type CriarEventoCalendarioInput = z.infer<typeof CriarEventoCalendarioInputSchema>;

const CriarEventoCalendarioOutputSchema = z.object({
  eventId: z.string().min(1),
  title: z.string(),
  start: z.string(),
  end: z.string(),
});

export type CriarEventoCalendarioOutput = z.infer<typeof CriarEventoCalendarioOutputSchema>;

// ─────────────────────────────────────────────────────────────────────────────
// Tool definition
// ─────────────────────────────────────────────────────────────────────────────

export const criarEventoCalendario: ToolDefinition<
  CriarEventoCalendarioInput,
  CriarEventoCalendarioOutput
> = {
  name: TOOL_NAME,
  domain: 'calendar',
  description:
    'Usa esta tool quando o utilizador quer criar, marcar ou agendar um novo evento na agenda do Google Calendar. Recebe um título, um horário de início (ISO-8601) e, opcionalmente, um horário de fim e uma descrição. Se o fim for omitido, assume 1 hora de duração.',
  inputSchema: CriarEventoCalendarioInputSchema,
  outputSchema: CriarEventoCalendarioOutputSchema,
  estimatedTokens: 120,

  preview(input) {
    // `input.start` pode ser naïve (sem fuso); interpretá-lo como hora de Lisboa
    // (não como TZ do servidor, que é UTC na Vercel) antes de formatar.
    const startNaive = stripToLisbonNaive(input.start, TOOL_NAME);
    const quando = formatInTimeZone(
      fromZonedTime(startNaive, CALENDAR_TZ),
      CALENDAR_TZ,
      "dd/MM/yyyy 'às' HH:mm",
    );
    return `Vou criar o evento '${input.title}' no dia ${quando}.`;
  },

  async execute(input, ctx: ToolExecutionContext): Promise<CriarEventoCalendarioOutput> {
    const accessToken = await getCalendarAccessToken(ctx, TOOL_NAME);

    // Normaliza para wall-clock LOCAL de Lisboa (sem 'Z'/offset) — a Google
    // resolve o instante via `timeZone` (incl. DST). Ver calendar-api.ts.
    const startNaive = stripToLisbonNaive(input.start, TOOL_NAME);
    const endNaive = input.end
      ? stripToLisbonNaive(input.end, TOOL_NAME)
      : addMsToLisbonNaive(startNaive, DEFAULT_DURATION_MS);

    let res: Response;
    try {
      res = await fetch(CALENDAR_EVENTS_ENDPOINT, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          summary: input.title,
          ...(input.description ? { description: input.description } : {}),
          start: { dateTime: startNaive, timeZone: CALENDAR_TZ },
          end: { dateTime: endNaive, timeZone: CALENDAR_TZ },
        }),
      });
    } catch (err) {
      throw new ToolExecutionError(
        TOOL_NAME,
        new Error(
          `Falha de rede ao contactar a Google Calendar API: ${err instanceof Error ? err.message : 'erro desconhecido'}.`,
        ),
      );
    }

    if (!res.ok) {
      throw new ToolExecutionError(
        TOOL_NAME,
        new Error(`A Google Calendar API recusou criar o evento (HTTP ${res.status}).`),
      );
    }

    const data: unknown = await res.json().catch(() => null);
    if (!isGoogleCalendarItem(data) || typeof data.id !== 'string' || data.id.length === 0) {
      throw new ToolExecutionError(
        TOOL_NAME,
        new Error('A Google Calendar API não devolveu o identificador do evento criado.'),
      );
    }

    return {
      eventId: data.id,
      title: typeof data.summary === 'string' ? data.summary : input.title,
      // Os valores da Google vêm com offset correcto; fallback para o naïve enviado.
      start: boundToIso(data.start) ?? startNaive,
      end: boundToIso(data.end) ?? endNaive,
    };
  },

  async reverse(output): Promise<ReverseOpPayload> {
    return {
      kind: 'external_call',
      provider: 'google_calendar',
      operation: 'delete_event',
      eventId: output.eventId,
    };
  },
};
