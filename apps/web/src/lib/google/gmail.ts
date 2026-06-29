/**
 * Gmail API — resumo dos emails não lidos para o brief diário (Story J-6 AC9).
 *
 * `getGmailSummaryForBrief(args)` decifra o refresh_token (via `refreshAccessToken`,
 * inline — NÃO usa `ctx.db`, pois é chamada fora da transacção do motor), lê os
 * emails não lidos da caixa de entrada (`is:unread in:inbox`) e devolve metadados
 * normalizados.
 *
 * FALLBACK GRACIOSO (padrão de resiliência J-4 §4.4 — "o brief nunca falha por
 * causa de uma fonte"): qualquer erro (rede, token, API, parse) devolve
 * `{ emails: [], error }` **sem lançar**. O brief continua sem a secção de email.
 *
 * Privacidade: subject/from/snippet NUNCA são logados pelo caller — só contagens
 * (padrão J-3 AC9). Esta função não loga conteúdo. Emails nunca são persistidos.
 *
 * Self-contained (sem importar a camada de tools, mesmo padrão que `calendar.ts`)
 * — type guards próprios sobre `unknown`, sem `any`.
 *
 * Trace: Story J-6 AC9, PRD-Jarvis §4.4 (fallback gracioso).
 */
import { refreshAccessToken } from '@/lib/google/oauth';

const GMAIL_ENDPOINT = 'https://www.googleapis.com/gmail/v1/users/me';

/** Default de emails não lidos a resumir no brief. */
const DEFAULT_BRIEF_MAX = 3;

/** Item de email normalizado para o brief. */
export interface GmailBriefItem {
  readonly subject: string;
  readonly from: string;
  readonly receivedAt: string;
  readonly snippet: string;
}

interface GetGmailSummaryArgs {
  readonly encryptedRefreshToken: string;
  readonly tokenIv: string;
  readonly tokenAuthTag: string;
  readonly maxResults?: number;
}

interface GmailListResponse {
  readonly messages?: unknown[];
}

function extractListItems(data: unknown): unknown[] {
  if (typeof data !== 'object' || data === null) {
    return [];
  }
  const messages = (data as GmailListResponse).messages;
  return Array.isArray(messages) ? messages : [];
}

function isListItem(value: unknown): value is { id: string } {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  const item = value as Record<string, unknown>;
  return typeof item.id === 'string' && item.id.length > 0;
}

function isMessageDetail(
  value: unknown,
): value is { snippet: string; payload: { headers: unknown[] } } {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  const msg = value as Record<string, unknown>;
  if (typeof msg.snippet !== 'string') {
    return false;
  }
  const payload = msg.payload;
  if (typeof payload !== 'object' || payload === null) {
    return false;
  }
  return Array.isArray((payload as Record<string, unknown>).headers);
}

/** Extrai um cabeçalho (`Subject`/`From`/`Date`) case-insensitive — sem `any`. */
function extractHeader(headers: unknown[], name: string): string {
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

/**
 * Lê os emails não lidos da caixa de entrada e devolve um resumo para o brief.
 * NUNCA lança — qualquer falha resulta em `{ emails: [], error }`.
 */
export async function getGmailSummaryForBrief(
  args: GetGmailSummaryArgs,
): Promise<{ emails: GmailBriefItem[]; error?: string }> {
  try {
    const { accessToken } = await refreshAccessToken(
      args.encryptedRefreshToken,
      args.tokenIv,
      args.tokenAuthTag,
    );

    const maxResults = args.maxResults ?? DEFAULT_BRIEF_MAX;
    const listParams = new URLSearchParams({
      q: 'is:unread in:inbox',
      maxResults: String(maxResults),
    });

    const listRes = await fetch(`${GMAIL_ENDPOINT}/messages?${listParams.toString()}`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!listRes.ok) {
      return { emails: [], error: `Gmail API recusou listar emails (HTTP ${listRes.status}).` };
    }

    const listData: unknown = await listRes.json();
    const items = extractListItems(listData);
    if (items.length === 0) {
      return { emails: [] };
    }

    const emails: GmailBriefItem[] = [];
    for (const item of items.slice(0, maxResults)) {
      if (!isListItem(item)) {
        continue;
      }
      const detailParams = new URLSearchParams({ format: 'metadata' });
      detailParams.append('metadataHeaders', 'Subject');
      detailParams.append('metadataHeaders', 'From');
      detailParams.append('metadataHeaders', 'Date');

      const detailRes = await fetch(
        `${GMAIL_ENDPOINT}/messages/${item.id}?${detailParams.toString()}`,
        { headers: { Authorization: `Bearer ${accessToken}` } },
      );
      if (!detailRes.ok) {
        // Best-effort: um email indisponível não derruba o resumo todo.
        continue;
      }

      const detail: unknown = await detailRes.json();
      if (!isMessageDetail(detail)) {
        continue;
      }

      emails.push({
        subject: extractHeader(detail.payload.headers, 'Subject'),
        from: extractHeader(detail.payload.headers, 'From'),
        receivedAt: extractHeader(detail.payload.headers, 'Date'),
        snippet: detail.snippet,
      });
    }

    return { emails };
  } catch (err) {
    // Fallback gracioso — emails indisponíveis (rede, token, parse).
    return { emails: [], error: err instanceof Error ? err.message : 'erro desconhecido' };
  }
}
