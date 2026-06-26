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
import { sql } from 'drizzle-orm';

import { ToolExecutionError, type ToolExecutionContext } from '@meu-jarvis/tools';

import { refreshAccessToken } from '@/lib/google/oauth';

/** Fuso horário do mercado PT-PT (CON — Portugal continental). */
export const CALENDAR_TZ = 'Europe/Lisbon';

/** Endpoint base de eventos do calendário primário. */
export const CALENDAR_EVENTS_ENDPOINT =
  'https://www.googleapis.com/calendar/v3/calendars/primary/events';

/** Row mínima de `google_oauth_tokens` necessária para o refresh. */
interface TokenRow {
  readonly encrypted_refresh_token: string;
  readonly token_iv: string;
  readonly token_auth_tag: string;
}

function isTokenRow(value: unknown): value is TokenRow {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  const row = value as Record<string, unknown>;
  return (
    typeof row.encrypted_refresh_token === 'string' &&
    typeof row.token_iv === 'string' &&
    typeof row.token_auth_tag === 'string'
  );
}

/**
 * Lê `google_oauth_tokens` (RLS activa via `ctx.db` authenticated) para o
 * `(household_id, user_id)` do contexto e devolve um access_token fresco.
 *
 * Lança `ToolExecutionError` PT-PT se não houver token conectado.
 *
 * @param ctx - contexto de execução da tool (db da transacção + ids).
 * @param toolName - nome da tool (para o erro estruturado).
 */
export async function getCalendarAccessToken(
  ctx: ToolExecutionContext,
  toolName: string,
): Promise<string> {
  const rows = (await ctx.db.execute(sql`
    select encrypted_refresh_token, token_iv, token_auth_tag
    from public.google_oauth_tokens
    where household_id = ${ctx.householdId} and user_id = ${ctx.userId}
    limit 1
  `)) as ReadonlyArray<unknown>;

  const row = rows[0];
  if (!isTokenRow(row)) {
    throw new ToolExecutionError(
      toolName,
      new Error('Precisas de conectar o Google Calendar. Acede a /api/google/auth-url.'),
    );
  }

  const { accessToken } = await refreshAccessToken(
    row.encrypted_refresh_token,
    row.token_iv,
    row.token_auth_tag,
  );
  return accessToken;
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
