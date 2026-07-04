/**
 * Obtenção do access token Google OAuth — helper partilhado entre as calendar
 * tools (J-5), as gmail tools (J-6/J-7/J-8) e o endpoint de undo (J-5).
 *
 * Elimina 3 cópias idênticas da mesma query SQL + type guard + refreshAccessToken.
 * Callers mantêm as funções de conveniência (getCalendarAccessToken /
 * getGmailAccessToken) como wrappers finos — sem alterar as suas assinaturas.
 *
 * Trace: Refactor — dedupe access-token retrieval (items calendar-api.ts:54-79,
 * gmail-api.ts:59-84, undo/route.ts:481-526).
 */
import { sql } from 'drizzle-orm';

import { refreshAccessToken } from '@/lib/google/oauth';

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
 * Lê `google_oauth_tokens` e devolve um access_token fresco.
 *
 * - Devolve `null` se não existir row para `(household_id, user_id)`.
 * - Lança `Error` se `refreshAccessToken` falhar.
 *
 * O caller é responsável por mapear `null` para o seu protocolo de erro:
 *   - Tools: `ToolExecutionError` (ex.: getCalendarAccessToken / getGmailAccessToken).
 *   - Undo: `{ ok: false, reason: 'not_found' }`.
 *
 * Aceita qualquer cliente DB que exponha `execute(query) → Promise<unknown>`,
 * cobrindo tanto `DrizzleDbClient` (tools) como `DbShim` service_role (undo).
 *
 * @param db - cliente DB (authenticated RLS nas tools, service_role no undo).
 * @param householdId - household UUID.
 * @param userId - user UUID.
 */
export async function getGoogleAccessToken(
  db: { execute(query: unknown): Promise<unknown> },
  householdId: string,
  userId: string,
): Promise<string | null> {
  const rows = (await db.execute(sql`
    select encrypted_refresh_token, token_iv, token_auth_tag
    from public.google_oauth_tokens
    where household_id = ${householdId}::uuid and user_id = ${userId}::uuid
    limit 1
  `)) as ReadonlyArray<unknown>;

  const row = rows[0];
  if (!isTokenRow(row)) {
    return null;
  }

  const { accessToken } = await refreshAccessToken(
    row.encrypted_refresh_token,
    row.token_iv,
    row.token_auth_tag,
  );
  return accessToken;
}
