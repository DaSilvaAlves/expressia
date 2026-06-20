/**
 * Tool `eliminar_tarefa` — elimina (hard DELETE) uma tarefa existente.
 *
 * Domínio: `tasks`. Resolução de tarefa via `taskId` directo OU fuzzy match
 * por `taskTitle` (precedente `completar-tarefa.ts`).
 *
 * **Preview obrigatório (DP-2.14.B):** uma eliminação é sempre confirmada antes
 * de executar. Se `confirmed !== true`, a tool faz early-return com
 * `needsConfirmation: true` SEM executar o DELETE e SEM persistir reverse_op.
 * O endpoint `/api/agent/prompt` detecta `needsConfirmation: true` e converte a
 * resposta em preview-then-confirm (Story 2.7 / AC10).
 *
 * Trace: Story 2.14 AC2 + PRD FR6 (undo 30s) + Epic 2 §1 (conservador na
 *        destruição).
 *
 * Pattern reverse_op: hard DELETE → `{ kind: 'reinsert_row', table: 'tasks',
 * id, snapshot: {...row completa em snake_case...} }`. `restore_row` faz apenas
 * UPDATE — não funciona para rows eliminadas (FIX-1, Story 2.14).
 *
 * **PO-FIX-1 (Story 2.14):** o snapshot usa chaves snake_case porque o engine de
 * undo usa as keys LITERALMENTE como nomes de coluna no INSERT
 * (`insert into tasks (${cols}) ...`). O snapshot é capturado via RETURNING com
 * todos os campos da row, já em snake_case.
 *
 * RLS (NFR5): `ctx.db` é cliente authenticated — Postgres filtra por
 * `household_id` via JWT. NUNCA usa `getServiceDb()`.
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

const EliminarTarefaInputSchema = z
  .object({
    taskId: z.string().uuid().optional(),
    taskTitle: z.string().min(1).max(200).optional(),
    // DP-2.14.B: ausência tratada como `false` a jusante (`execute` faz
    // `input.confirmed !== true`). NÃO usar `.default(false)` — o ZodDefault
    // torna o tipo de INPUT do schema incompatível com o `I` exigido por
    // `ToolDefinition<I, O>` (z.ZodType<I> exige `confirmed: boolean`, mas o
    // input do default é `confirmed?: boolean`). Precedente: nenhuma tool do
    // package usa `.default()` no inputSchema. [DEV-DECISION D-2.14.1]
    confirmed: z.boolean().optional(),
  })
  .refine((d) => d.taskId !== undefined || d.taskTitle !== undefined, {
    message: 'Fornecer taskId ou taskTitle para identificar a tarefa a eliminar',
  });

export type EliminarTarefaInput = z.infer<typeof EliminarTarefaInputSchema>;

const EliminarTarefaOutputSchema = z.object({
  taskId: z.string().uuid(),
  title: z.string(),
  needsConfirmation: z.boolean(),
  /** Snapshot completo (snake_case) — só preenchido após DELETE efectivo. */
  snapshot: z.record(z.unknown()).optional(),
  warnings: z.array(z.string()).optional(),
});

export type EliminarTarefaOutput = z.infer<typeof EliminarTarefaOutputSchema>;

// ─────────────────────────────────────────────────────────────────────────────
// Helpers internos
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Row de resolução — campos snake_case necessários para o snapshot completo
 * (suficiente para re-inserir a tarefa via reinsert_row).
 */
interface ResolvedTaskRow {
  readonly id: string;
  readonly household_id: string;
  readonly created_by_user_id: string;
  readonly assigned_to_user_id: string | null;
  readonly title: string;
  readonly description: string | null;
  readonly due_date: string | null;
  readonly due_time: string | null;
  readonly priority: string;
  readonly status: string;
  readonly kanban_column_id: string | null;
  readonly kanban_position: number | null;
  readonly project: string | null;
  readonly recurrence_id: string | null;
  readonly is_recurrence_template: boolean;
  readonly completed_at: string | null;
  readonly created_at: string;
  readonly match_count: number;
}

