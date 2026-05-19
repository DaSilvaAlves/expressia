import type { Metadata } from 'next';
import { redirect } from 'next/navigation';

import { createServerSupabaseClient } from '@meu-jarvis/auth/server';
import { captureException } from '@meu-jarvis/observability';

import { getDb } from '@/lib/agent/db-shim';
import { resolveHouseholdId } from '@/lib/api-helpers/auth';
import { listTasksHelper } from '@/lib/api-helpers/list-tasks';
import { decodeCursor } from '@/lib/api-schemas/pagination';
import { TaskFiltersSchema } from '@/lib/api-schemas/tasks';

import { EmptyState } from '@/app/(app)/tarefas/_components/EmptyState';
import { TagFilterSelect } from '@/app/(app)/tarefas/_components/TagFilterSelect';
import { TagsManagerButton } from '@/app/(app)/tarefas/_components/TagsManagerButton';
import { TaskFilters } from '@/app/(app)/tarefas/_components/TaskFilters';
import { TaskList } from '@/app/(app)/tarefas/_components/TaskList';
import { TaskSort } from '@/app/(app)/tarefas/_components/TaskSort';
import { ViewTabs } from '@/app/(app)/tarefas/_components/ViewTabs';

export const metadata: Metadata = {
  title: 'Tarefas — Expressia',
};

interface PageProps {
  searchParams: Promise<Record<string, string | undefined>>;
}

/**
 * `/tarefas` — Vista lista densa de tarefas (Story 3.3 AC1+AC2).
 *
 * Server Component (RSC) que faz fetch server-side via `listTasksHelper`
 * (DP3-3.3 A import direct + DP4-3.3 A extract — RATIFIED HIGH por Aria).
 * Sem rota HTTP loopback. Zero latência adicional. Auth + RLS via `getDb()`
 * authenticated role com JWT injection.
 *
 * URL search params são parsed por `TaskFiltersSchema` (Story 3.2 source-of-truth
 * estendido Story 3.3 com `sort`). Componentes client (`TaskFilters`, `TaskSort`)
 * gerem URL-state via `useSearchParams` + `useRouter` (DP2-3.3 A native Next.js).
 *
 * Trace: Story 3.3 AC1, AC2, AC9, AC11.
 */
export default async function TarefasPage({ searchParams }: PageProps): Promise<React.ReactElement> {
  // Auth — middleware já garante user, mas resolveHouseholdId pode falhar (raro)
  const supabase = await createServerSupabaseClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect('/entrar');

  const householdId = await resolveHouseholdId(user.id);
  if (!householdId) {
    return <EmptyState variant="error" />;
  }

  // Parse query params via Zod — defensive (TaskFilters client valida antes do push)
  const rawParams = await searchParams;
  const parsed = TaskFiltersSchema.safeParse(rawParams);
  if (!parsed.success) {
    return (
      <div className="space-y-6">
        <header className="flex items-center justify-between">
          <h1 className="text-2xl font-bold">Tarefas</h1>
        </header>
        <EmptyState variant="error" />
      </div>
    );
  }
  const filters = parsed.data;

  // Decode cursor (defensive — TaskFilters não usa cursor mas URL pode trazer)
  let cursorPayload = null;
  if (filters.cursor) {
    cursorPayload = decodeCursor(filters.cursor);
    if (!cursorPayload) {
      return <EmptyState variant="error" />;
    }
  }

  // Fetch tasks via helper extraído (DP4-3.3 A)
  let tasks;
  let nextCursor;
  try {
    const result = await listTasksHelper({
      filters,
      cursorPayload,
      householdId,
      userId: user.id,
      db: getDb(),
    });
    tasks = result.tasks;
    nextCursor = result.next_cursor;
  } catch (err) {
    captureException(err instanceof Error ? err : new Error(String(err)), {
      userId: user.id,
      route: '/tarefas',
    });
    return (
      <div className="space-y-6">
        <header className="flex items-center justify-between">
          <h1 className="text-2xl font-bold">Tarefas</h1>
        </header>
        <EmptyState variant="error" />
      </div>
    );
  }

  const isEmpty = tasks.length === 0;
  const hasFilters = Object.keys(rawParams).some(
    (k) => rawParams[k] != null && k !== 'limit' && k !== 'sort' && k !== 'cursor',
  );

  return (
    <div className="space-y-6">
      <header className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">Tarefas</h1>
        <div className="flex items-center gap-2">
          <TagsManagerButton />
          <button
            type="button"
            className="rounded-md bg-blue-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
            disabled
            title="Disponível na próxima versão — usa o Jarvis para criar tarefas"
          >
            + Nova
          </button>
        </div>
      </header>

      <ViewTabs current="lista" />

      <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <TaskFilters />
        <div className="flex items-end gap-3">
          <TagFilterSelect />
          <TaskSort />
        </div>
      </div>

      {isEmpty ? (
        <EmptyState variant={hasFilters ? 'filtered-empty' : 'no-tasks'} />
      ) : (
        <TaskList tasks={tasks} nextCursor={nextCursor} />
      )}
    </div>
  );
}
