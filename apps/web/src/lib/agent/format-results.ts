/**
 * Renderização de resultados de tools de LEITURA para o chat (Story J-6
 * follow-up).
 *
 * O motor foi desenhado à volta de operações de ESCRITA (criar tarefa, gastar,
 * criar evento) cujo feedback é "feito, N operações". As tools de LEITURA (ex.:
 * `consultar_emails`) devolvem DADOS que o utilizador quer ver — mas os
 * construtores de resumo genéricos (`buildSummaryText`/`buildConfirmSummary`)
 * nunca os mostravam. Este helper transforma o output de uma tool de leitura em
 * texto PT-PT para o utilizador.
 *
 * Devolve `null` quando não há resultado de leitura renderizável — o caller
 * mantém o resumo genérico de escrita.
 *
 * Trace: Story J-6 AC15a (bot responde com a lista de emails).
 */

/** Item de email normalizado (output de `consultar_emails`). */
interface EmailItem {
  readonly id: string;
  readonly subject: string;
  readonly from: string;
  readonly receivedAt: string;
  readonly snippet: string;
}

/** Um resultado atómico de tool com o mínimo que este helper consome. */
interface ToolResultLike {
  readonly toolName: string;
  readonly output: unknown;
}

function isEmailArray(output: unknown): output is EmailItem[] {
  return (
    Array.isArray(output) &&
    output.every(
      (e) =>
        typeof e === 'object' &&
        e !== null &&
        typeof (e as EmailItem).subject === 'string' &&
        typeof (e as EmailItem).from === 'string',
    )
  );
}

/**
 * Extrai o nome de exibição de um cabeçalho `From` da Gmail API:
 *   `"Pedro Silva" <pedro@x.com>` → `Pedro Silva`
 *   `Pedro <pedro@x.com>`         → `Pedro`
 *   `pedro@x.com`                 → `pedro@x.com`
 */
function displayName(from: string): string {
  const match = from.match(/^\s*"?([^"<]+?)"?\s*<[^>]+>\s*$/);
  return (match?.[1] ?? from).trim();
}

/** Formata a lista de emails em texto PT-PT (assunto + remetente). */
function formatEmails(emails: EmailItem[]): string {
  if (emails.length === 0) {
    return 'Não encontrei emails para mostrar.';
  }
  const header = emails.length === 1 ? 'Tens 1 email:' : `Tens ${emails.length} emails:`;
  const lines = emails.map((email, i) => {
    const who = displayName(email.from);
    const subject = email.subject.trim() || '(sem assunto)';
    return `${i + 1}. ${who} — ${subject}`;
  });
  return `${header}\n${lines.join('\n')}`;
}

/**
 * Renderiza resultados de tools de leitura em texto PT-PT para o chat. Devolve
 * `null` se nenhum resultado for de uma tool de leitura renderizável (o caller
 * mantém o resumo genérico).
 *
 * Actualmente suporta `consultar_emails`. Novas tools de leitura acrescentam-se
 * aqui (ponto único de extensão).
 */
export function renderReadToolResults(
  results: ReadonlyArray<ToolResultLike>,
): string | null {
  const emailResult = results.find((r) => r.toolName === 'consultar_emails');
  if (emailResult && isEmailArray(emailResult.output)) {
    return formatEmails(emailResult.output);
  }
  return null;
}
