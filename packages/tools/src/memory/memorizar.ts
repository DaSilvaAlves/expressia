/**
 * Tool `memorizar` — guarda uma memória explícita (facto/preferência) do
 * utilizador em `jarvis_memories`.
 *
 * Domínio: `memory` (Story M-1). O utilizador dita um facto ou preferência em
 * linguagem natural ("lembra-te que odeio reuniões antes das 10h") e o texto é
 * gravado tal-e-qual, sem parsing/estruturação. Distinta de `jarvis_facts`
 * (key-value, settings estruturados). Usar a memória (M-2), no brief (M-3) e
 * esquecê-la (M-4) ficam para stories seguintes — aqui só se captura e guarda.
 *
 * Perfil de risco IDÊNTICO a `criar_tarefa` (Story 3.8): escrita INTERNA simples
 * e totalmente reversível — INSERT atómico + `reverse_op` real (`delete_row`)
 * para undo honesto de 30s. NÃO é escrita externa (não chama nenhuma API fora do
 * Postgres do próprio projecto), logo NÃO entra em nenhum dos 4 conjuntos
 * generalizados pela J-7/J-8 (`EXTERNAL_WRITE_INTENTS`, `PREVIEW_RENDER_INTENTS`,
 * `REUSE_PERSISTED_PLAN_INTENTS`, `IRREVERSIBLE_WRITE_TOOLS`) — segue o caminho
 * genérico do pipeline (Story M-1 AC8).
 *
 * Trace: Story M-1 AC6 + brief epic v2-memoria-rica (D1+D2) + PRD FR4
 *        (preview-then-confirm) + FR6 (undo 30s).
 *
 * RLS (NFR5): `ctx.db` é cliente authenticated com JWT — `household_id` e
 * `created_by_user_id` são derivados de `ctx`, NUNCA do input do utilizador.
 * Postgres rejeita INSERT cross-household por policy `WITH CHECK`.
 *
 * PII (NFR12): `content` é conteúdo pessoal sensível (risco R2 do brief); nunca
 * é incluído em span attributes. Apenas o `memoryId` (UUID) entra em
 * `agent_reverse_ops`.
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
 * Input do `memorizar`.
 *
 * - `content`: 1..500 caracteres. O cap de 500 é um default sensato — generoso
 *   para uma frase de preferência/facto, sem permitir texto arbitrariamente
 *   longo no MVP (Story M-1 [AUTO-DECISION]).
 */
const MemorizarInputSchema = z.object({
  content: z.string().min(1).max(500),
});

export type MemorizarInput = z.infer<typeof MemorizarInputSchema>;

/**
 * Output do `memorizar` — id da memória criada + o conteúdo persistido.
 */
const MemorizarOutputSchema = z.object({
  memoryId: z.string().uuid(),
  content: z.string(),
});

export type MemorizarOutput = z.infer<typeof MemorizarOutputSchema>;

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
 * Tool definition para `memorizar`.
 *
 * Pattern reverse_op: INSERT → `{ kind: 'delete_row', table: 'jarvis_memories',
 * id }` (reversível de verdade, ao contrário de `enviar_email`/`responder_email`
 * que usam `_noop`). O endpoint `POST /api/agent/prompt/[runId]/undo` consome
 * este payload para fazer DELETE dentro da janela de 30s.
 */
export const memorizar: ToolDefinition<MemorizarInput, MemorizarOutput> = {
  name: 'memorizar',
  domain: 'memory',
  description:
    'Usa esta tool quando o utilizador quer que o assistente GUARDE um facto ou preferência permanente sobre ele — não uma acção a fazer (isso é criar_tarefa). Gatilhos: "lembra-te que...", "não te esqueças que...", "guarda que...", "memoriza que...". Ex: "lembra-te que odeio reuniões antes das 10h", "guarda que prefiro café sem açúcar". Aceita apenas o conteúdo textual da memória (1 a 500 caracteres).',
  inputSchema: MemorizarInputSchema,
  outputSchema: MemorizarOutputSchema,
  estimatedTokens: 50,

  preview(input) {
    return `Vou lembrar-me disso: "${input.content}"`;
  },

  async execute(input, ctx: ToolExecutionContext): Promise<MemorizarOutput> {
    // SQL puro via `ctx.db.execute(sql\`...\`)` — evita import cross-package do
    // schema `jarvis_memories` (mesma limitação documentada em contracts.ts
    // sobre os `paths` aliases do `@meu-jarvis/db`). Drizzle parametriza os
    // values através do template tag → safe contra injection.
    //
    // `household_id` e `created_by_user_id` vêm SEMPRE de `ctx` (NUNCA do input
    // do utilizador) — RLS NFR5. `source` fica no default 'explicit' da coluna
    // (captura via chat é sempre explícita nesta story).
    const result = (await ctx.db.execute(sql`
      insert into jarvis_memories
        (household_id, created_by_user_id, content)
      values
        (
          ${ctx.householdId},
          ${ctx.userId},
          ${input.content}
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
