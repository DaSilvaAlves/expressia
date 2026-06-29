/**
 * Tool `consultar_emails` — lê e resume emails da caixa de entrada do Gmail
 * (Story J-6). Tool **read-only** — primeira capacidade de LEITURA de email do
 * Jarvis.
 *
 * Domínio: `email`. Sem efeito destrutivo — não força `needs_confirmation`.
 *
 * **Excepção justificada à regra "no HTTP in execute" (Dev Notes J-5/J-6):** a
 * Gmail API é externa ao Postgres — não participa na transacção. A chamada HTTP
 * ocorre dentro de `execute()` por necessidade arquitectural (mesmo trade-off que
 * as calendar tools). Sendo read-only, não há side-effect a reverter — o
 * reverse_op é a sentinela inerte `_noop` (R1b v1.1, idêntico a `listar-tarefas`).
 *
 * RLS (NFR5): `ctx.db` é cliente authenticated — a leitura de `google_oauth_tokens`
 * (em `getGmailAccessToken`) é filtrada por `household_id` via RLS. NUNCA usa
 * `getServiceDb()`.
 *
 * Privacidade: os emails são processados em memória e descartados; NUNCA são
 * persistidos em DB (PRD §7 — "a confiança é o produto").
 *
 * Trace: Story J-6 AC7 + AC12, PRD-Jarvis §9 (roadmap v1.1 Gmail).
 */
import { randomUUID } from 'node:crypto';

import { z } from 'zod';

import {
  ToolExecutionError,
  type ReverseOpPayload,
  type ToolDefinition,
  type ToolExecutionContext,
} from '@meu-jarvis/tools';

import {
  GMAIL_API_ENDPOINT,
  extractEmailHeader,
  getGmailAccessToken,
  isGmailListItem,
  isGmailMessageDetail,
  type GmailMessageMetadata,
} from './gmail-api';

const TOOL_NAME = 'consultar_emails';

/** Default de mensagens a devolver quando `maxResults` é omitido. */
const DEFAULT_MAX_RESULTS = 5;

/** Pesquisa Gmail por defeito (sem query): emails não lidos da caixa de entrada. */
const DEFAULT_QUERY = 'is:unread in:inbox';

// ─────────────────────────────────────────────────────────────────────────────
// Schemas
// ─────────────────────────────────────────────────────────────────────────────

// [D-J6.1] `maxResults` é `.optional()` SEM `.default()` — `ZodDefault` quebra
// `z.ZodType<I>` em `ToolDefinition<I,O>` (lição D-2.14.1: o input vira opcional
// mas o output obrigatório → tipos assimétricos). O default 5 é aplicado em
// `execute()`/`preview()`, tal como `listar-tarefas.ts` faz para o seu `limit`.
const ConsultarEmailsInputSchema = z.object({
  query: z.string().optional(),
  maxResults: z.number().int().min(1).max(10).optional(),
});

export type ConsultarEmailsInput = z.infer<typeof ConsultarEmailsInputSchema>;

const GmailMessageMetadataSchema = z.object({
  id: z.string(),
  subject: z.string(),
  from: z.string(),
  receivedAt: z.string(),
  snippet: z.string(),
});

const ConsultarEmailsOutputSchema = z.array(GmailMessageMetadataSchema);

export type ConsultarEmailsOutput = z.infer<typeof ConsultarEmailsOutputSchema>;

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

/** Shape mínima da resposta de `GET /messages?q=...` que consumimos. */
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

// ─────────────────────────────────────────────────────────────────────────────
// Tool definition
// ─────────────────────────────────────────────────────────────────────────────

