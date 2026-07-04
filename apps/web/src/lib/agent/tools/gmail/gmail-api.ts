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
import { randomUUID } from 'node:crypto';

import {
  ToolExecutionError,
  type ReverseOpPayload,
  type ToolExecutionContext,
} from '@meu-jarvis/tools';

import { getGoogleAccessToken } from '@/lib/google/access-token';

/**
 * Endpoint base da Gmail API para o utilizador autenticado (`me`). Sem fuso
 * horário — a Gmail API não usa `timeZone` nas chamadas (ao contrário da
 * Calendar API).
 */
export const GMAIL_API_ENDPOINT = 'https://www.googleapis.com/gmail/v1/users/me';

/**
 * Wrapper fino sobre `getGoogleAccessToken` para as gmail tools — mesma query,
 * mesmo `refreshAccessToken` (partilhados em `@/lib/google/access-token`, tal
 * como `getCalendarAccessToken`). Lança `ToolExecutionError` PT-PT se não houver
 * token conectado.
 *
 * @param ctx - contexto de execução da tool (db da transacção + ids).
 * @param toolName - nome da tool (para o erro estruturado).
 */
export async function getGmailAccessToken(
  ctx: ToolExecutionContext,
  toolName: string,
): Promise<string> {
  const token = await getGoogleAccessToken(ctx.db, ctx.householdId, ctx.userId);
  if (token === null) {
    throw new ToolExecutionError(
      toolName,
      new Error('Precisas de conectar o Gmail. Acede a /api/google/auth-url.'),
    );
  }
  return token;
}

/**
 * Extrai o array `messages[]` de uma resposta de listagem da Gmail API
 * (`GET /messages?q=...`), tolerante a payloads inesperados: qualquer coisa que
 * não seja `{ messages: unknown[] }` devolve `[]`. Partilhado por `listar_emails`
 * e pela resolução de reply (`resolve-reply-target.ts`).
 */
export function extractGmailListMessages(data: unknown): unknown[] {
  if (typeof data !== 'object' || data === null) {
    return [];
  }
  const messages = (data as Record<string, unknown>).messages;
  return Array.isArray(messages) ? messages : [];
}

/**
 * Reverse-op sentinela inerte `_noop` (R1b v1.1) — partilhado pelas tools Gmail
 * sem undo real (`listar_emails`, `enviar_email`, `responder_email`).
 * `executeAtomic` força persistência de uma row em `agent_reverse_ops`; a
 * `table='_noop'` + UUID válido satisfaz `ReverseOpDeleteRowSchema` sem permitir
 * undo real — o endpoint `/undo` responde 410 Gone para `table = '_noop'`.
 */
