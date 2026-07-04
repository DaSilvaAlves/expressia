/**
 * Helpers partilhados das calendar tools (Story J-5) — obtenção do accessToken
 * Google e type guards sobre as respostas da Google Calendar API.
 *
 * As calendar tools vivem em `apps/web` (NÃO em `packages/tools`) por direcção de
 * dependência: precisam de `@/lib/google/oauth` (`refreshAccessToken`), que
 * decifra o refresh_token (AES-256-GCM) e troca-o por um access_token. Colocar as
 * tools em `packages/tools` criaria um ciclo `tools → apps/web → tools`.
 *
 * Trace: Story J-5 AC6/AC7, Dev Notes "Padrão de obtenção do accessToken".
 */
import { formatInTimeZone, fromZonedTime } from 'date-fns-tz';

import { ToolExecutionError, type ToolExecutionContext } from '@meu-jarvis/tools';

import { getGoogleAccessToken } from '@/lib/google/access-token';

/** Fuso horário do mercado PT-PT (CON — Portugal continental). */
export const CALENDAR_TZ = 'Europe/Lisbon';

/** Endpoint base de eventos do calendário primário. */
export const CALENDAR_EVENTS_ENDPOINT =
  'https://www.googleapis.com/calendar/v3/calendars/primary/events';

/**
 * Wrapper fino sobre `getGoogleAccessToken` para as calendar tools.
 * Lança `ToolExecutionError` PT-PT se não houver token conectado.
 *
 * @param ctx - contexto de execução da tool (db da transacção + ids).
 * @param toolName - nome da tool (para o erro estruturado).
 */
export async function getCalendarAccessToken(
  ctx: ToolExecutionContext,
  toolName: string,
): Promise<string> {
  const token = await getGoogleAccessToken(ctx.db, ctx.householdId, ctx.userId);
  if (token === null) {
    throw new ToolExecutionError(
      toolName,
      new Error('Precisas de conectar o Google Calendar. Acede a /api/google/auth-url.'),
    );
  }
  return token;
}

/** Limite de um evento devolvido pela Calendar API (`dateTime` ou `date`). */
export interface GoogleEventBound {
  readonly dateTime?: string;
  readonly date?: string;
}

/** Shape parcial de um evento da Google Calendar API que consumimos. */
export interface GoogleCalendarItem {
  readonly id?: string;
  readonly summary?: string;
  readonly start?: GoogleEventBound;
  readonly end?: GoogleEventBound;
}

/** Resolve a string ISO de um limite de evento (prefere `dateTime`). */
export function boundToIso(bound: GoogleEventBound | undefined): string | null {
  if (!bound) {
    return null;
  }
  if (typeof bound.dateTime === 'string' && bound.dateTime.length > 0) {
    return bound.dateTime;
  }
  if (typeof bound.date === 'string' && bound.date.length > 0) {
    return bound.date;
  }
  return null;
}

/** Type guard mínimo de um item de evento da Calendar API. */
export function isGoogleCalendarItem(value: unknown): value is GoogleCalendarItem {
  return typeof value === 'object' && value !== null;
}

// ─────────────────────────────────────────────────────────────────────────────
// Datetime helpers (bug-fix timezone J-5 — "10h virava 11h")
// ─────────────────────────────────────────────────────────────────────────────
//
// Padrão recomendado pela Google Calendar API para criar/reagendar eventos:
// enviar `dateTime` SEM offset (wall-clock local) + `timeZone: 'Europe/Lisbon'`,
// deixando a Google resolver o INSTANTE (incl. DST). Se o `dateTime` trouxer
// offset (`Z`/`+00:00`/`+01:00`), a Google usa esse instante e o `timeZone` só
// afecta o display → `10:00Z` aparece como 11:00 em Lisboa (horário de verão).

/**
 * Captura `YYYY-MM-DDTHH:MM` (segundos opcionais) no INÍCIO de uma string ISO,
 * descartando o sufixo de fuso (`Z`/offset) e qualquer fracção de segundo.
 */
const NAIVE_PREFIX_RE = /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2})(:\d{2})?/;

/**
 * Normaliza um ISO (com OU sem offset) para wall-clock local de Lisboa naïve
 * (`YYYY-MM-DDTHH:MM:SS`, sem 'Z' nem offset). Os segundos são forçados a `:00`
 * quando ausentes.
 *
 * **Assunção documentada:** o LLM escreve a hora LOCAL pretendida (os dígitos da
 * hora) e erra apenas no sufixo (anexa um 'Z'/offset indevido). Descartar o
 * sufixo preserva a intenção do utilizador — `10:00Z` e `10:00+01:00` ambos
 * passam a representar as 10:00 de Lisboa.
 *
 * @throws {ToolExecutionError} PT-PT se a string não casar com o formato ISO.
 */
export function stripToLisbonNaive(iso: string, toolName: string): string {
  const match = NAIVE_PREFIX_RE.exec(iso);
  if (!match) {
    throw new ToolExecutionError(
      toolName,
      new Error(`Horário inválido '${iso}': esperava o formato ISO YYYY-MM-DDTHH:MM:SS.`),
    );
  }
  const seconds = match[2] ?? ':00';
  return `${match[1]}${seconds}`;
}

/**
 * Soma `ms` milissegundos a um instante wall-clock local de Lisboa de forma
 * DST-safe e devolve novamente wall-clock naïve (`YYYY-MM-DDTHH:MM:SS`).
 *
 * `fromZonedTime` converte o naïve→instante UTC interpretando-o como hora de
 * Lisboa; somamos os `ms` ao instante e formatamos de volta no mesmo fuso.
 */
export function addMsToLisbonNaive(naive: string, ms: number): string {
  const instant = fromZonedTime(naive, CALENDAR_TZ).getTime() + ms;
  return formatInTimeZone(instant, CALENDAR_TZ, "yyyy-MM-dd'T'HH:mm:ss");
}

/**
 * Duração em ms entre dois ISO COM offset correcto (ex: os valores REAIS
 * devolvidos pela Google). NÃO usar sobre strings naïve — `Date.parse` destas é
 * ambíguo. Devolve `NaN` se algum valor for inválido (o chamador trata o
 * fallback).
 */
export function durationMsBetween(startIso: string, endIso: string): number {
  return Date.parse(endIso) - Date.parse(startIso);
}