export const consultarEmails: ToolDefinition<ConsultarEmailsInput, ConsultarEmailsOutput> = {
  name: TOOL_NAME,
  domain: 'email',
  description:
    'Usa esta tool quando o utilizador quer ler, ver, procurar ou consultar emails da sua caixa de entrada do Gmail. Sem pesquisa específica, mostra os emails não lidos recentes. Com pesquisa (campo query), filtra usando a sintaxe do Gmail (ex.: "from:pedro", "subject:factura"). Tool de leitura — não envia, apaga nem altera emails.',
  inputSchema: ConsultarEmailsInputSchema,
  outputSchema: ConsultarEmailsOutputSchema,
  estimatedTokens: 200,

  preview(input) {
    if (input.query && input.query.trim().length > 0) {
      return `Vou procurar emails sobre '${input.query}' no Gmail.`;
    }
    return 'Vou procurar os teus emails recentes no Gmail.';
  },

  async execute(input, ctx: ToolExecutionContext): Promise<ConsultarEmailsOutput> {
    const accessToken = await getGmailAccessToken(ctx, TOOL_NAME);

    const query = input.query && input.query.trim().length > 0 ? input.query : DEFAULT_QUERY;
    const maxResults = input.maxResults ?? DEFAULT_MAX_RESULTS;

    // 1. Lista os ids das mensagens que casam com a pesquisa.
    const listParams = new URLSearchParams({ q: query, maxResults: String(maxResults) });
    let listRes: Response;
    try {
      listRes = await fetch(`${GMAIL_API_ENDPOINT}/messages?${listParams.toString()}`, {
        headers: { Authorization: `Bearer ${accessToken}` },
      });
    } catch (err) {
      throw new ToolExecutionError(
        TOOL_NAME,
        new Error(
          `Falha de rede ao contactar a Gmail API: ${err instanceof Error ? err.message : 'erro desconhecido'}.`,
        ),
      );
    }

    if (!listRes.ok) {
      throw new ToolExecutionError(
        TOOL_NAME,
        new Error(`A Gmail API recusou listar os emails (HTTP ${listRes.status}).`),
      );
    }

    const listData: unknown = await listRes.json().catch(() => null);
    const items = extractListItems(listData);

    // Resultado vazio é válido — devolve [] sem lançar.
    if (items.length === 0) {
      return [];
    }

    // 2. Para cada id, lê os metadados (Subject/From/Date) e o snippet.
    const emails: GmailMessageMetadata[] = [];
    for (const item of items.slice(0, maxResults)) {
      if (!isGmailListItem(item)) {
        continue;
      }

      const detailParams = new URLSearchParams({ format: 'metadata' });
      detailParams.append('metadataHeaders', 'Subject');
      detailParams.append('metadataHeaders', 'From');
      detailParams.append('metadataHeaders', 'Date');

      let detailRes: Response;
      try {
        detailRes = await fetch(
          `${GMAIL_API_ENDPOINT}/messages/${item.id}?${detailParams.toString()}`,
          { headers: { Authorization: `Bearer ${accessToken}` } },
        );
      } catch (err) {
        throw new ToolExecutionError(
          TOOL_NAME,
          new Error(
            `Falha de rede ao ler o email ${item.id} da Gmail API: ${err instanceof Error ? err.message : 'erro desconhecido'}.`,
          ),
        );
      }

      if (!detailRes.ok) {
        throw new ToolExecutionError(
          TOOL_NAME,
          new Error(`A Gmail API recusou ler um email (HTTP ${detailRes.status}).`),
        );
      }

      const detail: unknown = await detailRes.json().catch(() => null);
      if (!isGmailMessageDetail(detail)) {
        continue;
      }

      emails.push({
        id: detail.id,
        subject: extractEmailHeader(detail.payload.headers, 'Subject'),
        from: extractEmailHeader(detail.payload.headers, 'From'),
        receivedAt: extractEmailHeader(detail.payload.headers, 'Date'),
        snippet: detail.snippet,
      });
    }

    return emails;
  },

  /**
   * Sentinela inerte `_noop` (R1b v1.1).
   *
   * Tool read-only — FR6 undo conceptualmente não-aplicável. `executeAtomic`
   * força persistência de uma row em `agent_reverse_ops`; usamos `table='_noop'`
   * + UUID válido para satisfazer `ReverseOpDeleteRowSchema` sem permitir undo
   * real. O endpoint `/undo` responde 410 Gone para `table = '_noop'`
   * (comportamento já existente). Idêntico a `listar-tarefas.ts` L187-193.
   */
  async reverse(): Promise<ReverseOpPayload> {
    return {
      kind: 'delete_row',
      table: '_noop',
      id: randomUUID(),
    };
  },
};
