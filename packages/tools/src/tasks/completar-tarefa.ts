/**
 * Tool `completar_tarefa` — marca uma tarefa como concluída.
 *
 * Domínio: `tasks`. Resolução de tarefa via `taskId` directo OU fuzzy match
 * por `taskTitle` (ILIKE case-insensitive, parametrizado — NIT-PO-3.8.3
 * compliance).
 *
 * Trace: Story 3.8 AC2 + PRD FR7 (Tarefas) + FR6 (undo 30s) +
 *        EPIC-3-EXECUTION §stories[3.8] (fuzzy match by title).
 *
 * Pattern reverse_op: UPDATE → `{ kind: 'restore_row', table: 'tasks', id,
 * snapshot: { status: prevStatus, completedAt: null } }`. O endpoint
 * `/undo` restaura o status anterior.
 *
 * RLS (NFR5): `ctx.db` é cliente authenticated — Postgres filtra automaticamente
 * por `household_id` via JWT claim. Tarefas de outros households nunca são
 * visíveis (RLS bloqueia leitura E escrita).
 *
 * Fuzzy match (R-3.8.1): se múltiplos matches, usa o mais recente por
 * `created_at DESC` LIMIT 1 e regista `warnings` no output.
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

/**
 * Input do `completar_tarefa`.
 *
 * Pelo menos UM dos dois deve ser fornecido — refine() valida.
 */
const CompletarTarefaInputSchema = z
  .object({
    taskId: z.string().uuid().optional(),
    taskTitle: z.string().min(1).max(200).optional(),
  })
  .refine((d) => d.taskId !== undefined || d.taskTitle !== undefined, {
    message: 'Fornecer taskId ou taskTitle',
  });

export type CompletarTarefaInput = z.infer<typeof CompletarTarefaInputSchema>;

/**
 * Output do `completar_tarefa`.
 *
 * - `prevStatus`: capturado ANTES do UPDATE para suportar undo (restore_row
 *   snapshot).
 * - `completedAt`: timestamp ISO devolvido pelo Postgres.
 * - `warnings`: lista PT-PT de avisos quando fuzzy match encontrou múltiplas
 *   tarefas (manter contexto que se perderia de outro modo).
 */
const CompletarTarefaOutputSchema = z.object({
  taskId: z.string().uuid(),
  title: z.string(),
  prevStatus: z.enum(['todo', 'doing', 'done', 'archived']),
  completedAt: z.string(),
  warnings: z.array(z.string()).optional(),
});

export type CompletarTarefaOutput = z.infer<typeof CompletarTarefaOutputSchema>;

// ─────────────────────────────────────────────────────────────────────────────
// Helpers internos
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Row devolvida pela query de resolução fuzzy.
 */
interface ResolvedTaskRow {
  readonly id: string;
  readonly title: string;
  readonly status: 'todo' | 'doing' | 'done' | 'archived';
  readonly match_count: number;
}

/**
 * Resolve `taskId` a partir do input. Se `taskId` fornecido directamente, faz
 * SELECT minimal para capturar `status` actual e validar existência. Se apenas
 * `taskTitle` fornecido, faz fuzzy match ILIKE com ordenação por `created_at DESC`.
 *
 * Devolve `null` quando zero matches (caller transforma em ToolExecutionError
 * com `userMessage` PT-PT).
 *
 * NIT-PO-3.8.3 compliance: usa `ilike` SQL parametrizado, nunca string
 * concatenation. O `%` wildcards estão em valores parametrizados via Drizzle
 * template tag — safe contra injection.
 */
