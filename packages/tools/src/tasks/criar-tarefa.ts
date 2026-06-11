/**
 * Tool `criar_tarefa` — cria uma nova tarefa no agregado.
 *
 * Domínio: `tasks`. Scope minimal (Story 3.8 DP5: A): `title` + `dueDate?` +
 * `priority?`. Campos avançados (`assignee`, `tags`, `kanbanColumn`) ficam
 * para tools complementares futuras (`atribuir_tarefa`, `aplicar_tag_a_tarefa`,
 * etc.) — manter `criar_tarefa` minimal preserva UX de chat rápido.
 *
 * Trace: Story 3.8 AC1 + PRD FR7 (Tarefas) + FR4 (preview-then-confirm) +
 *        FR6 (undo 30s) + Architecture §3.1 (módulo Tarefas) +
 *        EPIC-3-EXECUTION §stories[3.8] (minimal payload).
 *
 * RLS (NFR5): `ctx.db` é cliente authenticated com JWT — `household_id` é
 * derivado de `ctx.householdId`, NUNCA do input do utilizador. Postgres
 * rejeita INSERT cross-household por policy `WITH CHECK`.
 *
 * PII (NFR12): `title` é tratado como conteúdo de utilizador; nunca é incluído
 * em span attributes. Apenas o `taskId` (UUID) entra em `agent_reverse_ops`.
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
 * Input do `criar_tarefa`.
 *
 * - `title`: 1..200 caracteres (corresponde a `tasks.title text not null` —
 *   200 é limite conservador para chat rápido; tarefas longas via UI).
 * - `dueDate`: ISO 8601 date (YYYY-MM-DD). Opcional.
 * - `dueTime`: hora prevista HH:MM 24h (OBS-2). Só permitida quando há
 *   `dueDate` — uma hora sem dia é ambígua (mesma regra de domínio do P1, onde
 *   o campo Hora fica desactivado sem prazo). Formato espelha o check constraint
 *   `tasks_due_time_format` (`^[0-2][0-9]:[0-5][0-9]$`). Opcional.
 * - `priority`: enum alinhado com `task_priority` Postgres. Default `medium`.
 */
const CriarTarefaInputSchema = z
  .object({
    title: z.string().min(1).max(200),
    dueDate: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/, 'dueDate deve estar no formato YYYY-MM-DD')
      .optional(),
    dueTime: z
      .string()
      .regex(
        /^[0-2][0-9]:[0-5][0-9]$/,
        'dueTime deve estar no formato HH:MM (24h)',
      )
      .optional(),
    // Sem `.default()` aqui — asymmetric input/output do Zod quebra
    // `ZodType<I>` em `ToolDefinition`. O default `'medium'` é aplicado
    // dentro de `execute()` via nullish coalescing.
    priority: z.enum(['low', 'medium', 'high']).optional(),
  })
  // Regra de domínio (OBS-2): `dueTime` só faz sentido com `dueDate`. `.refine()`
  // mantém input/output simétricos (ao contrário de `.default()`), logo preserva
  // `ZodType<I>` em `ToolDefinition`. zodToJsonSchema ignora o refine (não é
  // exprimível em JSON Schema), por isso a regra é reforçada também na
  // `description` para o LLM e validada em runtime no parse de `executeAtomic`.
  .refine((value) => value.dueTime === undefined || value.dueDate !== undefined, {
    message: 'dueTime só é permitido quando dueDate está definido',
    path: ['dueTime'],
  });

export type CriarTarefaInput = z.infer<typeof CriarTarefaInputSchema>;

/**
 * Output do `criar_tarefa`.
 *
 * `dueDate`/`dueTime` podem ser `null` quando o utilizador não os forneceu.
 */
const CriarTarefaOutputSchema = z.object({
  taskId: z.string().uuid(),
  title: z.string(),
  dueDate: z.string().nullable(),
  dueTime: z.string().nullable(),
  priority: z.enum(['low', 'medium', 'high']),
});

