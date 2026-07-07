/**
 * Tool `sugerir_memoria` — PROPÕE guardar uma memória INFERIDA (facto/preferência
 * que o utilizador revelou de passagem) em `jarvis_memories`, com `source =
 * 'inferred'`.
 *
 * Domínio: `memory` (Story M-1 introduziu o domínio; esta é a 3.ª tool, a par de
 * `memorizar` (captura explícita) e `esquecer` (apagar)). Ao contrário de
 * `memorizar` — que executa um pedido EXPLÍCITO do utilizador ("lembra-te que…") —
 * esta tool nasce de uma INFERÊNCIA do sistema: o classifier/Planner notou, numa
 * mensagem cujo pedido principal era outra coisa, um traço pessoal durável digno
 * de memória. Por isso é sempre uma PROPOSTA com confirmação obrigatória (R5 do
 * brief — nunca captura em silêncio, nem sequer com tom de certeza).
 *
 * Perfil de risco IDÊNTICO a `memorizar`/`criar_tarefa`: escrita INTERNA simples
 * e totalmente reversível — INSERT atómico + `reverse_op` real (`delete_row`)
 * para undo honesto de 30s. NÃO é escrita externa (não chama nenhuma API fora do
 * Postgres do próprio projecto), logo NÃO entra em `EXTERNAL_WRITE_INTENTS` nem
 * `IRREVERSIBLE_WRITE_TOOLS`. ENTRA em `PREVIEW_RENDER_INTENTS` /
 * `REUSE_PERSISTED_PLAN_INTENTS` (SEND-PREVIEW-1) — o preview mostra o texto
 * EXACTO proposto e o confirm reutiliza o plano persistido (binding
 * preview==memória guardada).
 *
 * **Proveniência determinística (`source='inferred'`):** o valor `'inferred'` é
 * um LITERAL fixo no SQL desta tool — NUNCA vem de `input`/`ctx`/LLM. Garante que
 * SÓ esta tool grava `'inferred'`; `memorizar` continua a deixar a coluna no
 * default `'explicit'`. Não se introduz um campo `source` partilhado entre as duas
 * tools (isso permitiria a um input alucinado do LLM declarar `source` livremente
 * — desnecessário e mais arriscado).
 *
 * Trace: Story M-5 AC4 + brief epic v2-memoria-rica (§2 D1 captura inferida com
 *        confirmação, §7 R5) + PRD FR4 (preview-then-confirm) + FR6 (undo 30s).
 *
 * RLS (NFR5): `ctx.db` é cliente authenticated com JWT — `household_id` e
 * `created_by_user_id` são derivados de `ctx`, NUNCA do input do utilizador.
 * Postgres rejeita INSERT cross-household por policy `WITH CHECK`.
 *
 * PII (NFR12): `content` é conteúdo pessoal sensível (risco R2 do brief, igual a
 * `memorizar`); nunca é incluído em span attributes. Apenas o `memoryId` (UUID)
 * entra em `agent_reverse_ops`.
 */
import { sql } from 'drizzle-orm';
import { z } from 'zod';

// Imports relativos — alias `@/` colide com aliases dos consumidores
// (apps/web tem `@/` → `apps/web/src/`). Ver nota completa em `tasks/index.ts`.
import type {
  ReverseOpPayload,
  ToolDefinition,
  ToolExecutionContext,
} from '../contracts';

// ─────────────────────────────────────────────────────────────────────────────
// Schemas
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Input do `sugerir_memoria`.
 *
 * - `content`: 1..500 caracteres. Mesmo cap de `memorizar` (default sensato
 *   herdado, sem nova justificação necessária). NÃO tem campo `source` — a
 *   proveniência `'inferred'` é literal fixo no SQL da tool, nunca no input.
 */
const SugerirMemoriaInputSchema = z.object({
  content: z.string().min(1).max(500),
});

export type SugerirMemoriaInput = z.infer<typeof SugerirMemoriaInputSchema>;

