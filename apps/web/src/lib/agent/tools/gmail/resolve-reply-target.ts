/**
 * Story J-8 — resolução do email-alvo de uma resposta (`responder_email`).
 *
 * **Problema de design (ver story J-8 "Problema de design"):** `tool.preview()` é
 * síncrono e puro (contrato `ToolDefinition`) — não pode chamar a Gmail API para
 * descobrir "qual é o último email do Pedro". A resolução acontece por isso FORA
 * da tool, no pipeline (`run-agent.ts`), ANTES de o Planner correr — exactamente
 * como `buildAccountContext` resolve contas/cartões (Story 2.13 AC6).
 *
 * Este módulo pesquisa os N emails mais recentes do inbox (metadados apenas — SEM
 * corpo, mesma política de privacidade da J-6/J-7) e devolve uma shortlist de
 * candidatos `{ threadId, messageId, from, fromEmail, subject, receivedAt }`. O
 * Planner recebe esta shortlist como prefixo da user message e escolhe o candidato
 * certo a partir da referência em linguagem natural do utilizador ("o Pedro",
 * "aquele email da Ana"). Zero candidatos → o caller trata como zero-match honesto
 * (AC13) — NUNCA se inventa um `threadId`.
 *
 * Reutiliza a base J-6: `GMAIL_API_ENDPOINT`, `getGmailAccessToken`,
 * `isGmailListItem`, `isGmailMessageDetail`, `extractEmailHeader`. Query
 * `in:inbox` SEM `is:unread` — uma resposta pode ser a um email já lido.
 *
 * Sem `any` — toda a leitura das respostas JSON passa por type guards.
 *
 * Trace: Story J-8 AC5 + AC13, Dev Notes "Threading Gmail".
 */
import { type ToolExecutionContext } from '@meu-jarvis/tools';

import {
  GMAIL_API_ENDPOINT,
  extractEmailHeader,
  extractGmailListMessages,
  getGmailAccessToken,
  isGmailListItem,
  isGmailMessageDetail,
} from './gmail-api';

/** Nome da tool para efeitos de erro de token (`getGmailAccessToken`). */
const TOOL_NAME = 'responder_email';

/** Nº de candidatos recentes do inbox a considerar na shortlist. */
const DEFAULT_SHORTLIST_SIZE = 10;

/** Query Gmail da shortlist: emails do inbox (lidos ou não — reply a qualquer). */
const SHORTLIST_QUERY = 'in:inbox';

/**
 * Candidato da shortlist de resolução — metadados apenas (sem corpo).
 *
 * - `threadId` — id da thread Gmail (para agrupar a resposta).
 * - `messageId` — valor do cabeçalho RFC 2822 `Message-ID` (`<...>`) do email
 *   original; usado em `In-Reply-To`/`References`. DIFERENTE do `id` interno da
 *   Gmail API (hash não usável em cabeçalhos de threading).
 * - `from` — cabeçalho `From` bruto (ex.: `Pedro Silva <pedro@x.pt>`).
 * - `fromEmail` — endereço nu parseado do `from` (ex.: `pedro@x.pt`). OBRIGATÓRIO:
 *   o `to` da tool `responder_email` é `z.string().email()` e rejeita "Nome
 *   <email>"; a shortlist tem de expor o email limpo para o Planner popular `to`
 *   com um endereço válido (AC5 [PO]).
 * - `subject` — assunto do email original (para o `Re: `).
 * - `receivedAt` — cabeçalho `Date` do email original.
 */
export interface ReplyCandidate {
  readonly threadId: string;
  readonly messageId: string;
  readonly from: string;
  readonly fromEmail: string;
  readonly subject: string;
  readonly receivedAt: string;
}

/**
 * Story J-8 FIX (bug de produção 04/07/2026) — extrai TODOS os endereços de email
 * EXPLÍCITOS de um texto livre (o pedido em linguagem natural do utilizador).
 *
 * Usado pelo guardrail determinístico de `responder_email`: quando o utilizador
 * escreve um endereço concreto ("responde ao euricojoseia@gmail.com que ..."), o
 * `to` que o Planner escolher TEM de bater com um destes — caso contrário bloqueia-se
 * o envio (não se confia no LLM barato para casar endereços). Ver `run-agent.ts`
 * `checkExplicitReplyEmailGuard` + [D-J8.6].
 *
 * Regex simples e robusto (`local@dominio.tld`), com pós-limpeza dos bordos:
 *   - Remove pontuação/delimitadores agarrados à esquerda (`<`, `(`, aspas).
 *   - Remove pontuação de fim de frase agarrada à direita (`.`, `,`, `;`, `:`,
 *     `!`, `?`, `)`, `>`, `]`, aspas) — um endereço nunca termina nestes caracteres.
 * Normaliza para minúsculas (comparação case-insensitive) e elimina duplicados,
 * preservando a ordem da primeira ocorrência. Devolve `[]` quando não há emails
 * (ex.: referência por nome — "responde ao Pedro").
 */