async function resolveTask(
  input: CompletarTarefaInput,
  ctx: ToolExecutionContext,
): Promise<ResolvedTaskRow | null> {
  // Caso 1: taskId directo — RLS valida household_id automaticamente.
  if (input.taskId !== undefined) {
    const result = (await ctx.db.execute(sql`
      select id, title, status, 1::int as match_count
      from tasks
      where id = ${input.taskId}
        and status != 'done'::task_status
      limit 1
    `)) as ReadonlyArray<ResolvedTaskRow>;
    return result[0] ?? null;
  }

  // Caso 2: fuzzy match por título — ILIKE com wildcards parametrizados.
  // O LIKE pattern `%{taskTitle}%` é construído por concatenação SQL (não JS),
  // mantendo o valor do utilizador como bind parameter — safe contra injection.
  // RLS via JWT garante isolamento por household_id.
  const titlePattern = `%${input.taskTitle ?? ''}%`;
  const result = (await ctx.db.execute(sql`
    with matches as (
      select id, title, status
      from tasks
      where status != 'done'::task_status
        and title ilike ${titlePattern}
      order by created_at desc
    )
    select
      m.id,
      m.title,
      m.status,
      (select count(*)::int from matches) as match_count
    from matches m
    limit 1
  `)) as ReadonlyArray<ResolvedTaskRow>;

  return result[0] ?? null;
}

/**
 * Row devolvida pelo UPDATE tasks RETURNING ...
 */
interface UpdateTaskReturn {
  readonly id: string;
  readonly title: string;
  readonly completed_at: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// Tool definition
// ─────────────────────────────────────────────────────────────────────────────

export const completarTarefa: ToolDefinition<
  CompletarTarefaInput,
  CompletarTarefaOutput
> = {
  name: 'completar_tarefa',
  domain: 'tasks',
  description:
    'Usa esta tool quando o utilizador quer marcar uma tarefa como concluída/feita. Aceita taskId (UUID directo) ou taskTitle (resolve por correspondência parcial case-insensitive — usa a tarefa mais recente se houver múltiplas).',
  inputSchema: CompletarTarefaInputSchema,
  outputSchema: CompletarTarefaOutputSchema,
  estimatedTokens: 80,

  preview(input) {
    if (input.taskTitle) {
      return `Marcar '${input.taskTitle}' como concluída`;
    }
    return `Marcar tarefa como concluída`;
  },

  async execute(input, ctx: ToolExecutionContext): Promise<CompletarTarefaOutput> {
    // 1) Resolver a tarefa.
    const resolved = await resolveTask(input, ctx);
    if (!resolved) {
      const hint = input.taskTitle
        ? `com o nome '${input.taskTitle}'`
        : `com o identificador fornecido`;
      throw new ToolExecutionError(
        'completar_tarefa',
        new Error(
          `Não encontrei nenhuma tarefa ${hint}. Verifica o nome e tenta novamente.`,
        ),
      );
    }

    // 2) Capturar prevStatus para undo (snapshot do restore_row).
    const prevStatus = resolved.status;

    // 3) UPDATE — RLS via household_id garantido pelo JWT (defesa adicional via
    //    `where id = ...` apenas; cross-household não atinge esta linha de
    //    qualquer modo).
    const updateResult = (await ctx.db.execute(sql`
      update tasks
      set status = 'done'::task_status,
          completed_at = now(),
          updated_at = now()
      where id = ${resolved.id}
      returning id, title, completed_at
    `)) as ReadonlyArray<UpdateTaskReturn>;

    const updated = updateResult[0];
    if (!updated) {
      throw new ToolExecutionError(
        'completar_tarefa',
        new Error('UPDATE em tasks não devolveu row (RLS ou race condition)'),
      );
    }

    // 4) Construir output + warnings se fuzzy encontrou múltiplos matches.
    const warnings: string[] = [];
    if (input.taskTitle && resolved.match_count > 1) {
      warnings.push(
        `Encontrei ${String(resolved.match_count)} tarefas com '${input.taskTitle}'. Concluí a mais recente ('${resolved.title}').`,
      );
    }

    return {
      taskId: updated.id,
      title: updated.title,
      prevStatus,
      completedAt: updated.completed_at,
      ...(warnings.length > 0 ? { warnings } : {}),
    };
  },

  async reverse(output): Promise<ReverseOpPayload> {
    return {
      kind: 'restore_row',
      table: 'tasks',
      id: output.taskId,
      snapshot: {
        status: output.prevStatus,
        completed_at: null,
      },
    };
  },
};