/**
 * Output do `sugerir_memoria` — id da memória criada + o conteúdo persistido.
 */
const SugerirMemoriaOutputSchema = z.object({
  memoryId: z.string().uuid(),
  content: z.string(),
});

export type SugerirMemoriaOutput = z.infer<typeof SugerirMemoriaOutputSchema>;

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Forma esperada da row devolvida pelo INSERT INTO jarvis_memories RETURNING ...
 */
interface JarvisMemoriesInsertReturn {
  readonly id: string;
  readonly content: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// Tool definition
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Tool definition para `sugerir_memoria`.
 *
 * Pattern reverse_op: INSERT → `{ kind: 'delete_row', table: 'jarvis_memories',
 * id }` (reversível de verdade, ao contrário de `enviar_email`/`responder_email`
 * que usam `_noop`). O endpoint `POST /api/agent/prompt/[runId]/undo` consome
 * este payload para fazer DELETE dentro da janela de 30s (`jarvis_memories` já
 * está em `ALLOWED_REVERSE_TABLES` desde a M-4).
 */
export const sugerirMemoria: ToolDefinition<SugerirMemoriaInput, SugerirMemoriaOutput> = {
  name: 'sugerir_memoria',
  domain: 'memory',
  description:
    'Usa esta tool quando NOTASTE, de passagem, um facto ou preferência pessoal DURÁVEL do utilizador numa mensagem cujo pedido principal era OUTRA coisa (uma tarefa, uma pergunta, um evento) — e queres PROPOR guardá-lo como memória (nunca guardar em silêncio). Distinta de `memorizar` (que o utilizador PEDE explicitamente): aqui o utilizador NÃO pediu, apenas deixou escapar a preferência. Requer sempre confirmação — o preview mostra o texto exacto proposto em forma de pergunta antes de qualquer escrita. Aceita apenas o conteúdo textual da memória inferida (1 a 500 caracteres).',
  inputSchema: SugerirMemoriaInputSchema,
  outputSchema: SugerirMemoriaOutputSchema,
  estimatedTokens: 50,

  preview(input) {
    // Copy DELIBERADAMENTE em forma de PERGUNTA (não afirmação como `memorizar`):
    // é uma proposta de consentimento explícito, nunca um facto consumado (R5).
    return `Reparei nisto: "${input.content}". Queres que eu guarde isto como memória?`;
  },

  async execute(input, ctx: ToolExecutionContext): Promise<SugerirMemoriaOutput> {
    // SQL puro via `ctx.db.execute(sql\`...\`)` — evita import cross-package do
    // schema `jarvis_memories` (mesma limitação documentada em `memorizar.ts`).
    // Drizzle parametriza os values através do template tag → safe contra
    // injection.
    //
    // `household_id` e `created_by_user_id` vêm SEMPRE de `ctx` (NUNCA do input
    // do utilizador) — RLS NFR5. `source` é o LITERAL fixo 'inferred' — nunca
    // vindo do input/LLM (garantia determinística de proveniência: só esta tool
    // grava 'inferred'; `memorizar` deixa a coluna no default 'explicit').
    const result = (await ctx.db.execute(sql`
      insert into jarvis_memories
        (household_id, created_by_user_id, content, source)
      values
        (
          ${ctx.householdId},
          ${ctx.userId},
          ${input.content},
          'inferred'
        )
      returning id, content
    `)) as ReadonlyArray<JarvisMemoriesInsertReturn>;

    const row = result[0];
    if (!row) {
      // Defensivo — Postgres deveria sempre devolver a row inserida.
      throw new Error('INSERT em jarvis_memories não devolveu row');
    }

    return {
      memoryId: row.id,
      content: row.content,
    };
  },

  async reverse(output): Promise<ReverseOpPayload> {
    return {
      kind: 'delete_row',
      table: 'jarvis_memories',
      id: output.memoryId,
    };
  },
};