export function extractExplicitEmailAddresses(text: string): string[] {
  const EMAIL_RE = /[^\s<>@]+@[^\s<>@]+\.[^\s<>@]+/g;
  const matches = text.match(EMAIL_RE);
  if (matches === null) {
    return [];
  }
  const seen = new Set<string>();
  const result: string[] = [];
  for (const raw of matches) {
    const cleaned = raw
      .trim()
      .replace(/^[<("'`]+/, '')
      .replace(/[.,;:!?)\]>"'`]+$/, '')
      .toLowerCase();
    // Sanidade mínima após a limpeza: tem de manter um `@` e um `.` no domínio.
    if (cleaned.length === 0 || !cleaned.includes('@') || !cleaned.includes('.')) {
      continue;
    }
    if (!seen.has(cleaned)) {
      seen.add(cleaned);
      result.push(cleaned);
    }
  }
  return result;
}

/**
 * Extrai o endereço de email nu de um cabeçalho `From` RFC 2822. Aceita as duas
 * formas comuns:
 *   - `Nome <email@dominio>` → `email@dominio` (conteúdo entre `<...>`).
 *   - `email@dominio` (endereço nu) → devolve tal-e-qual.
 * Devolve string vazia se não encontrar nada plausível (sem `@`).
 */
export function parseEmailAddress(from: string): string {
  const angle = from.match(/<([^>]+)>/);
  const candidate = (angle?.[1] ?? from).trim();
  // Sanidade mínima: um endereço tem de conter '@'. Sem regex de validação total
  // (o `z.string().email()` da tool é a validação canónica) — só limpamos.
  return candidate.includes('@') ? candidate : '';
}

/**
 * Resolve a shortlist de candidatos de resposta a partir do inbox do utilizador.
 *
 * Passos (mesma mecânica de `consultar_emails`/J-6, com `Message-ID` + `threadId`
 * adicionais):
 *   1. `GET /messages?q=in:inbox&maxResults=N` → ids das mensagens recentes.
 *   2. Para cada id: `GET /messages/{id}?format=metadata` pedindo
 *      `Subject`/`From`/`Date`/`Message-ID` → extrai metadados + `threadId`.
 *   3. Descarta candidatos sem `threadId`, `messageId` ou `fromEmail` (não é
 *      possível responder sem eles) — nunca se inventa nenhum.
 *
 * Devolve `[]` se o inbox estiver vazio ou nenhum candidato for válido — o caller
 * trata `[]` como zero-match honesto (AC13). Lança (via `getGmailAccessToken` ou
 * erro de rede) se o Gmail não estiver conectado / a API falhar — o caller
 * (`run-agent.ts`) apanha e degrada.
 *
 * @param ctx - contexto de execução (db authenticated + ids) para o token.
 * @param opts - `maxResults` (default 10) e `fetchImpl` (injecção em testes).
 */
export async function resolveReplyCandidates(
  ctx: ToolExecutionContext,
  opts?: { maxResults?: number; fetchImpl?: typeof fetch },
): Promise<ReplyCandidate[]> {
  const fetchImpl = opts?.fetchImpl ?? fetch;
  const maxResults = opts?.maxResults ?? DEFAULT_SHORTLIST_SIZE;

  const accessToken = await getGmailAccessToken(ctx, TOOL_NAME);

  // 1. Lista os ids das mensagens recentes do inbox.
  const listParams = new URLSearchParams({ q: SHORTLIST_QUERY, maxResults: String(maxResults) });
  const listRes = await fetchImpl(`${GMAIL_API_ENDPOINT}/messages?${listParams.toString()}`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!listRes.ok) {
    throw new Error(`A Gmail API recusou listar o inbox (HTTP ${listRes.status}).`);
  }
  const listData: unknown = await listRes.json().catch(() => null);
  const items = extractGmailListMessages(listData);
  if (items.length === 0) {
    return [];
  }

  // 2. Para cada id, lê metadados + threadId + Message-ID em paralelo.
  // Falhas individuais são ignoradas (null → filter) — um email com erro não
  // deve deitar abaixo toda a resolução (AC13).
  const detailParams = new URLSearchParams({ format: 'metadata' });
  detailParams.append('metadataHeaders', 'Subject');
  detailParams.append('metadataHeaders', 'From');
  detailParams.append('metadataHeaders', 'Date');
  detailParams.append('metadataHeaders', 'Message-ID');
  const detailQuery = detailParams.toString();

  const candidates: ReplyCandidate[] = (
    await Promise.all(
      items.slice(0, maxResults).map(async (item): Promise<ReplyCandidate | null> => {
        if (!isGmailListItem(item)) return null;
        try {
          const detailRes = await fetchImpl(
            `${GMAIL_API_ENDPOINT}/messages/${item.id}?${detailQuery}`,
            { headers: { Authorization: `Bearer ${accessToken}` } },
          );
          if (!detailRes.ok) return null;
          const detail: unknown = await detailRes.json().catch(() => null);
          if (!isGmailMessageDetail(detail)) return null;

          const threadId = typeof detail.threadId === 'string' ? detail.threadId : '';
          const messageId = extractEmailHeader(detail.payload.headers, 'Message-ID');
          const from = extractEmailHeader(detail.payload.headers, 'From');
          const fromEmail = parseEmailAddress(from);

          // 3. Só candidatos completos — sem inventar nada em falta (AC13).
          if (threadId.length === 0 || messageId.length === 0 || fromEmail.length === 0) {
            return null;
          }

          return {
            threadId,
            messageId,
            from,
            fromEmail,
            subject: extractEmailHeader(detail.payload.headers, 'Subject'),
            receivedAt: extractEmailHeader(detail.payload.headers, 'Date'),
          };
        } catch {
          return null;
        }
      }),
    )
  ).filter((c): c is ReplyCandidate => c !== null);

  return candidates;
}