export type CriarTarefaOutput = z.infer<typeof CriarTarefaOutputSchema>;

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Forma esperada da row devolvida pelo INSERT INTO tasks RETURNING ...
 *
 * Postgres devolve `due_date` como string ISO ou null. `priority` é o enum
 * literal (`'low'|'medium'|'high'`).
 */
interface TasksInsertReturn {
  readonly id: string;
  readonly title: string;
  readonly due_date: string | null;
  readonly due_time: string | null;
  readonly priority: 'low' | 'medium' | 'high';
}

/**
 * Formata `YYYY-MM-DD` para preview PT-PT compacto (`DD/MM/YYYY`).
 *
 * Para previews curtos no card de confirmação — não é localização completa
 * (que seria via `Intl.DateTimeFormat` em UI). Determinístico e sem dependências.
 */
function formatDateForPreview(dueDate: string): string {
  const [year, month, day] = dueDate.split('-');
  if (!year || !month || !day) return dueDate;
  return `${day}/${month}/${year}`;
}

// ─────────────────────────────────────────────────────────────────────────────
// Tool definition
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Tool definition para `criar_tarefa`.
 *
 * Pattern reverse_op: INSERT → `{ kind: 'delete_row', table: 'tasks', id }`.
 * O endpoint `POST /api/agent/prompt/[runId]/undo` (Story 2.8) consome este
 * payload para fazer DELETE within 30s window.
 */
export const criarTarefa: ToolDefinition<CriarTarefaInput, CriarTarefaOutput> = {
  name: 'criar_tarefa',
  domain: 'tasks',
  description:
    'Usa esta tool quando o utilizador quer criar uma nova tarefa ou to-do no agregado familiar. Aceita título obrigatório, data prevista opcional (formato YYYY-MM-DD), hora prevista opcional (formato HH:MM 24h — só permitida quando há data prevista) e prioridade opcional (low/medium/high, default medium).',
  inputSchema: CriarTarefaInputSchema,
  outputSchema: CriarTarefaOutputSchema,
  estimatedTokens: 50,

  preview(input) {
    const base = `Criar tarefa '${input.title}'`;
    if (input.dueDate) {
      const dateLabel = formatDateForPreview(input.dueDate);
      // `dueTime` só existe com `dueDate` (garantido pelo refine do schema).
      return input.dueTime
        ? `${base} para ${dateLabel} às ${input.dueTime}`
        : `${base} para ${dateLabel}`;
    }
    return base;
  },

  async execute(input, ctx: ToolExecutionContext): Promise<CriarTarefaOutput> {
    // SQL puro via `ctx.db.execute(sql\`...\`)` — evita import cross-package
    // de `tasks` table schema (mesma limitação documentada em atomic.ts +
    // contracts.ts sobre `paths` aliases do `@meu-jarvis/db`). Drizzle
    // parametriza os values através do template tag → safe contra injection.
    //
    // `priority` tem default `'medium'` no schema Zod (já populado por parse),
    // logo passamos sempre o valor explícito.
    const priorityValue = input.priority ?? 'medium';
    const result = (await ctx.db.execute(sql`
      insert into tasks
        (household_id, created_by_user_id, title, due_date, due_time, priority, status)
      values
        (
          ${ctx.householdId},
          ${ctx.userId},
          ${input.title},
          ${input.dueDate ?? null}::date,
          ${input.dueTime ?? null}::text,
          ${priorityValue}::task_priority,
          'todo'::task_status
        )
      returning id, title, due_date, due_time, priority
    `)) as ReadonlyArray<TasksInsertReturn>;

    const row = result[0];
    if (!row) {
      // Defensivo — Postgres deveria sempre devolver a row inserida.
      throw new Error('INSERT em tasks não devolveu row');
    }

    return {
      taskId: row.id,
      title: row.title,
      dueDate: row.due_date,
      dueTime: row.due_time,
      priority: row.priority,
    };
  },

  async reverse(output): Promise<ReverseOpPayload> {
    return {
      kind: 'delete_row',
      table: 'tasks',
      id: output.taskId,
    };
  },
};
