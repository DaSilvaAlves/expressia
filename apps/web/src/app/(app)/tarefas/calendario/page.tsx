import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { sql } from 'drizzle-orm';

import { createServerSupabaseClient } from '@meu-jarvis/auth/server';
import { captureException } from '@meu-jarvis/observability';

import { withHousehold } from '@/lib/agent/db-shim';
import { resolveHouseholdId } from '@/lib/api-helpers/auth';
import type { TaskRow } from '@/lib/api-helpers/list-tasks';

import { EmptyState } from '@/app/(app)/tarefas/_components/EmptyState';
import { TagFilterSelect } from '@/app/(app)/tarefas/_components/TagFilterSelect';
import { ViewTabs } from '@/app/(app)/tarefas/_components/ViewTabs';

import { WeekViewClient } from '@/app/(app)/tarefas/calendario/_components/WeekViewClient';
import { WeekNavigation } from '@/app/(app)/tarefas/calendario/_components/WeekNavigation';
import {
  buildWeekDays,
  formatWeekIso,
  resolveWeekStart,
  toDayIso,
} from '@/app/(app)/tarefas/calendario/_components/week-helpers';

export const metadata: Metadata = {
  title: 'Tarefas Calendário — Expressia',
};

interface PageProps {
  searchParams: Promise<Record<string, string | undefined>>;
}

const UNSCHEDULED_LIMIT = 50;

/**
 * `/tarefas/calendario` — Vista calendário semanal (Story 3.5 AC1).
 *
 * Server Component (RSC) que faz fetch server-side:
 *   1. Tarefas com `due_date` na semana visualizada.
 *   2. Tarefas sem `due_date` (sidebar Por agendar — limit 50).
 *
 * Auth + RLS via `getDb()` authenticated role. ViewTabs Calendário activo.
 *
 * Trace: Story 3.5 AC1, AC2, AC7, AC10.
 */
export default async function TarefasCalendarioPage({
  searchParams,
}: PageProps): Promise<React.ReactElement> {
  const supabase = await createServerSupabaseClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect('/entrar');

  const householdId = await resolveHouseholdId(user.id);
  if (!householdId) {
    return (
      <div className="space-y-6">
        <header className="flex items-center justify-between">
          <h1 className="text-2xl font-bold">Tarefas</h1>
        </header>
        <ViewTabs current="calendario" />
        <EmptyState variant="error" />
      </div>
    );
  }

  const rawParams = await searchParams;
  const weekParam = rawParams.week ?? null;
  const weekStart = resolveWeekStart(weekParam);
  const weekDays = buildWeekDays(weekStart);
  const weekStartIso = toDayIso(weekStart);
  const weekEndIso = toDayIso(weekDays[6] ?? weekStart);
  const weekIso = formatWeekIso(weekStart);

  let scheduled: readonly TaskRow[] = [];
  let unscheduled: readonly TaskRow[] = [];
  let unscheduledTotal = 0;

  try {
    // SEC-6 — LEAK FIX + RLS-enforced em runtime. As 3 queries `tasks` não tinham
    // filtro `household_id` (1.ª rede em falta → leak cross-household com a RLS
    // inerte em runtime; o `householdId` estava resolvido mas nunca era usado). É
    // adicionado agora com parâmetro bound, combinado com `and` (coexiste com o
    // fragment opcional `tagIdSql`/`tagIdFilter`). As 3 correm dentro de um único
    // `withHousehold` (2.ª rede em transação).
    // Story 3.6 T6.0 (DP-3.6.6 A): tags via json_agg LEFT JOIN — mesmo pattern do
    // listTasksHelper para coerência cross-vista. Optional `tag_id` filter via search params.
    const tagIdFilter = rawParams.tag_id ?? null;
    const tagIdSql = tagIdFilter
      ? sql`and tasks.id in (select task_id from public.task_tags where tag_id = ${tagIdFilter}::uuid)`
      : sql``;
    const [scheduledRows, unscheduledRows, countRows] = await withHousehold(
      { userId: user.id, householdId },
      (tx) =>
        Promise.all([
          tx.execute<TaskRow>(sql`
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
            where tasks.due_date >= ${weekStartIso}::date
              and tasks.due_date <= ${weekEndIso}::date
              and tasks.household_id = ${householdId}::uuid
              ${tagIdSql}
            group by tasks.id
            order by tasks.due_date asc, tasks.priority asc, tasks.created_at asc
            limit 500
          `),
          tx.execute<TaskRow>(sql`
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
            where tasks.due_date is null
              and tasks.status not in ('done', 'archived')
              and tasks.household_id = ${householdId}::uuid
              ${tagIdFilter ? sql`and tasks.id in (select task_id from public.task_tags where tag_id = ${tagIdFilter}::uuid)` : sql``}
            group by tasks.id
            order by tasks.created_at desc
            limit ${UNSCHEDULED_LIMIT}
          `),
          tx.execute<{ total: string | number }>(sql`
            select count(*)::int as total
            from public.tasks
            where due_date is null
              and status not in ('done', 'archived')
              and household_id = ${householdId}::uuid
              ${tagIdFilter ? sql`and id in (select task_id from public.task_tags where tag_id = ${tagIdFilter}::uuid)` : sql``}
          `),
        ]),
    );

    scheduled = scheduledRows;
    unscheduled = unscheduledRows;
    const firstCount = countRows[0];
    if (firstCount) {
      const raw = firstCount.total;
      unscheduledTotal = typeof raw === 'number' ? raw : Number.parseInt(String(raw), 10) || 0;
    }
  } catch (err) {
    captureException(err instanceof Error ? err : new Error(String(err)), {
      userId: user.id,
      route: '/tarefas/calendario',
    });
    return (
      <div className="space-y-6">
        <header className="flex items-center justify-between">
          <h1 className="text-2xl font-bold">Tarefas</h1>
        </header>
        <ViewTabs current="calendario" />
        <EmptyState variant="error" />
      </div>
    );
  }

  const hasNothing = scheduled.length === 0 && unscheduled.length === 0;

  return (
    <div className="space-y-6">
      <header className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">Tarefas</h1>
      </header>

      <ViewTabs current="calendario" />

      <div className="flex items-end justify-between">
        <WeekNavigation weekStartIso={weekIso} />
        <TagFilterSelect />
      </div>

      {hasNothing ? (
        <EmptyState variant="no-tasks" />
      ) : (
        <WeekViewClient
          initialTasks={scheduled}
          unscheduledTasks={unscheduled}
          unscheduledTotalCount={unscheduledTotal}
          weekStartIso={weekIso}
        />
      )}
    </div>
  );
}
