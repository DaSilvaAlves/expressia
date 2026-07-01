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

// ─────────────────────────────────────────────────────────────────────────────
// Gmail SEND (Story J-7) — compose-only (reply em v2)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Resposta de `POST /messages/send` que consumimos: `{ id, threadId }`.
 */
export function isGmailSendResponse(value: unknown): value is { id: string; threadId: string } {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  const msg = value as Record<string, unknown>;
  return (
    typeof msg.id === 'string' &&
    msg.id.length > 0 &&
    typeof msg.threadId === 'string' &&
    msg.threadId.length > 0
  );
}

/** Resposta de `GET /profile` — só consumimos `emailAddress`. */
function isGmailProfile(value: unknown): value is { emailAddress: string } {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  const p = value as Record<string, unknown>;
  return typeof p.emailAddress === 'string' && p.emailAddress.length > 0;
}

/**
 * `true` se `value` contém apenas caracteres ASCII (US-ASCII, code points ≤ 127).
 * Usado para decidir se um cabeçalho precisa de RFC 2047 encoded-word.
 */
function isAscii(value: string): boolean {
  // eslint-disable-next-line no-control-regex
  return /^[\x00-\x7F]*$/.test(value);
}

/**
 * Codifica o valor de um cabeçalho MIME. Se contiver caracteres não-ASCII
 * (acentos PT-PT como "Reunião"), aplica RFC 2047 encoded-word em Base64 UTF-8
 * (`=?UTF-8?B?...?=`); caso contrário devolve o valor tal-e-qual. Necessário
 * porque os cabeçalhos RFC 2822 são, por defeito, US-ASCII — um Subject com
 * acentos sem encoding produziria mojibake no cliente de email.
 */
function encodeMimeHeaderValue(value: string): string {
  if (isAscii(value)) {
    return value;
  }
  return `=?UTF-8?B?${Buffer.from(value, 'utf-8').toString('base64')}?=`;
}

/**
 * Constrói uma mensagem MIME RFC 2822 de texto simples (compose-only — v1; sem
 * cabeçalhos de reply `In-Reply-To`/`References`, que ficam para v2), codificada
 * em **base64url** (RFC 4648 §5: `+`→`-`, `/`→`_`, SEM padding `=`) pronta para
 * o campo `raw` de `users.messages.send`.
 *
 * O corpo é UTF-8 (charset declarado); os cabeçalhos com não-ASCII passam por
 * RFC 2047. As linhas são separadas por CRLF (RFC 2822). Sem dependências novas
 * — `Buffer.toString('base64url')` cobre a codificação.
 */
export function buildRawMimeMessage(args: {
  to: string;
  from: string;
  subject: string;
  body: string;
}): string {
  const headers = [
    `To: ${args.to}`,
    `From: ${args.from}`,
    `Subject: ${encodeMimeHeaderValue(args.subject)}`,
    'Content-Type: text/plain; charset="UTF-8"',
    'MIME-Version: 1.0',
  ];
  // Corpo normalizado para CRLF; cabeçalhos separados do corpo por linha em branco.
  const normalizedBody = args.body.replace(/\r\n/g, '\n').replace(/\n/g, '\r\n');
  const mime = `${headers.join('\r\n')}\r\n\r\n${normalizedBody}`;
  return Buffer.from(mime, 'utf-8').toString('base64url');
}

/**
 * Lê o endereço de email da conta Google autenticada (`GET /profile`) para o
 * usar no cabeçalho `From`. A Gmail API garante que o `From` de um envio é
 * sempre a conta autenticada — resolver o email explicitamente produz um MIME
 * correcto e legível no cliente. Lança em caso de falha (o caller envolve em
 * `ToolExecutionError`).
 */
async function getGmailSenderEmail(accessToken: string): Promise<string> {
  let res: Response;
  try {
    res = await fetch(`${GMAIL_API_ENDPOINT}/profile`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
  } catch (err) {
    throw new Error(
      `Falha de rede ao ler o perfil do Gmail: ${err instanceof Error ? err.message : 'erro desconhecido'}.`,
    );
  }
  if (!res.ok) {
    throw new Error(`A Gmail API recusou ler o perfil da conta (HTTP ${res.status}).`);
  }
  const data: unknown = await res.json().catch(() => null);
  if (!isGmailProfile(data)) {
    throw new Error('A Gmail API não devolveu o endereço da conta autenticada.');
  }
  return data.emailAddress;
}

/**
 * Envia um email novo (compose) via `POST /messages/send`. Resolve o `From` a
 * partir do perfil da conta autenticada, constrói o MIME base64url e envia.
 * Devolve `{ id, threadId }` da mensagem enviada.
 *
 * Lança `ToolExecutionError` (com `cause` para observabilidade — lição J-6
 * hotfix `4e2b1c4`) em qualquer status não-OK ou resposta inesperada.
 *
 * Reply em thread (`threadId`/`In-Reply-To`) fica para v2 — ver Contexto de
 * âmbito da story J-7.
 */
export async function sendGmailMessage(
  accessToken: string,
  args: { to: string; subject: string; body: string },
): Promise<{ id: string; threadId: string }> {
  const from = await getGmailSenderEmail(accessToken);
  const raw = buildRawMimeMessage({
    to: args.to,
    from,
    subject: args.subject,
    body: args.body,
  });

  let res: Response;
  try {
    res = await fetch(`${GMAIL_API_ENDPOINT}/messages/send`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ raw }),
    });
  } catch (err) {
    throw new ToolExecutionError(
      'enviar_email',
      new Error(
        `Falha de rede ao enviar o email pela Gmail API: ${err instanceof Error ? err.message : 'erro desconhecido'}.`,
      ),
    );
  }

  if (!res.ok) {
    throw new ToolExecutionError(
      'enviar_email',
      new Error(`A Gmail API recusou enviar o email (HTTP ${res.status}).`),
    );
  }

  const data: unknown = await res.json().catch(() => null);
  if (!isGmailSendResponse(data)) {
    throw new ToolExecutionError(
      'enviar_email',
      new Error('A Gmail API não devolveu o identificador da mensagem enviada.'),
    );
  }

  return { id: data.id, threadId: data.threadId };
}
