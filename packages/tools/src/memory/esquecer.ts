/**
 * Tool `esquecer` — apaga (hard DELETE) uma memória explícita guardada em
 * `jarvis_memories`.
 *
 * Domínio: `memory` (Story M-1 introduziu o domínio; `esquecer` é a 2.ª tool
 * deste domínio, a operação INVERSA de `memorizar`). O utilizador pede para
 * esquecer uma preferência/facto errado ou desactualizado ("esquece que odeio
 * reuniões antes das 10h") → o Planner resolve QUAL memória (a partir da
 * shortlist `{id, content}` injectada como prefixo da user message — AC4/AC5) e
 * popula `memoryId` (autoritativo) + `content` (só para o preview).
 *
 * **Preview OBRIGATÓRIO (SEND-PREVIEW-1, J-7/J-8):** ao contrário de
 * `eliminar_tarefa` (que resolve o alvo dentro do `execute()` com um `confirmed`
 * boolean, DP-2.14.B), `esquecer` corre o Planner NO BRANCH DE PREVIEW e o
 * `preview()` mostra o CONTEÚDO EXACTO da memória resolvida ("Vou esquecer:
 * '{content}'. Confirmas?"). O plano é persistido e reutilizado no confirm
 * (binding preview==acção) — a memória apagada é EXACTAMENTE a que o utilizador
 * viu. Ver a nota de design da story ("Problema de design").
 *
 * **Reversível de verdade (FIX-1, Story 2.14):** hard DELETE →
 * `{ kind: 'reinsert_row', table: 'jarvis_memories', id, snapshot }`. O snapshot
 * é capturado ANTES do DELETE, em snake_case (PO-SHOULD-FIX-1 — o motor de undo
 * usa as keys LITERALMENTE como nomes de coluna no INSERT). Dentro da janela de
 * 30s o endpoint `/api/agent/prompt/[runId]/undo` reinsere a memória com o `id`
 * original. **Isto só funciona porque a M-4 adicionou `'jarvis_memories'` a
 * `ALLOWED_REVERSE_TABLES` no motor de undo (PO-MUST-FIX-1).**
 *
 * Trace: Story M-4 AC8 + brief epic v2-memoria-rica (D5) + PRD FR4
 *        (preview-then-confirm) + FR6 (undo 30s).
 *
 * RLS (NFR5): `ctx.db` é cliente authenticated — Postgres filtra por
 * `household_id` via JWT. O SELECT/DELETE também filtram `household_id =
 * ctx.householdId` explicitamente (1.ª rede app-enforced). NUNCA usa
 * `getServiceDb()` — um DELETE cross-household apagaria dados pessoais de outro
 * household (violação grave de tenancy).
 *
 * PII (NFR12): `content` é conteúdo pessoal sensível (migration 0034); nunca é
 * incluído em span attributes. Apenas o `memoryId` (UUID) entra em
 * `agent_reverse_ops`.
 */
import { sql } from 'drizzle-orm';
import { z } from 'zod';

// Imports relativos — alias `@/` colide com aliases dos consumidores.
import type {
  ReverseOpPayload,
  ToolDefinition,
  ToolExecutionContext,
} from '../contracts';
import { ToolExecutionError } from '../errors';

// ─────────────────────────────────────────────────────────────────────────────
// Schemas
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Input do `esquecer`.
 *
 * - `memoryId`: identificador AUTORITATIVO já resolvido pelo Planner a partir da
 *   shortlist (AC4/AC5). É a ÚNICA fonte de verdade para o que é apagado.
 * - `content`: texto copiado pelo Planner da shortlist, usado APENAS pelo
 *   `preview()` síncrono (sem I/O). A `execute()` NUNCA confia em `content` para
 *   decidir o que apagar — só em `memoryId` + `ctx.householdId` (RLS). Limita o
 *   raio de dano de uma eventual alucinação do LLM no campo `content`.
 */
const EsquecerInputSchema = z.object({
  memoryId: z.string().uuid(),
  content: z.string().min(1).max(500),
});

export type EsquecerInput = z.infer<typeof EsquecerInputSchema>;

/**
 * Output do `esquecer` — id + conteúdo da memória apagada + snapshot completo
 * (snake_case) para o `reinsert_row`. `snapshot` só é preenchido após o DELETE
 * efectivo (mesmo padrão `eliminar_tarefa`/FIX-1).
 */