async function resolveTask(
  input: EliminarTarefaInput,
  ctx: ToolExecutionContext,
): Promise<ResolvedTaskRow | null> {
  if (input.taskId !== undefined) {
    const result = (await ctx.db.execute(sql`
      select id, household_id, created_by_user_id, assigned_to_user_id, title,
             description, due_date, due_time, priority, status, kanban_column_id,
             kanban_position, project, recurrence_id, is_recurrence_template,
             completed_at, created_at, 1::int as match_count
      from tasks
      where id = ${input.taskId}
      limit 1
    `)) as ReadonlyArray<ResolvedTaskRow>;
    return result[0] ?? null;
  }

  const titlePattern = `%${input.taskTitle ?? ''}%`;
  const result = (await ctx.db.execute(sql`
    with matches as (
      select id, household_id, created_by_user_id, assigned_to_user_id, title,
             description, due_date, due_time, priority, status, kanban_column_id,
             kanban_position, project, recurrence_id, is_recurrence_template,
             completed_at, created_at
      from tasks
      where title ilike ${titlePattern}
      order by created_at desc
    )
    select
      m.*,
      (select count(*)::int from matches) as match_count
    from matches m
    limit 1
  `)) as ReadonlyArray<ResolvedTaskRow>;

  return result[0] ?? null;
}

/**
 * Constrói o snapshot completo (snake_case) a partir da row resolvida.
 * O `id` é excluído daqui — o engine de undo injecta-o explicitamente a partir
 * de `op.id`.
 */
function buildSnapshot(row: ResolvedTaskRow): Record<string, unknown> {
  return {
    household_id: row.household_id,
    created_by_user_id: row.created_by_user_id,
    assigned_to_user_id: row.assigned_to_user_id,
    title: row.title,
    description: row.description,
    due_date: row.due_date,
    due_time: row.due_time,
    priority: row.priority,
    status: row.status,
    kanban_column_id: row.kanban_column_id,
    kanban_position: row.kanban_position,
    project: row.project,
    recurrence_id: row.recurrence_id,
    is_recurrence_template: row.is_recurrence_template,
    completed_at: row.completed_at,
    created_at: row.created_at,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Tool definition
// ─────────────────────────────────────────────────────────────────────────────

export const eliminarTarefa: ToolDefinition<
  EliminarTarefaInput,
  EliminarTarefaOutput
> = {
  name: 'eliminar_tarefa',
  domain: 'tasks',
  description:
    'Usa esta tool quando o utilizador quer apagar, eliminar ou remover permanentemente uma tarefa. Requer confirmação explícita — gera sempre um preview antes de executar. Aceita taskId (UUID directo) ou taskTitle (correspondência parcial case-insensitive).',
  inputSchema: EliminarTarefaInputSchema,
  outputSchema: EliminarTarefaOutputSchema,
  estimatedTokens: 90,

  preview(input) {
    const alvo = input.taskTitle ? `'${input.taskTitle}'` : 'a tarefa indicada';
    return `Eliminar tarefa ${alvo} — CONFIRMAR`;
  },

  async execute(input, ctx: ToolExecutionContext): Promise<EliminarTarefaOutput> {
    // 1) Resolver a tarefa.
    const resolved = await resolveTask(input, ctx);
    if (!resolved) {
      const hint = input.taskTitle
        ? `com o nome '${input.taskTitle}'`
        : `com o identificador fornecido`;
      throw new ToolExecutionError(
        'eliminar_tarefa',
        new Error(
          `Não encontrei nenhuma tarefa ${hint}. Verifica o nome e tenta novamente.`,
        ),
      );
    }

    const warnings: string[] = [];
    if (input.taskTitle && resolved.match_count > 1) {
      warnings.push(
        `Encontrei ${String(resolved.match_count)} tarefas com '${input.taskTitle}'. Vou eliminar a mais recente ('${resolved.title}').`,
      );
    }

    // 2) Preview obrigatório (DP-2.14.B) — sem confirmação, não elimina nem
    //    persiste reverse_op.
    if (input.confirmed !== true) {
      return {
        taskId: resolved.id,
        title: resolved.title,
        needsConfirmation: true,
        ...(warnings.length > 0 ? { warnings } : {}),
      };
    }

    // 3) Confirmado — capturar snapshot completo e executar DELETE.
    const snapshot = buildSnapshot(resolved);

    await ctx.db.execute(sql`
      delete from tasks
      where id = ${resolved.id}
    `);

    return {
      taskId: resolved.id,
      title: resolved.title,
      needsConfirmation: false,
      snapshot,
      ...(warnings.length > 0 ? { warnings } : {}),
    };
  },

  async reverse(output): Promise<ReverseOpPayload> {
    return {
      kind: 'reinsert_row',
      table: 'tasks',
      id: output.taskId,
      snapshot: output.snapshot ?? {},
    };
  },
};
