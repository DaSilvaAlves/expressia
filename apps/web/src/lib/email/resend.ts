/**
 * Helper de envio de email de convite de família via Resend — Story INVITE-EMAIL.
 *
 * Reverte a DEV-DECISION D-6.7.3 ("MVP sem Resend"): o fluxo de convites
 * (Story 6.7) cria o convite e devolve o link, mas o email nunca era enviado.
 * Este helper trata o envio best-effort do email ao convidado.
 *
 * Contrato (AC7/AC8/AC10):
 * - `sendInviteEmail` NUNCA lança — qualquer erro é capturado internamente e
 *   devolvido como `{ ok: false, reason }`. Isto permite que o handler POST de
 *   convites continue a sua execução best-effort (resposta 201 independente do
 *   resultado do email).
 * - `RESEND_API_KEY` é lida de `process.env` em runtime (dentro da função), não
 *   no top-level do módulo — para que os testes possam manipular a env var com
 *   `vi.stubEnv`/`vi.unstubAllEnvs` e o guard de chave-ausente seja testável.
 * - `RESEND_API_KEY` é server-side apenas — NUNCA prefixar com `NEXT_PUBLIC_`.
 *
 * O `inviteUrl` recebido já vem absoluto e construído pelo handler (padrão SEC-9
 * — `SITE_URL` truthy + fallback `https://expressia.pt`). Este helper não toca em
 * `window.location` nem em headers HTTP (prevenção de header poisoning).
 */
import { Resend } from 'resend';

/**
 * Remetente verificado no painel Resend. Usa `@euricoalves.pt` (o único domínio
 * verificado no plano gratuito do Resend; `expressia.pt` exigiria o plano Pro).
 * O nome de exibição mantém-se "Expressia" — é o que o convidado vê. Migrar para
 * `convites@expressia.pt` quando esse domínio for verificado (decisão Eurico 19/06).
 */
const FROM = 'Expressia <convites@euricoalves.pt>';

/** Assunto do email de convite (PT-PT europeu). */
const SUBJECT = 'Foste convidado para uma família no Expressia';

export interface SendInviteEmailResult {
  readonly ok: boolean;
  readonly reason?: string;
}

export interface SendInviteEmailParams {
  /** Endereço de email do convidado. */
  readonly to: string;
  /** Link absoluto de aceitação do convite (já construído pelo handler). */
  readonly inviteUrl: string;
  /** Nome de quem convida (opcional — reservado para personalização futura). */
  readonly inviterName?: string;
}

/**
 * Corpo do email em texto simples (PT-PT europeu — "tu/foste/podes", "equipa").
 * Plaintext é suficiente para o MVP; a versão HTML é cortesia (não bloqueante).
 */
function buildPlainTextBody(inviteUrl: string): string {
  return [
    'Olá,',
    '',
    'Foste convidado para te juntares a uma família no Expressia.',
    '',
    'Clica no link abaixo para aceitar o convite (válido por 7 dias):',
    inviteUrl,
    '',
    'Se não esperavas este email, podes ignorá-lo.',
    '',
    '— A equipa Expressia',
  ].join('\n');
}

/**
 * Corpo do email em HTML mínimo (PT-PT europeu). Sem dependências de styling —
 * markup inline simples, compatível com clientes de email comuns.
 */
function buildHtmlBody(inviteUrl: string): string {
  const safeUrl = escapeHtml(inviteUrl);
  return [
    '<p>Olá,</p>',
    '<p>Foste convidado para te juntares a uma família no Expressia.</p>',
    '<p>Clica no link abaixo para aceitar o convite (válido por 7 dias):</p>',
    `<p><a href="${safeUrl}">${safeUrl}</a></p>`,
    '<p>Se não esperavas este email, podes ignorá-lo.</p>',
    '<p>— A equipa Expressia</p>',
  ].join('\n');
}

/** Escapa caracteres HTML reservados para evitar injecção no corpo do email. */
function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * Envia o email de convite ao endereço indicado. Best-effort: nunca lança.
 *
 * @returns `{ ok: true }` em sucesso; `{ ok: false, reason }` em qualquer falha
 *   (chave ausente, erro de rede, API Resend indisponível, resposta de erro).
 */
export async function sendInviteEmail(
  params: SendInviteEmailParams,
): Promise<SendInviteEmailResult> {
  // Guard de chave ausente — lido em runtime para ser testável e para não falhar
  // o módulo em ambientes sem a env var. Permite o handler continuar best-effort.
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) {
    return { ok: false, reason: 'missing-api-key' };
  }

  try {
    const resend = new Resend(apiKey);
    const { error } = await resend.emails.send({
      from: FROM,
      to: params.to,
      subject: SUBJECT,
      text: buildPlainTextBody(params.inviteUrl),
      html: buildHtmlBody(params.inviteUrl),
    });

    // A API Resend devolve `{ data, error }` sem lançar em erros de negócio
    // (ex.: domínio não verificado). `error` é um `ErrorResponse`
    // (`{ message, statusCode, name }`) — tratamos como falha best-effort.
    if (error) {
      return { ok: false, reason: error.message };
    }

    return { ok: true };
  } catch (err) {
    // Qualquer excepção inesperada (rede, SDK) é capturada — nunca propaga.
    const reason = err instanceof Error ? err.message : String(err);
    return { ok: false, reason };
  }
}
