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
 * Trace: Story J-6 AC15a (bot responde com a lista de emails); Story M-6 AC6
 *        (bot responde com a lista de memórias guardadas).
 */

/** Item de email normalizado (output de `consultar_emails`). */
interface EmailItem {
  readonly id: string;
  readonly subject: string;
  readonly from: string;
  readonly receivedAt: string;
  readonly snippet: string;
}

/** Item de memória normalizado (elemento de `output.memories` de `listar_memorias`). */
interface MemoryItem {
  readonly content: string;
  readonly createdAt: string;
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
 * Type guard para o output de `listar_memorias` (Story M-6 AC6).
 *
 * [PO-FIX-1] DIFERENÇA de FORMA face a `isEmailArray`: `consultar_emails` devolve
 * um **array cru** (logo `isEmailArray` faz `Array.isArray(output)` directo).
 * `listar_memorias` devolve um **objecto embrulhado** `{ memories: [...], count }`
 * (o `outputSchema` da tool). Copiar `Array.isArray(output)` tal-e-qual daria
 * SEMPRE `false` → fallback genérico "Executei N operação(ões)…" (o bug que a AC6
 * evita). Aqui confirmamos primeiro que `output` é objecto não-nulo com uma
 * propriedade `memories` que é array, e só depois validamos cada elemento.
 */
function isMemoryListOutput(output: unknown): output is { memories: MemoryItem[] } {
  if (typeof output !== 'object' || output === null) {
    return false;
  }
  const memories = (output as { memories?: unknown }).memories;
  return (
    Array.isArray(memories) &&
    memories.every(
      (m) =>
        typeof m === 'object' &&
        m !== null &&
        typeof (m as MemoryItem).content === 'string' &&
        typeof (m as MemoryItem).createdAt === 'string',
    )
  );
}

/** Formata a lista de memórias guardadas em texto PT-PT (Story M-6 AC6). */
function formatMemories(memories: MemoryItem[]): string {
  if (memories.length === 0) {
    return 'Ainda não tenho nenhuma memória guardada sobre ti.';
  }
  const header =
    memories.length === 1
      ? 'Tenho 1 memória guardada:'
      : `Tenho ${memories.length} memórias guardadas:`;
  const lines = memories.map((m, i) => `${i + 1}. ${m.content}`);
  return `${header}\n${lines.join('\n')}`;
}

/**
 * Renderiza resultados de tools de leitura em texto PT-PT para o chat. Devolve
 * `null` se nenhum resultado for de uma tool de leitura renderizável (o caller
 * mantém o resumo genérico).
 *
 * Actualmente suporta `consultar_emails` e `listar_memorias`. Novas tools de
 * leitura acrescentam-se aqui (ponto único de extensão).
 */
export function renderReadToolResults(
  results: ReadonlyArray<ToolResultLike>,
): string | null {
  const emailResult = results.find((r) => r.toolName === 'consultar_emails');
  if (emailResult && isEmailArray(emailResult.output)) {
    return formatEmails(emailResult.output);
  }
  // Story M-6 — `listar_memorias` devolve `{ memories, count }` (objecto
  // embrulhado, NÃO array cru); `isMemoryListOutput` desembrulha `output.memories`.
  const memoryResult = results.find((r) => r.toolName === 'listar_memorias');
  if (memoryResult && isMemoryListOutput(memoryResult.output)) {
    return formatMemories(memoryResult.output.memories);
  }
  return null;
}
