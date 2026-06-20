/**
 * Tool `atualizar_tarefa` — actualiza campos de uma tarefa existente.
 *
 * Domínio: `tasks`. Resolução de tarefa via `taskId` directo OU fuzzy match
 * por `taskTitle` (ILIKE case-insensitive, parametrizado — precedente
 * `completar-tarefa.ts`).
 *
 * Trace: Story 2.14 AC1 + PRD FR7 (Tarefas) + FR6 (undo 30s) + DP-2.14.D
 *        (campos editáveis: title, dueDate, priority, status, description).
 *
 * Pattern reverse_op: UPDATE → `{ kind: 'restore_row', table: 'tasks', id,
 * snapshot: {...campos pré-update em snake_case...} }`. O endpoint `/undo`
 * aplica o snapshot como UPDATE SET.
 *
 * **PO-FIX-1 (Story 2.14):** o snapshot usa chaves em snake_case porque o engine
 * de undo (`undo/route.ts`) usa as keys do snapshot LITERALMENTE como nomes de
 * coluna (`set ${k} = ...`). camelCase resultaria em "coluna inexistente".
 *
 * R-2.14.5: gestão coerente de `completedAt` com `status` — se `newStatus='done'`
 * e a tarefa não estava concluída, define `completed_at = now()`; se `newStatus`
 * != 'done', limpa `completed_at = null` (tarefa reaberta).
 *
 * RLS (NFR5): `ctx.db` é cliente authenticated — Postgres filtra automaticamente
 * por `household_id` via JWT claim. Tarefas de outros households nunca são
 * visíveis. NUNCA usa `getServiceDb()`.
 */
import { sql } from 'drizzle-orm';
import { z } from 'zod';

// Imports relativos — alias `@/` colide com aliases dos consumidores.
// Ver nota completa em `tasks/index.ts`.
import type {
  ReverseOpPayload,
  ToolDefinition,
  ToolExecutionContext,
} from '../contracts';
import { ToolExecutionError } from '../errors';

// ─────────────────────────────────────────────────────────────────────────────
// Schemas
// ─────────────────────────────────────────────────────────────────────────────

const AtualizarTarefaInputSchema = z
  .object({
    taskId: z.string().uuid().optional(),
    taskTitle: z.string().min(1).max(200).optional(),
    // Campos a actualizar:
    newTitle: z.string().min(1).max(200).optional(),
    newDueDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
    newPriority: z.enum(['low', 'medium', 'high']).optional(),
    newStatus: z.enum(['todo', 'doing', 'done', 'archived']).optional(),
    newDescription: z.string().max(2000).optional(),
  })
  .refine((d) => d.taskId !== undefined || d.taskTitle !== undefined, {
    message: 'Fornecer taskId ou taskTitle para identificar a tarefa',
  })
  .refine(
    (d) =>
      [d.newTitle, d.newDueDate, d.newPriority, d.newStatus, d.newDescription].some(
        (v) => v !== undefined,
      ),
    {
      message: 'Fornecer pelo menos um campo para actualizar',
    },
  );

export type AtualizarTarefaInput = z.infer<typeof AtualizarTarefaInputSchema>;

const AtualizarTarefaOutputSchema = z.object({
  taskId: z.string().uuid(),
  updatedFields: z.array(z.string()),
  /** Estado anterior dos campos alterados — chaves snake_case (PO-FIX-1). */
  snapshot: z.record(z.unknown()),
  warnings: z.array(z.string()).optional(),
});

export type AtualizarTarefaOutput = z.infer<typeof AtualizarTarefaOutputSchema>;

// ─────────────────────────────────────────────────────────────────────────────
// Helpers internos
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Row devolvida pela query de resolução — todos os campos potencialmente
 * actualizáveis (snake_case, para snapshot directo).
 */
interface ResolvedTaskRow {
  readonly id: string;
  readonly title: string;
  readonly description: string | null;
  readonly due_date: string | null;
  readonly priority: 'low' | 'medium' | 'high';
  readonly status: 'todo' | 'doing' | 'done' | 'archived';
  readonly completed_at: string | null;
  readonly match_count: number;
}

/**
 * Resolve a tarefa por `taskId` directo ou fuzzy match ILIKE por `taskTitle`.
 * Devolve `null` quando zero matches.
 *
 * Selecciona TODOS os campos editáveis (snake_case) para capturar o snapshot
 * pré-update sem segunda query.
 */
async function resolveTask(
  input: AtualizarTarefaInput,
  ctx: ToolExecutionContext,
): Promise<ResolvedTaskRow | null> {
  if (input.taskId !== undefined) {
    const result = (await ctx.db.execute(sql`
      select id, title, description, due_date, priority, status, completed_at,
             1::int as match_count
      from tasks
      where id = ${input.taskId}
      limit 1
    `)) as ReadonlyArray<ResolvedTaskRow>;
    return result[0] ?? null;
  }

  const titlePattern = `%${input.taskTitle ?? ''}%`;
  const result = (await ctx.db.execute(sql`
    with matches as (
      select id, title, description, due_date, priority, status, completed_at
      from tasks
      where title ilike ${titlePattern}
      order by created_at desc
    )
    select
      m.id,
      m.title,
      m.description,
      m.due_date,
      m.priority,
      m.status,
      m.completed_at,
      (select count(*)::int from matches) as match_count
    from matches m
    limit 1
  `)) as ReadonlyArray<ResolvedTaskRow>;

  return result[0] ?? null;
}

