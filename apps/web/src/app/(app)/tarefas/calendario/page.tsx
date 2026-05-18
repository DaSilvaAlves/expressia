import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { sql } from 'drizzle-orm';

import { createServerSupabaseClient } from '@meu-jarvis/auth/server';
import { captureException } from '@meu-jarvis/observability';

import { getDb } from '@/lib/agent/db-shim';
import { resolveHouseholdId } from '@/lib/api-helpers/auth';
import type { TaskRow } from '@/lib/api-helpers/list-tasks';

import { EmptyState } from '@/app/(app)/tarefas/_components/EmptyState';
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
    const db = getDb();
    const [scheduledRows, unscheduledRows, countRows] = await Promise.all([
      db.execute<TaskRow>(sql`
        select id, household_id, created_by_user_id, assigned_to_user_id, title, description,
               due_date, due_time, priority, status, kanban_column_id, kanban_position,
               project, recurrence_id, is_recurrence_template, completed_at, created_at, updated_at
        from public.tasks
        where due_date >= ${weekStartIso}::date
          and due_date <= ${weekEndIso}::date
        order by due_date asc, priority asc, created_at asc
        limit 500
      `),
      db.execute<TaskRow>(sql`
        select id, household_id, created_by_user_id, assigned_to_user_id, title, description,
               due_date, due_time, priority, status, kanban_column_id, kanban_position,
               project, recurrence_id, is_recurrence_template, completed_at, created_at, updated_at
        from public.tasks
        where due_date is null
          and status not in ('done', 'archived')
        order by created_at desc
        limit ${UNSCHEDULED_LIMIT}
      `),
      db.execute<{ total: string | number }>(sql`
        select count(*)::int as total
        from public.tasks
        where due_date is null
          and status not in ('done', 'archived')
      `),
    ]);

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

      <WeekNavigation weekStartIso={weekIso} />

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
