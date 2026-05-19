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

/** Shape inline de uma tag associada a uma tarefa (Story 3.6 T6.0). */
export interface TaskRowTag {
  id: string;
  name: string;
  color: string;
}

/**
 * Shape de uma linha de tarefa devolvida por `SELECT FROM public.tasks`.
 *
 * `tags` (Story 3.6 T6.0 / DP-3.6.6 A) — array de tags associadas via `task_tags`,
 * ordenadas por `tags.name asc`. Vazio (`[]`) quando a tarefa não tem tags ou
 * quando a query não inclui o JOIN. Usado nas vistas lista/Kanban/calendário.
 */
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
  tags: TaskRowTag[];
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
  // Story 3.6 T6.0: prefixar com `tasks.` para desambiguar do `tags.id`/`tags.name`
  // introduzidos pelo LEFT JOIN. Mesma semântica que Story 3.3, sem ambiguidade PG.
  switch (sort) {
    case 'created_at_desc':
      return sql`tasks.created_at desc, tasks.id desc`;
    case 'priority_desc':
      return sql`case tasks.priority when 'high' then 1 when 'medium' then 2 else 3 end, tasks.due_date asc nulls last, tasks.id asc`;
    case 'title_asc':
      return sql`tasks.title asc, tasks.id asc`;
    case 'due_date_asc':
    default:
      return sql`tasks.due_date asc nulls last, tasks.id asc`;
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
  // Story 3.6 T6.0: colunas prefixadas com `tasks.` para desambiguar do LEFT JOIN tags.
  const conditions = [sql`1=1`];
  if (filters.status) conditions.push(sql`tasks.status = ${filters.status}`);
  if (filters.priority) conditions.push(sql`tasks.priority = ${filters.priority}`);
  if (filters.kanban_column_id) {
    conditions.push(sql`tasks.kanban_column_id = ${filters.kanban_column_id}::uuid`);
  }
  if (filters.assigned_to_user_id) {
    conditions.push(sql`tasks.assigned_to_user_id = ${filters.assigned_to_user_id}::uuid`);
  }
  if (filters.project) {
    conditions.push(sql`tasks.project ilike ${'%' + filters.project + '%'}`);
  }
  if (filters.due_date_from) {
    conditions.push(sql`tasks.due_date >= ${filters.due_date_from}::date`);
  }
  if (filters.due_date_to) {
    conditions.push(sql`tasks.due_date <= ${filters.due_date_to}::date`);
  }
  if (filters.tag_id) {
    conditions.push(
      sql`tasks.id in (select task_id from public.task_tags where tag_id = ${filters.tag_id}::uuid)`,
    );
  }
  if (cursorPayload) {
    // Cursor pagination optimal para due_date_asc (default).
    if (cursorPayload.last_due_date) {
      conditions.push(
        sql`(tasks.due_date, tasks.id) > (${cursorPayload.last_due_date}::date, ${cursorPayload.last_id}::uuid)`,
      );
    } else {
      conditions.push(sql`(tasks.due_date is null and tasks.id > ${cursorPayload.last_id}::uuid)`);
    }
  }

  const whereSql = conditions.reduce((acc, c, idx) => (idx === 0 ? c : sql`${acc} and ${c}`));
  const orderBySql = buildOrderBy(filters.sort);

  // Story 3.6 T6.0 / DP-3.6.6 A (Aria ratify HIGH):
  // - LEFT JOIN task_tags + tags (preserva tarefas sem tags)
  // - json_agg(... ORDER BY tags.name) FILTER (WHERE tags.id IS NOT NULL) — produz
  //   `[]` em vez de `[null]` quando não há tags (G1.2 neutraliza LEFT JOIN edge)
  // - GROUP BY tasks.id — PG 16 detecta functional dependency via PK e aceita `tasks.*`
  // - RLS via JWT continua a filtrar transparentemente (G2.2 também — task_tags.household_id
  //   é redundante com RLS mas mantido implicitamente via JOIN ON task_tags.task_id)
  // - Indexes: task_tags_pkey (task_id, tag_id) + tags PK — execution path optimal
  // - Cardinality O(n + m) onde n=tasks pós-filter, m=task_tags rows juntos
  const rows = await db.execute<TaskRow>(sql`
    select tasks.id, tasks.household_id, tasks.created_by_user_id, tasks.assigned_to_user_id,
           tasks.title, tasks.description, tasks.due_date, tasks.due_time, tasks.priority,
           tasks.status, tasks.kanban_column_id, tasks.kanban_position, tasks.project,
           tasks.recurrence_id, tasks.is_recurrence_template, tasks.completed_at,
           tasks.created_at, tasks.updated_at,
           coalesce(
             json_agg(
               json_build_object('id', tags.id, 'name', tags.name, 'color', tags.color)
               order by tags.name asc
             ) filter (where tags.id is not null),
             '[]'::json
           ) as tags
    from public.tasks
    left join public.task_tags on task_tags.task_id = tasks.id
    left join public.tags on tags.id = task_tags.tag_id
    where ${whereSql}
    group by tasks.id
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
