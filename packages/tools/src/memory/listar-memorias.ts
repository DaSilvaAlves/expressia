/**
 * Tool `listar_memorias` — lista as memórias guardadas do household (recall).
 *
 * Story M-6: nova via de LEITURA explícita da epic v2 "Memória rica". O
 * utilizador pergunta "o que sabes sobre mim?" e esta tool devolve a lista das
 * memórias em `jarvis_memories` (cap N=50 mais recentes). Fecha o ciclo
 * capturar (M-1/M-5) → usar (M-2/M-3) → esquecer (M-4) → CONSULTAR (M-6).
 *
 * Read-only — usa sentinela `_noop` em `reverse()` (mesmo pattern R1b v1.1 que
 * `listar_tarefas`/`listar_atrasadas` — ver JSDoc de `listar-tarefas.ts` para a
 * justificação completa: `executeAtomic` SEMPRE chama `reverse()` e persiste em
 * `agent_reverse_ops`; `ReverseOpDeleteRowSchema` exige um UUID válido;
 * `table='_noop'` torna a row inerte; o endpoint `/undo` responde 410 Gone
 * genericamente para `_noop`, sem alteração necessária).
 *
 * MVP list-all-capped (brief D3 — retrieval rejeitado): o input SÓ aceita
 * `limit` opcional (cap de segurança), NUNCA `query`/`topic`/`keyword` — devolve
 * SEMPRE todas as memórias do household (cap N=50 mais recentes), tal como
 * `buildMemoryContext` (M-2) já faz para a injecção no motor. Um input sem
 * parâmetro de filtro torna estruturalmente impossível ao Planner tentar
 * "pesquisar por tema".
 *
 * Query-modelo EXACTA de `buildMemoryContext` (`run-agent.ts:955-961`, M-2):
 * schema-qualificado `public.jarvis_memories` [PO-FIX-2], `household_id`
 * explícito no WHERE, `order by created_at desc`, cap — a única diferença é o
 * `limit` vir de `input.limit ?? 50` em vez do literal fixo.
 *
 * Domínio: `memory` (Story M-1 — 4.ª tool do domínio, `TOOL_DOMAIN_VALUES` NÃO
 * muda).
 *
 * RLS (NFR5): `ctx.db` é cliente authenticated com JWT — RLS 2.ª rede filtra
 * `household_id` automaticamente; o filtro app-level explícito (`household_id =
 * ${ctx.householdId}`) é a 1.ª rede (defesa em profundidade). NUNCA
 * `getServiceDb()`. `householdId` vem SEMPRE de `ctx`, NUNCA do input.
 *
 * PII (NFR12): `content` das memórias é conteúdo pessoal sensível (risco R2 do
 * brief); nunca é incluído em span attributes/logs de erro.
 *
 * Trace: Story M-6 AC4 + brief epic v2-memoria-rica (§3 — recall directo) +
 *        PRD-Jarvis §5/§9 ("sabe tudo sobre mim").
 */
import { randomUUID } from 'node:crypto';

import { sql } from 'drizzle-orm';
import { z } from 'zod';

// Imports relativos — alias `@/` colide com aliases dos consumidores.
// Ver nota completa em `tasks/index.ts`.
import type {
  ReverseOpPayload,
  ToolDefinition,
  ToolExecutionContext,
} from '../contracts';

// ─────────────────────────────────────────────────────────────────────────────
// Schemas
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Input do `listar_memorias`.
 *
 * SÓ `limit` (1..50, cap de segurança) — SEM `query`/`topic`/`keyword`: o MVP
 * lista sempre tudo (brief D3, retrieval rejeitado). Sem `.default()` — o tipo
 * Zod assimétrico quebra `ZodType<I>` em `ToolDefinition` (mesma razão de
 * `listar-tarefas.ts`); default 50 aplicado em `execute()`.
 */
const ListarMemoriasInputSchema = z.object({
  limit: z.number().int().min(1).max(50).optional(),
});

export type ListarMemoriasInput = z.infer<typeof ListarMemoriasInputSchema>;

/**
 * Output do `listar_memorias`.
 *
 * `memories` são objectos `{ content, createdAt }` (não o array cru de
 * `consultar_emails`). O renderizador `renderReadToolResults` (format-results.ts)
 * DESEMBRULHA `output.memories` primeiro [PO-FIX-1].
 */
const ListarMemoriasOutputSchema = z.object({
  memories: z.array(
    z.object({
      content: z.string(),
      createdAt: z.string(),
    }),
  ),
  count: z.number().int().min(0),
});

export type ListarMemoriasOutput = z.infer<typeof ListarMemoriasOutputSchema>;

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Row devolvida pelo SELECT (colunas snake_case do Postgres).
 */
interface JarvisMemoriesSelectRow {
  readonly content: string;
  readonly created_at: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// Tool definition
// ─────────────────────────────────────────────────────────────────────────────

export const listarMemorias: ToolDefinition<
  ListarMemoriasInput,
  ListarMemoriasOutput
> = {
  name: 'listar_memorias',
  domain: 'memory',
  description:
    'Usa esta tool quando o utilizador quer VER/CONSULTAR o que o assistente já guardou sobre ele — as suas memórias (factos/preferências). Gatilhos: "o que sabes sobre mim?", "o que tens guardado sobre mim?", "quais são as minhas preferências que guardaste?", "mostra as minhas memórias". É LEITURA pura — mostra tudo o que está guardado (não guarda nem apaga nada, não aceita filtro por tema). Aceita apenas um limite opcional (1-50, default 50).',
  inputSchema: ListarMemoriasInputSchema,
  outputSchema: ListarMemoriasOutputSchema,
  estimatedTokens: 100,

  preview() {
    return 'Listar memórias guardadas';
  },

  async execute(input, ctx: ToolExecutionContext): Promise<ListarMemoriasOutput> {
    const limit = input.limit ?? 50;

    // Query-modelo de `buildMemoryContext` (M-2): schema-qualificado
    // `public.jarvis_memories` [PO-FIX-2], `household_id` explícito (1.ª rede) +
    // RLS via JWT (2.ª rede), `order by created_at desc`, cap. `householdId` vem
    // de `ctx` (NUNCA do input) — RLS NFR5. Drizzle parametriza os values.
    const result = (await ctx.db.execute(sql`
      select content, created_at
      from public.jarvis_memories
      where household_id = ${ctx.householdId}::uuid
      order by created_at desc
      limit ${limit}
    `)) as ReadonlyArray<JarvisMemoriesSelectRow>;

    return {
      memories: result.map((row) => ({
        content: row.content,
        createdAt: row.created_at,
      })),
      count: result.length,
    };
  },

  /**
   * Sentinela inerte `_noop` (R1b v1.1) — leitura não tem estado a reverter.
   * Mesmo pattern exacto de `listar_tarefas`/`listar_atrasadas` (ver JSDoc
   * desses ficheiros para a justificação completa).
   */
  async reverse(): Promise<ReverseOpPayload> {
    return {
      kind: 'delete_row',
      table: '_noop',
      id: randomUUID(),
    };
  },
};
