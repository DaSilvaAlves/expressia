/**
 * Helpers partilhados das gmail tools (Story J-6) — obtenção do accessToken
 * Google e type guards sobre as respostas da Gmail API.
 *
 * As gmail tools vivem em `apps/web` (NÃO em `packages/tools`) por direcção de
 * dependência: precisam de `@/lib/google/oauth` (`refreshAccessToken`), que
 * decifra o refresh_token (AES-256-GCM) e troca-o por um access_token. Colocar as
 * tools em `packages/tools` criaria um ciclo `tools → apps/web → tools`. Mesma
 * justificação que `calendar-api.ts` (Story J-5).
 *
 * Sem `any` — toda a leitura das respostas JSON da Gmail API passa por type
 * guards sobre `unknown`.
 *
 * Trace: Story J-6 AC6, Dev Notes "gmail-api.ts — diferenças face a calendar-api.ts".
 */
import { sql } from 'drizzle-orm';

import { ToolExecutionError, type ToolExecutionContext } from '@meu-jarvis/tools';

import { refreshAccessToken } from '@/lib/google/oauth';

/**
 * Endpoint base da Gmail API para o utilizador autenticado (`me`). Sem fuso
 * horário — a Gmail API não usa `timeZone` nas chamadas (ao contrário da
 * Calendar API).
 */
export const GMAIL_API_ENDPOINT = 'https://www.googleapis.com/gmail/v1/users/me';

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
 * Idêntico a `getCalendarAccessToken` (calendar-api.ts) — mesma query, mesmo
 * `refreshAccessToken`, mesmo tratamento de erro. Lança `ToolExecutionError`
 * PT-PT se não houver token conectado.
 *
 * @param ctx - contexto de execução da tool (db da transacção + ids).
 * @param toolName - nome da tool (para o erro estruturado).
 */
export async function getGmailAccessToken(
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
      new Error('Precisas de conectar o Gmail. Acede a /api/google/auth-url.'),
    );
  }

  const { accessToken } = await refreshAccessToken(
    row.encrypted_refresh_token,
    row.token_iv,
    row.token_auth_tag,
  );
  return accessToken;
}

/** Metadados de um email devolvidos pela tool / brief (já normalizados). */
export interface GmailMessageMetadata {
  readonly id: string;
  readonly subject: string;
  readonly from: string;
  readonly receivedAt: string;
  readonly snippet: string;
}

/**
 * Type guard sobre um item da lista `messages[]` da Gmail API
 * (`GET /messages?q=...`). Cada item tem pelo menos `{ id: string }`.
 */
export function isGmailListItem(value: unknown): value is { id: string } {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  const item = value as Record<string, unknown>;
  return typeof item.id === 'string' && item.id.length > 0;
}

/**
 * Type guard sobre o detalhe de uma mensagem
 * (`GET /messages/{id}?format=metadata`). Tem `id`, `snippet` e
 * `payload.headers` (array).
 */
export function isGmailMessageDetail(
  value: unknown,
): value is { id: string; snippet: string; payload: { headers: unknown[] } } {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  const msg = value as Record<string, unknown>;
  if (typeof msg.id !== 'string' || typeof msg.snippet !== 'string') {
    return false;
  }
  const payload = msg.payload;
  if (typeof payload !== 'object' || payload === null) {
    return false;
  }
  return Array.isArray((payload as Record<string, unknown>).headers);
}

/**
 * Extrai o valor de um cabeçalho (`Subject`, `From`, `Date`) do array
 * `payload.headers` da Gmail API, de forma case-insensitive. Devolve string
 * vazia se o cabeçalho não existir.
 *
 * Cada header tem a forma `{ name: string; value: string }`. Acessos sobre
 * `unknown` são guardados por type-narrowing — sem `any`.
 */
export function extractEmailHeader(headers: unknown[], name: string): string {
  const target = name.toLowerCase();
  for (const header of headers) {
    if (typeof header !== 'object' || header === null) {
      continue;
    }
    const h = header as Record<string, unknown>;
    if (typeof h.name === 'string' && h.name.toLowerCase() === target) {
      return typeof h.value === 'string' ? h.value : '';
    }
  }
  return '';
}
