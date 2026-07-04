/**
 * Tool `responder_email` — responde a um email já existente mantendo a thread do
 * Gmail (Story J-8). Tool de **ESCRITA externa IRREVERSÍVEL** — mesma família de
 * `enviar_email` (J-7), com threading (`threadId` + `In-Reply-To`/`References`).
 *
 * Domínio: `email`. Reply simples (v1) — texto simples, 1 destinatário (o
 * remetente original), 1 salto de thread. Reply-all/forward/anexos ficam fora de
 * âmbito (ver Contexto de âmbito da story J-8).
 *
 * **`preview()`/`execute()` PUROS quanto à resolução:** recebem `threadId`,
 * `messageId` e `to` JÁ concretos — resolvidos ANTES do Planner pelo passo de
 * resolução (`resolve-reply-target.ts`, AC5), NUNCA dentro da tool. O contrato
 * `ToolDefinition.preview` (síncrono, sem I/O) mantém-se inalterado.
 *
 * **Segurança — preview→confirm obrigatório:** o classifier força
 * `needs_confirmation: true` para `responder_email` (v7 AC4), pelo que o envio só
 * ocorre no route de confirmação, DEPOIS de o Eurico rever o rascunho. Não há
 * "des-enviar" — a rede de segurança é o preview, não o undo.
 *
 * RLS (NFR5): `ctx.db` é cliente authenticated — a leitura de `google_oauth_tokens`
 * (em `getGmailAccessToken`) é filtrada por `household_id` via RLS. NUNCA usa
 * `getServiceDb()`.
 *
 * Privacidade: o conteúdo do email é processado em memória e descartado; NUNCA é
 * persistido em DB (PRD §7 — "a confiança é o produto").
 *
 * `reverse()`: sentinela inerte `_noop` (R1b v1.1) — idêntico a `enviar_email`.
 * Um email enviado NÃO é revertível; o `/undo` responde 410 Gone.
 *
 * Trace: Story J-8 AC7 + AC12 + AC13, PRD-Jarvis §9 (roadmap Gmail).
 */
import { z } from 'zod';

import {
  ToolExecutionError,
  type ReverseOpPayload,
  type ToolDefinition,
  type ToolExecutionContext,
} from '@meu-jarvis/tools';

import { getGmailAccessToken, noopReverseOp, sendGmailMessage } from './gmail-api';

const TOOL_NAME = 'responder_email';

// ─────────────────────────────────────────────────────────────────────────────
// Schemas
// ─────────────────────────────────────────────────────────────────────────────

// `threadId`/`messageId` resolvidos pelo passo de resolução (AC5) — a tool NÃO faz
// pesquisa. `to` = endereço nu do remetente original (`fromEmail` parseado, AC5),
// NUNCA "Nome <email>" (o `.email()` rejeitaria). `subject` opcional (o `Re: ` é
// aplicado em execute/preview).
const ResponderEmailInputSchema = z.object({
  threadId: z.string().min(1),
  messageId: z.string().min(1),
  to: z.string().email(),
  subject: z.string().min(1).optional(),
  body: z.string().min(1),
});

export type ResponderEmailInput = z.infer<typeof ResponderEmailInputSchema>;

const ResponderEmailOutputSchema = z.object({
  id: z.string().min(1),
  threadId: z.string().min(1),
  to: z.string().email(),
});

export type ResponderEmailOutput = z.infer<typeof ResponderEmailOutputSchema>;

/** Assunto por defeito quando o email original não tinha assunto. */
const DEFAULT_SUBJECT = '(sem assunto)';

/**
 * Prefixa o assunto com `Re: ` se ainda não começar por `Re:` (case-insensitive).
 * Um assunto ausente/vazio usa o placeholder `(sem assunto)`.
 */
function replySubject(subject: string | undefined): string {
  const base = subject && subject.trim().length > 0 ? subject.trim() : DEFAULT_SUBJECT;
  return /^re:/i.test(base) ? base : `Re: ${base}`;
}

// ─────────────────────────────────────────────────────────────────────────────
// Tool definition
// ─────────────────────────────────────────────────────────────────────────────

export const responderEmail: ToolDefinition<ResponderEmailInput, ResponderEmailOutput> = {
  name: TOOL_NAME,
  domain: 'email',
  description:
    'Usa esta tool quando o utilizador quer RESPONDER a um email que já recebeu, mantendo a conversa na mesma thread. Recebe o threadId e o messageId do email original (já resolvidos), o destinatário (to — o endereço nu do remetente original), um assunto opcional (subject) e o corpo (body) da resposta. NÃO serve para compor um email novo (usa enviar_email para isso). Tool de escrita — o envio é irreversível e passa sempre por confirmação antes de enviar.',
  inputSchema: ResponderEmailInputSchema,
  outputSchema: ResponderEmailOutputSchema,
  estimatedTokens: 120,

  preview(input) {
    return `Vou responder a este email:\nPara: ${input.to}\nAssunto: ${replySubject(input.subject)}\n\n${input.body}\n\nConfirmas?`;
  },

  async execute(input, ctx: ToolExecutionContext): Promise<ResponderEmailOutput> {
    const accessToken = await getGmailAccessToken(ctx, TOOL_NAME);

    let sent: { id: string; threadId: string };
    try {
      sent = await sendGmailMessage(accessToken, {
        to: input.to,
        subject: replySubject(input.subject),
        body: input.body,
        // Threading (Story J-8): threadId + In-Reply-To/References apontam para o
        // Message-ID do email original (thread de 1 salto — References == In-Reply-To).
        threadId: input.threadId,
        inReplyTo: input.messageId,
        references: input.messageId,
        toolName: TOOL_NAME,
      });
    } catch (err) {
      // `sendGmailMessage` já lança `ToolExecutionError` com `cause`; re-lança
      // qualquer outro erro embrulhado para preservar a observabilidade.
      if (err instanceof ToolExecutionError) {
        throw err;
      }
      throw new ToolExecutionError(
        TOOL_NAME,
        err instanceof Error ? err : new Error('Falha desconhecida ao responder ao email.'),
      );
    }

    return { id: sent.id, threadId: sent.threadId, to: input.to };
  },

  /**
   * Sentinela inerte `_noop` (R1b v1.1) — idêntico a `enviar_email`.
   *
   * Um email enviado NÃO é revertível — não existe "des-enviar". `executeAtomic`
   * força persistência de uma row em `agent_reverse_ops`; usamos `table='_noop'`
   * + UUID válido para satisfazer `ReverseOpDeleteRowSchema` sem permitir undo
   * real. O endpoint `/undo` responde 410 Gone para `table = '_noop'`. A
   * segurança está no preview→confirm obrigatório (AC4), não no undo.
   */
  async reverse(): Promise<ReverseOpPayload> {
    return noopReverseOp();
  },
};
