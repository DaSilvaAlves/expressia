/**
 * Tool `listar_tarefas` — lista tarefas do agregado com filtros opcionais.
 *
 * Tool **read-only** — produz row inerte em `agent_reverse_ops` com
 * `table = '_noop'` (R1b v1.1). Justificação:
 *
 *   - `executeAtomic` (`packages/tools/src/atomic.ts:217-261`) SEMPRE chama
 *     `reverse()` e SEMPRE persiste em `agent_reverse_ops` — sem condicional
 *     sobre se a tool fez writes.
 *   - `ReverseOpDeleteRowSchema` (`packages/tools/src/contracts.ts:158-162`)
 *     exige `id: z.string().uuid()` — qualquer placeholder não-UUID falha
 *     Zod e dispara `ToolValidationError` em runtime.
 *
 * Solução: UUID válido + `table` sentinela `_noop` (tabela que não existe
 * fisicamente). Row persiste em `agent_reverse_ops` mas é **inerte**:
 *
 *   - Job Inngest cleanup (Story 2.8 housekeeping — Risk R-3.8.5) deve
 *     filtrar `reverse_op->>'table' = '_noop'` adicionalmente ao TTL
 *     `expires_at < now()`.
 *   - Endpoint `POST /api/agent/prompt/[runId]/undo` deve responder
 *     410 Gone para `reverse_op->>'table' = '_noop'` (FR6 não-aplicável a
 *     reads).
 *
 * Domínio: `tasks` (não `query` — semanticamente é uma operação no domínio
 * Tarefas, mesmo sendo read-only).
 *
 * Trace: Story 3.8 AC3 + AC8 (R1b v1.1) + PRD FR7 (Tarefas) +
 *        Architecture §3.1 (módulo Tarefas) + EPIC-3-EXECUTION §stories[3.8].
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
 * Input do `listar_tarefas`.
 *
 * - `status`: filtra por status enum (todo/doing/done/archived). Sem filtro
 *   retorna todos os status excepto archived (default sensato para chat).
 * - `dueDateFrom`, `dueDateTo`: intervalo ISO 8601 date. Ambos opcionais.
 * - `limit`: máximo 50 (default 10). Para listas longas o utilizador deve
 *   usar a UI `/tarefas`.
 */
const ListarTarefasInputSchema = z.object({
  status: z.enum(['todo', 'doing', 'done', 'archived']).optional(),
  dueDateFrom: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, 'dueDateFrom deve estar no formato YYYY-MM-DD')
    .optional(),
  dueDateTo: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, 'dueDateTo deve estar no formato YYYY-MM-DD')
    .optional(),
  // Sem `.default()` — asymmetric Zod type quebra `ZodType<I>` em
  // `ToolDefinition`. Default 10 aplicado em `execute()`.
  limit: z.number().int().min(1).max(50).optional(),
});

export type ListarTarefasInput = z.infer<typeof ListarTarefasInputSchema>;

/**
 * Output do `listar_tarefas`.
 */
const ListarTarefasOutputSchema = z.object({
  tasks: z.array(
    z.object({
      id: z.string().uuid(),
      title: z.string(),
      dueDate: z.string().nullable(),
      priority: z.enum(['low', 'medium', 'high']),
      status: z.enum(['todo', 'doing', 'done', 'archived']),
    }),
  ),
  count: z.number().int().min(0),
});

export type ListarTarefasOutput = z.infer<typeof ListarTarefasOutputSchema>;

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Row devolvida pelo SELECT (colunas snake_case do Postgres).
 */
interface TasksSelectRow {
  readonly id: string;
  readonly title: string;
  readonly due_date: string | null;
  readonly priority: 'low' | 'medium' | 'high';
  readonly status: 'todo' | 'doing' | 'done' | 'archived';
}

// ─────────────────────────────────────────────────────────────────────────────
// Tool definition
// ─────────────────────────────────────────────────────────────────────────────

export const listarTarefas: ToolDefinition<
  ListarTarefasInput,
  ListarTarefasOutput
> = {
  name: 'listar_tarefas',
  domain: 'tasks',
  description:
    'Usa esta tool quando o utilizador quer ver/listar tarefas do agregado familiar. Suporta filtros opcionais: status (todo/doing/done/archived), intervalo de datas previstas (dueDateFrom/dueDateTo, formato YYYY-MM-DD) e limite (1-50, default 10).',
  inputSchema: ListarTarefasInputSchema,
  outputSchema: ListarTarefasOutputSchema,
  estimatedTokens: 100,

  preview(input) {
    const filters: string[] = [];
    if (input.status) filters.push(`status=${input.status}`);
    if (input.dueDateFrom) filters.push(`desde ${input.dueDateFrom}`);
    if (input.dueDateTo) filters.push(`até ${input.dueDateTo}`);
    if (filters.length === 0) return 'Listar tarefas';
    return `Listar tarefas (${filters.join(', ')})`;
  },

  async execute(input, ctx: ToolExecutionContext): Promise<ListarTarefasOutput> {
    // Filtros dinâmicos via SQL template — Drizzle parametriza valores. RLS
    // via JWT garante household_id isolation (filtra automaticamente).
    //
    // Sem filtro `status`: excluímos `archived` por default (a maioria das
    // perguntas conversacionais não quer ver arquivadas). Se o utilizador
    // pediu explicitamente status='archived', mostramos.
    const statusFilter = input.status
      ? sql`and status = ${input.status}::task_status`
      : sql`and status != 'archived'::task_status`;
    const dueFromFilter = input.dueDateFrom
      ? sql`and due_date >= ${input.dueDateFrom}::date`
      : sql``;
    const dueToFilter = input.dueDateTo
      ? sql`and due_date <= ${input.dueDateTo}::date`
      : sql``;

    const limit = input.limit ?? 10;

    const result = (await ctx.db.execute(sql`
      select id, title, due_date, priority, status
      from tasks
      where 1=1
      ${statusFilter}
      ${dueFromFilter}
      ${dueToFilter}
      order by due_date asc nulls last, created_at desc
      limit ${limit}
    `)) as ReadonlyArray<TasksSelectRow>;

    return {
      tasks: result.map((row) => ({
        id: row.id,
        title: row.title,
        dueDate: row.due_date,
        priority: row.priority,
        status: row.status,
      })),
      count: result.length,
    };
  },

  /**
   * Sentinela inerte `_noop` (R1b v1.1).
   *
   * Tool read-only — FR6 undo conceptualmente não-aplicável.
   * `executeAtomic` força persistência de uma row em `agent_reverse_ops`;
   * usamos `table='_noop'` + UUID válido para satisfazer
   * `ReverseOpDeleteRowSchema` sem permitir undo real.
   *
   * Endpoint `/undo` deve responder 410 Gone quando lê
   * `reverse_op->>'table' = '_noop'` (housekeeping Story 2.8 — não bloqueante).
   *
   * Job Inngest cleanup deve filtrar `_noop` rows agressivamente (TTL 30s já
   * elimina-as no ciclo nocturno default).
   */
  async reverse(): Promise<ReverseOpPayload> {
    return {
      kind: 'delete_row',
      table: '_noop',
      id: randomUUID(),
    };
  },
};