export function noopReverseOp(): ReverseOpPayload {
  return {
    kind: 'delete_row',
    table: '_noop',
    id: randomUUID(),
  };
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
 *
 * Story J-8: passa a expor também o `threadId` top-level (já presente no JSON de
 * `GET /messages/{id}`, mas não capturado até aqui) — necessário para responder
 * na mesma thread. É OPCIONAL no type guard (backward-compatible: leituras J-6
 * que não precisam de threadId continuam a validar). Rejeita apenas se `threadId`
 * estiver presente mas não for string (sem `any`).
 */
export function isGmailMessageDetail(
  value: unknown,
): value is { id: string; snippet: string; threadId?: string; payload: { headers: unknown[] } } {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  const msg = value as Record<string, unknown>;
  if (typeof msg.id !== 'string' || typeof msg.snippet !== 'string') {
    return false;
  }
  if ('threadId' in msg && typeof msg.threadId !== 'undefined' && typeof msg.threadId !== 'string') {
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
 * Constrói uma mensagem MIME RFC 2822 de texto simples, codificada em
 * **base64url** (RFC 4648 §5: `+`→`-`, `/`→`_`, SEM padding `=`) pronta para o
 * campo `raw` de `users.messages.send`.
 *
 * O corpo é UTF-8 (charset declarado); os cabeçalhos com não-ASCII passam por
 * RFC 2047. As linhas são separadas por CRLF (RFC 2822). Sem dependências novas
 * — `Buffer.toString('base64url')` cobre a codificação.
 *
 * Story J-8 — threading: quando `inReplyTo`/`references` estão presentes, emite
 * os cabeçalhos RFC 2822 `In-Reply-To`/`References` (o cliente de email agrupa a
 * resposta com o email original). Ausentes (compose J-7) → comportamento idêntico
 * ao anterior (regressão zero — sem estes cabeçalhos).
 */
export function buildRawMimeMessage(args: {
  to: string;
  from: string;
  subject: string;
  body: string;
  inReplyTo?: string;
  references?: string;
}): string {
  const headers = [
    `To: ${args.to}`,
    `From: ${args.from}`,
    `Subject: ${encodeMimeHeaderValue(args.subject)}`,
  ];
  // Cabeçalhos de threading (Story J-8) — só quando presentes (reply). O
  // `Message-ID` é um token RFC 2822 (ex.: `<abc@mail.gmail.com>`), ASCII por
  // definição, pelo que não precisa de RFC 2047.
  if (args.inReplyTo && args.inReplyTo.trim().length > 0) {
    headers.push(`In-Reply-To: ${args.inReplyTo.trim()}`);
  }
  if (args.references && args.references.trim().length > 0) {
    headers.push(`References: ${args.references.trim()}`);
  }
  headers.push('Content-Type: text/plain; charset="UTF-8"', 'MIME-Version: 1.0');
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
 * Envia um email via `POST /messages/send`. Resolve o `From` a partir do perfil
 * da conta autenticada, constrói o MIME base64url e envia. Devolve
 * `{ id, threadId }` da mensagem enviada.
 *
 * Lança `ToolExecutionError` (com `cause` para observabilidade — lição J-6
 * hotfix `4e2b1c4`) em qualquer status não-OK ou resposta inesperada. O nome da
 * tool no erro é `toolName` (default `enviar_email`; `responder_email` na J-8).
 *
 * Story J-8 — reply em thread: quando `threadId`/`inReplyTo`/`references` estão
 * presentes, o MIME inclui os cabeçalhos `In-Reply-To`/`References` E o corpo do
 * POST inclui `threadId` (`{ raw, threadId }`). A Gmail API usa AMBOS os
 * cabeçalhos MIME e o campo `threadId` para agrupar a resposta na mesma thread.
 * Ausentes (compose J-7) → `{ raw }` sem cabeçalhos de reply (regressão zero).
 */
export async function sendGmailMessage(
  accessToken: string,
  args: {
    to: string;
    subject: string;
    body: string;
    threadId?: string;
    inReplyTo?: string;
    references?: string;
    toolName?: string;
  },
): Promise<{ id: string; threadId: string }> {
  const toolName = args.toolName ?? 'enviar_email';
  const from = await getGmailSenderEmail(accessToken);
  const raw = buildRawMimeMessage({
    to: args.to,
    from,
    subject: args.subject,
    body: args.body,
    inReplyTo: args.inReplyTo,
    references: args.references,
  });

  // Corpo do POST: `threadId` só quando presente (reply). Reforça ao Gmail a
  // associação à thread, independentemente dos cabeçalhos MIME.
  const requestBody: { raw: string; threadId?: string } = { raw };
  if (args.threadId && args.threadId.trim().length > 0) {
    requestBody.threadId = args.threadId.trim();
  }

  let res: Response;
  try {
    res = await fetch(`${GMAIL_API_ENDPOINT}/messages/send`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(requestBody),
    });
  } catch (err) {
    throw new ToolExecutionError(
      toolName,
      new Error(
        `Falha de rede ao enviar o email pela Gmail API: ${err instanceof Error ? err.message : 'erro desconhecido'}.`,
      ),
    );
  }

  if (!res.ok) {
    throw new ToolExecutionError(
      toolName,
      new Error(`A Gmail API recusou enviar o email (HTTP ${res.status}).`),
    );
  }

  const data: unknown = await res.json().catch(() => null);
  if (!isGmailSendResponse(data)) {
    throw new ToolExecutionError(
      toolName,
      new Error('A Gmail API não devolveu o identificador da mensagem enviada.'),
    );
  }

  return { id: data.id, threadId: data.threadId };
}
