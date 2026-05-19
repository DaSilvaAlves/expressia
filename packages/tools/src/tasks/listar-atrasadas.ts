/**
 * Tool `listar_atrasadas` — lista tarefas em atraso (due_date < today).
 *
 * Read-only — usa sentinela `_noop` em `reverse()` (mesmo pattern R1b v1.1
 * que `listar_tarefas` — ver JSDoc desse ficheiro para justificação completa).
 *
 * Filtros aplicados sempre:
 *   - `due_date < CURRENT_DATE`
 *   - `status NOT IN ('done', 'archived')`
 *
 * Usa index `tasks_overdue_idx` em `(household_id, due_date, status)` —
 * confirmado em `packages/db/src/schema/tasks.ts:106`.
 *
 * Trace: Story 3.8 AC4 + PRD FR11 (vista "atrasadas") +
 *        EPIC-3-EXECUTION §stories[3.8].
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
 * Input do `listar_atrasadas`.
 *
 * `limit` máximo 20 (mais conservador que `listar_tarefas` — vista atrasadas
 * em chat deve ser concisa; full list via UI `/tarefas`).
 */
const ListarAtrasadasInputSchema = z.object({
  // Sem `.default()` — asymmetric Zod type quebra `ZodType<I>` em
  // `ToolDefinition`. Default 10 aplicado em `execute()`.
  limit: z.number().int().min(1).max(20).optional(),
});

export type ListarAtrasadasInput = z.infer<typeof ListarAtrasadasInputSchema>;

/**
 * Output do `listar_atrasadas`.
 *
 * `daysOverdue` calculado em SQL: `CURRENT_DATE - due_date` (em dias inteiros).
 */
const ListarAtrasadasOutputSchema = z.object({
  tasks: z.array(
    z.object({
      id: z.string().uuid(),
      title: z.string(),
      dueDate: z.string(),
      priority: z.enum(['low', 'medium', 'high']),
      daysOverdue: z.number().int().min(1),
    }),
  ),
  count: z.number().int().min(0),
});

export type ListarAtrasadasOutput = z.infer<typeof ListarAtrasadasOutputSchema>;

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

interface OverdueTasksRow {
  readonly id: string;
  readonly title: string;
  readonly due_date: string;
  readonly priority: 'low' | 'medium' | 'high';
  readonly days_overdue: number;
}

// ─────────────────────────────────────────────────────────────────────────────
// Tool definition
// ─────────────────────────────────────────────────────────────────────────────

export const listarAtrasadas: ToolDefinition<
  ListarAtrasadasInput,
  ListarAtrasadasOutput
> = {
  name: 'listar_atrasadas',
  domain: 'tasks',
  description:
    'Usa esta tool quando o utilizador quer ver tarefas em atraso (data prevista passada e ainda não concluídas). Apenas mostra tarefas com status todo/doing e dueDate anterior a hoje. Limite máximo 20 (default 10).',
  inputSchema: ListarAtrasadasInputSchema,
  outputSchema: ListarAtrasadasOutputSchema,
  estimatedTokens: 80,

  preview() {
    return 'Listar tarefas em atraso';
  },

  async execute(input, ctx: ToolExecutionContext): Promise<ListarAtrasadasOutput> {
    const limit = input.limit ?? 10;

    // `due_date < CURRENT_DATE` AND `status NOT IN (done, archived)` — usa
    // index composto `tasks_overdue_idx (household_id, due_date, status)`.
    // RLS via JWT filtra household_id automaticamente.
    //
    // `days_overdue` calculado via `CURRENT_DATE - due_date` (Postgres devolve
    // integer em dias para subtracção date - date).
    const result = (await ctx.db.execute(sql`
      select
        id,
        title,
        due_date,
        priority,
        (current_date - due_date)::int as days_overdue
      from tasks
      where due_date is not null
        and due_date < current_date
        and status not in ('done'::task_status, 'archived'::task_status)
      order by due_date asc
      limit ${limit}
    `)) as ReadonlyArray<OverdueTasksRow>;

    return {
      tasks: result.map((row) => ({
        id: row.id,
        title: row.title,
        dueDate: row.due_date,
        priority: row.priority,
        daysOverdue: row.days_overdue,
      })),
      count: result.length,
    };
  },

  /**
   * Sentinela inerte `_noop` (R1b v1.1) — mesmo pattern que `listar_tarefas`.
   * Ver JSDoc desse ficheiro para justificação completa.
   */
  async reverse(): Promise<ReverseOpPayload> {
    return {
      kind: 'delete_row',
      table: '_noop',
      id: randomUUID(),
    };
  },
};