const EsquecerOutputSchema = z.object({
  memoryId: z.string().uuid(),
  content: z.string(),
  snapshot: z.record(z.unknown()).optional(),
});

export type EsquecerOutput = z.infer<typeof EsquecerOutputSchema>;

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Row de resolução — campos snake_case necessários para o snapshot completo
 * (suficiente para re-inserir a memória via reinsert_row).
 */
interface ResolvedMemoryRow {
  readonly id: string;
  readonly household_id: string;
  readonly created_by_user_id: string;
  readonly content: string;
  readonly source: string;
  readonly created_at: string;
}

/**
 * Constrói o snapshot completo (snake_case) a partir da row resolvida.
 *
 * PO-SHOULD-FIX-1: as chaves são usadas LITERALMENTE como nomes de coluna no
 * INSERT do `reinsert_row` (`insert into jarvis_memories (${cols}) ...`) — TÊM de
 * estar em snake_case (`household_id`, `created_by_user_id`, `created_at`), nunca
 * camelCase. Modelo: `buildSnapshot` de `tasks/eliminar-tarefa.ts`.
 *
 * O `id` é excluído daqui — o motor de undo injecta-o explicitamente a partir de
 * `op.id`. `updated_at` também é excluído (tem default + trigger próprio).
 */
function buildSnapshot(row: ResolvedMemoryRow): Record<string, unknown> {
  return {
    household_id: row.household_id,
    created_by_user_id: row.created_by_user_id,
    content: row.content,
    source: row.source,
    created_at: row.created_at,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Tool definition
// ─────────────────────────────────────────────────────────────────────────────

export const esquecer: ToolDefinition<EsquecerInput, EsquecerOutput> = {
  name: 'esquecer',
  domain: 'memory',
  description:
    'Usa esta tool quando o utilizador quer que o assistente APAGUE/ESQUEÇA uma memória (facto/preferência) que guardou antes — porque está errada ou desactualizada. Requer confirmação explícita (o preview mostra o conteúdo exacto da memória antes de apagar). Gatilhos: "esquece que…", "já não é verdade que…", "apaga a memória de/sobre…". Recebe o `memoryId` (id EXACTO da memória escolhida da shortlist de memórias guardadas) e o `content` (texto dessa memória, só para o preview).',
  inputSchema: EsquecerInputSchema,
  outputSchema: EsquecerOutputSchema,
  estimatedTokens: 90,

  preview(input) {
    return `Vou esquecer: "${input.content}". Confirmas?`;
  },

  async execute(input, ctx: ToolExecutionContext): Promise<EsquecerOutput> {
    // 1) Resolver a memória por `memoryId` + household (RLS 2.ª rede + filtro
    //    app-level 1.ª rede). SQL puro via `ctx.db.execute(sql\`...\`)` — evita
    //    import cross-package do schema (mesma limitação de `memorizar`).
    const result = (await ctx.db.execute(sql`
      select id, household_id, created_by_user_id, content, source, created_at
      from jarvis_memories
      where id = ${input.memoryId}
        and household_id = ${ctx.householdId}
      limit 1
    `)) as ReadonlyArray<ResolvedMemoryRow>;

    const resolved = result[0];

    // 2) Zero-match (id errado, ou já apagada entretanto — condição de corrida).
    //    NUNCA confia em `input.content` para decidir — só `memoryId`+household.
    if (!resolved) {
      throw new ToolExecutionError(
        'esquecer',
        new Error('Não encontrei essa memória — pode já ter sido apagada.'),
      );
    }

    // 3) Capturar snapshot completo (snake_case) ANTES do DELETE.
    const snapshot = buildSnapshot(resolved);

    // 4) DELETE household-scoped (household já filtrado no SELECT/RLS).
    await ctx.db.execute(sql`
      delete from jarvis_memories
      where id = ${resolved.id}
    `);

    // 5) Devolve o conteúdo REAL da row resolvida (não `input.content`).
    return {
      memoryId: resolved.id,
      content: resolved.content,
      snapshot,
    };
  },

  async reverse(output): Promise<ReverseOpPayload> {
    return {
      kind: 'reinsert_row',
      table: 'jarvis_memories',
      id: output.memoryId,
      snapshot: output.snapshot ?? {},
    };
  },
};