interface UpdateTaskReturn {
  readonly id: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// Tool definition
// ─────────────────────────────────────────────────────────────────────────────

export const atualizarTarefa: ToolDefinition<
  AtualizarTarefaInput,
  AtualizarTarefaOutput
> = {
  name: 'atualizar_tarefa',
  domain: 'tasks',
  description:
    'Usa esta tool quando o utilizador quer editar, alterar ou modificar uma tarefa existente — mudar a data, prioridade, título, estado ou descrição. Aceita taskId (UUID directo) ou taskTitle (resolve por correspondência parcial case-insensitive — usa a tarefa mais recente se houver múltiplas).',
  inputSchema: AtualizarTarefaInputSchema,
  outputSchema: AtualizarTarefaOutputSchema,
  estimatedTokens: 90,

  preview(input) {
    const alvo = input.taskTitle ? `'${input.taskTitle}'` : 'a tarefa';
    const partes: string[] = [];
    if (input.newTitle !== undefined) partes.push(`título → '${input.newTitle}'`);
    if (input.newDueDate !== undefined) partes.push(`data → ${input.newDueDate}`);
    if (input.newPriority !== undefined) partes.push(`prioridade → ${input.newPriority}`);
    if (input.newStatus !== undefined) partes.push(`estado → ${input.newStatus}`);
    if (input.newDescription !== undefined) partes.push('descrição');
    return `Actualizar ${alvo}: ${partes.join(', ')}`;
  },

  async execute(input, ctx: ToolExecutionContext): Promise<AtualizarTarefaOutput> {
    // 1) Resolver a tarefa.
    const resolved = await resolveTask(input, ctx);
    if (!resolved) {
      const hint = input.taskTitle
        ? `com o nome '${input.taskTitle}'`
        : `com o identificador fornecido`;
      throw new ToolExecutionError(
        'atualizar_tarefa',
        new Error(
          `Não encontrei nenhuma tarefa ${hint}. Verifica o nome e tenta novamente.`,
        ),
      );
    }

    // 2) Capturar snapshot dos campos a alterar (snake_case — PO-FIX-1).
    //    Apenas os campos efectivamente fornecidos no input entram no snapshot.
    const snapshot: Record<string, unknown> = {};
    const updatedFields: string[] = [];
    const setClauses: ReturnType<typeof sql>[] = [];

    if (input.newTitle !== undefined) {
      snapshot.title = resolved.title;
      updatedFields.push('title');
      setClauses.push(sql`title = ${input.newTitle}`);
    }
    if (input.newDescription !== undefined) {
      snapshot.description = resolved.description;
      updatedFields.push('description');
      setClauses.push(sql`description = ${input.newDescription}`);
    }
    if (input.newDueDate !== undefined) {
      snapshot.due_date = resolved.due_date;
      updatedFields.push('due_date');
      setClauses.push(sql`due_date = ${input.newDueDate}::date`);
    }
    if (input.newPriority !== undefined) {
      snapshot.priority = resolved.priority;
      updatedFields.push('priority');
      setClauses.push(sql`priority = ${input.newPriority}::task_priority`);
    }
    if (input.newStatus !== undefined) {
      snapshot.status = resolved.status;
      updatedFields.push('status');
      setClauses.push(sql`status = ${input.newStatus}::task_status`);

      // R-2.14.5: coerência completedAt ↔ status. Guardamos sempre o
      // completed_at anterior no snapshot porque o vamos mexer.
      snapshot.completed_at = resolved.completed_at;
      if (!updatedFields.includes('completed_at')) {
        updatedFields.push('completed_at');
      }
      if (input.newStatus === 'done') {
        setClauses.push(sql`completed_at = now()`);
      } else {
        setClauses.push(sql`completed_at = null`);
      }
    }

    // 3) UPDATE — RLS via household_id (JWT). updated_at = now() sempre.
    const updateResult = (await ctx.db.execute(sql`
      update tasks
      set ${sql.join(setClauses, sql`, `)},
          updated_at = now()
      where id = ${resolved.id}
      returning id
    `)) as ReadonlyArray<UpdateTaskReturn>;

    const updated = updateResult[0];
    if (!updated) {
      throw new ToolExecutionError(
        'atualizar_tarefa',
        new Error('UPDATE em tasks não devolveu row (RLS ou race condition)'),
      );
    }

    // 4) Warnings se fuzzy encontrou múltiplos matches.
    const warnings: string[] = [];
    if (input.taskTitle && resolved.match_count > 1) {
      warnings.push(
        `Encontrei ${String(resolved.match_count)} tarefas com '${input.taskTitle}'. Actualizei a mais recente ('${resolved.title}').`,
      );
    }

    return {
      taskId: updated.id,
      updatedFields,
      snapshot,
      ...(warnings.length > 0 ? { warnings } : {}),
    };
  },

  async reverse(output): Promise<ReverseOpPayload> {
    return {
      kind: 'restore_row',
      table: 'tasks',
      id: output.taskId,
      snapshot: output.snapshot,
    };
  },
};
