/**
 * Tool `enviar_email` — compõe e envia um email novo via Gmail API (Story J-7).
 * Tool de **ESCRITA externa IRREVERSÍVEL** — segunda capacidade de escrita
 * externa do Jarvis (após as calendar tools da J-5).
 *
 * Domínio: `email`. Compose-only (v1) — email novo, texto simples, 1 destinatário.
 * Resposta em thread (reply) fica para v2 (ver Contexto de âmbito da story).
 *
 * **Segurança — preview→confirm obrigatório:** o classifier força
 * `needs_confirmation: true` para o intent `enviar_email` (v6 AC3), pelo que o
 * envio só ocorre no route de confirmação, DEPOIS de o Eurico rever o rascunho
 * (Para/Assunto/Corpo). Não há "des-enviar" — a rede de segurança é o preview,
 * não o undo.
 *
 * **Excepção justificada à regra "no HTTP in execute" (Dev Notes J-5/J-6):** a
 * Gmail API é externa ao Postgres — não participa na transacção. A chamada HTTP
 * ocorre dentro de `execute()` por necessidade arquitectural (mesmo trade-off que
 * as calendar/gmail-readonly tools).
 *
 * RLS (NFR5): `ctx.db` é cliente authenticated — a leitura de `google_oauth_tokens`
 * (em `getGmailAccessToken`) é filtrada por `household_id` via RLS. NUNCA usa
 * `getServiceDb()`.
 *
 * Privacidade: o conteúdo do email é processado em memória e descartado; NUNCA é
 * persistido em DB (PRD §7 — "a confiança é o produto").
 *
 * `reverse()`: sentinela inerte `_noop` (R1b v1.1). Um email enviado NÃO é
 * revertível — o `/undo` responde 410 Gone.
 *
 * Trace: Story J-7 AC7 + AC13, PRD-Jarvis §9 (roadmap v1.1 Gmail escrita).
 */
import { z } from 'zod';

import {
  ToolExecutionError,
  type ReverseOpPayload,
  type ToolDefinition,
  type ToolExecutionContext,
} from '@meu-jarvis/tools';

import { getGmailAccessToken, noopReverseOp, sendGmailMessage } from './gmail-api';

const TOOL_NAME = 'enviar_email';

// ─────────────────────────────────────────────────────────────────────────────
// Schemas
// ─────────────────────────────────────────────────────────────────────────────

// `to` sempre obrigatório (só existe uma forma: email novo). `subject` opcional
// (email sem assunto é válido). `body` obrigatório. Sem `.refine` — compose-only.
const EnviarEmailInputSchema = z.object({
  to: z.string().email(),
  subject: z.string().min(1).optional(),
  body: z.string().min(1),
});

export type EnviarEmailInput = z.infer<typeof EnviarEmailInputSchema>;

const EnviarEmailOutputSchema = z.object({
  id: z.string().min(1),
  threadId: z.string().min(1),
  to: z.string().email(),
});

export type EnviarEmailOutput = z.infer<typeof EnviarEmailOutputSchema>;

/** Assunto por defeito quando o utilizador não indica um. */
const DEFAULT_SUBJECT = '(sem assunto)';

// ─────────────────────────────────────────────────────────────────────────────
// Tool definition
// ─────────────────────────────────────────────────────────────────────────────

export const enviarEmail: ToolDefinition<EnviarEmailInput, EnviarEmailOutput> = {
  name: TOOL_NAME,
  domain: 'email',
  description:
    'Usa esta tool quando o utilizador quer enviar, mandar ou compor um email novo. Recebe o destinatário (to — email válido), um assunto opcional (subject) e o corpo (body). Envia um email de texto simples a um único destinatário. Tool de escrita — o envio é irreversível e passa sempre por confirmação antes de enviar.',
  inputSchema: EnviarEmailInputSchema,
  outputSchema: EnviarEmailOutputSchema,
  estimatedTokens: 120,

  preview(input) {
    const subject = input.subject && input.subject.trim().length > 0 ? input.subject : DEFAULT_SUBJECT;
    return `Vou enviar este email:\nPara: ${input.to}\nAssunto: ${subject}\n\n${input.body}\n\nConfirmas?`;
  },

  async execute(input, ctx: ToolExecutionContext): Promise<EnviarEmailOutput> {
    const accessToken = await getGmailAccessToken(ctx, TOOL_NAME);

    const subject = input.subject && input.subject.trim().length > 0 ? input.subject : DEFAULT_SUBJECT;

    let sent: { id: string; threadId: string };
    try {
      sent = await sendGmailMessage(accessToken, {
        to: input.to,
        subject,
        body: input.body,
      });
    } catch (err) {
      // `sendGmailMessage` já lança `ToolExecutionError` com `cause`; re-lança
      // qualquer outro erro embrulhado para preservar a observabilidade.
      if (err instanceof ToolExecutionError) {
        throw err;
      }
      throw new ToolExecutionError(
        TOOL_NAME,
        err instanceof Error ? err : new Error('Falha desconhecida ao enviar o email.'),
      );
    }

    return { id: sent.id, threadId: sent.threadId, to: input.to };
  },

  /**
   * Sentinela inerte `_noop` (R1b v1.1).
   *
   * Um email enviado NÃO é revertível — não existe "des-enviar". `executeAtomic`
   * força persistência de uma row em `agent_reverse_ops`; usamos `table='_noop'`
   * + UUID válido para satisfazer `ReverseOpDeleteRowSchema` sem permitir undo
   * real. O endpoint `/undo` responde 410 Gone para `table = '_noop'`. A
   * segurança está no preview→confirm obrigatório (AC3), não no undo.
   */
  async reverse(): Promise<ReverseOpPayload> {
    return noopReverseOp();
  },
};
