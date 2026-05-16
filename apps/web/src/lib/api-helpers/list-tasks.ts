/**
 * `listTasksHelper` — pure SELECT helper shared entre route handler `/api/tasks` GET
 * e Server Components (RSC) que listam tarefas.
 *
 * Decisão arquitectural: Story 3.3 DP4-3.3 (Path A extract) — RATIFIED APPROVE HIGH
 * por @architect Aria em 2026-05-16 (gate `docs/qa/gates/3.3-architect-dp4-ratify.md`).
 * Precedente: Story 3.2 D-3.2.1 (`auth.ts` + `audit.ts` extraction) ratified PASS HIGH.
 *
 * Guidance notes Aria aplicadas:
 * - G1: `db` é param injectado (NÃO chama `getDb()` internamente) — testability + futuro
 *   reuse com `getServiceDb()` em Inngest jobs (Story 3.7).
 * - G2: `TaskRow` interface vive aqui (single source-of-truth) — re-exportada por route.ts.
 * - G3: `1=1` placeholder pattern preservado em WHERE building (idiomatic Drizzle).
 * - G4: `householdId` redundant no SQL (RLS filtra) mas mantido em signature — audit trail
 *   consistency + futuro non-RLS path se Inngest usar `getServiceDb()`.
 * - G5: `decodeCursor` permanece no wrapper HTTP (400 concern); helper recebe
 *   `cursorPayload` já decoded (ou null).
 * - G6: Sort param branched ORDER BY via `switch`. Cursor optimal só para `due_date_asc`
 *   (default). Documentado como limitation aceite KISS — refactor cursor multi-field é
 *   Epic 4+ housekeeping.
 *
 * Trace: Story 3.3 T2.1-T2.4, AC2, AC4.
 */
import { sql, type SQL } from 'drizzle-orm';

import type { DbShim } from '@/lib/agent/db-shim';
import type { CursorPayload } from '@/lib/api-schemas/pagination';
import { encodeCursor } from '@/lib/api-schemas/pagination';
import type { TaskFiltersInput } from '@/lib/api-schemas/tasks';

/** Shape de uma linha de tarefa devolvida por `SELECT FROM public.tasks`. */
export interface TaskRow {
  id: string;
  household_id: string;
  created_by_user_id: string;
  assigned_to_user_id: string | null;
  title: string;
  description: string | null;
  due_date: string | null;
  due_time: string | null;
  priority: string;
  status: string;
  kanban_column_id: string | null;
  kanban_position: number;
  project: string | null;
  recurrence_id: string | null;
  is_recurrence_template: boolean;
  completed_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface ListTasksParams {
  readonly filters: TaskFiltersInput;
  readonly cursorPayload: CursorPayload | null;
  /**
   * `householdId` redundant no SQL (RLS filtra) mas preservado para audit trail
   * consistency + futuro non-RLS path (Inngest jobs com `getServiceDb()`).
   */
  readonly householdId: string;
  readonly userId: string;
  /** DB shim injectado — RSC e route handler passam `getDb()`; Inngest pode passar `getServiceDb()`. */
  readonly db: DbShim;
}

export interface ListTasksResult {
  readonly tasks: TaskRow[];
  readonly next_cursor: string | null;
}

/**
 * Constrói cláusula ORDER BY baseada em `filters.sort` (DP5-3.3 G6).
 *
 * Cursor optimal só para `due_date_asc` (default). Outros sorts podem ter cursor
 * boundary sub-óptimo se 2+ rows partilham o mesmo sort key — aceite KISS para MVP.
 */
function buildOrderBy(sort: TaskFiltersInput['sort']): SQL {
  switch (sort) {
    case 'created_at_desc':
      return sql`created_at desc, id desc`;
    case 'priority_desc':
      return sql`case priority when 'high' then 1 when 'medium' then 2 else 3 end, due_date asc nulls last, id asc`;
    case 'title_asc':
      return sql`title asc, id asc`;
    case 'due_date_asc':
    default:
      return sql`due_date asc nulls last, id asc`;
  }
}

/**
 * Lista tarefas paginadas por cursor com filtros + ordenação configurável.
 *
 * Retorna `{ tasks, next_cursor }` onde `next_cursor` é base64 opaco se há mais
 * resultados (sliced ao `filters.limit`). RLS aplicada via JWT — caller deve
 * passar `db = getDb()` (authenticated role) em rotas/RSC de utilizador.
 */
export async function listTasksHelper(
  params: ListTasksParams,
): Promise<ListTasksResult> {
  const { filters, cursorPayload, db } = params;
  const limitPlusOne = filters.limit + 1;

  // Build dynamic WHERE conditions (RLS via JWT já filtra household_id — G4).
  const conditions = [sql`1=1`];
  if (filters.status) conditions.push(sql`status = ${filters.status}`);
  if (filters.priority) conditions.push(sql`priority = ${filters.priority}`);
  if (filters.kanban_column_id) {
    conditions.push(sql`kanban_column_id = ${filters.kanban_column_id}::uuid`);
  }
  if (filters.assigned_to_user_id) {
    conditions.push(sql`assigned_to_user_id = ${filters.assigned_to_user_id}::uuid`);
  }
  if (filters.project) {
    conditions.push(sql`project ilike ${'%' + filters.project + '%'}`);
  }
  if (filters.due_date_from) {
    conditions.push(sql`due_date >= ${filters.due_date_from}::date`);
  }
  if (filters.due_date_to) {
    conditions.push(sql`due_date <= ${filters.due_date_to}::date`);
  }
  if (filters.tag_id) {
    conditions.push(
      sql`id in (select task_id from public.task_tags where tag_id = ${filters.tag_id}::uuid)`,
    );
  }
  if (cursorPayload) {
    // Cursor pagination optimal para due_date_asc (default).
    if (cursorPayload.last_due_date) {
      conditions.push(
        sql`(due_date, id) > (${cursorPayload.last_due_date}::date, ${cursorPayload.last_id}::uuid)`,
      );
    } else {
      conditions.push(sql`(due_date is null and id > ${cursorPayload.last_id}::uuid)`);
    }
  }

  const whereSql = conditions.reduce((acc, c, idx) => (idx === 0 ? c : sql`${acc} and ${c}`));
  const orderBySql = buildOrderBy(filters.sort);

  const rows = await db.execute<TaskRow>(sql`
    select id, household_id, created_by_user_id, assigned_to_user_id, title, description,
           due_date, due_time, priority, status, kanban_column_id, kanban_position,
           project, recurrence_id, is_recurrence_template, completed_at, created_at, updated_at
    from public.tasks
    where ${whereSql}
    order by ${orderBySql}
    limit ${limitPlusOne}
  `);

  let nextCursor: string | null = null;
  let tasks = rows;
  if (rows.length === limitPlusOne) {
    tasks = rows.slice(0, filters.limit);
    const last = tasks[tasks.length - 1];
    if (last) {
      nextCursor = encodeCursor({ last_due_date: last.due_date, last_id: last.id });
    }
  }

  return { tasks, next_cursor: nextCursor };
}
