import type { Metadata } from 'next';
import { redirect } from 'next/navigation';

import { createServerSupabaseClient } from '@meu-jarvis/auth/server';
import { captureException } from '@meu-jarvis/observability';
import { sql } from 'drizzle-orm';

import { withHousehold } from '@/lib/agent/db-shim';
import { resolveHouseholdId } from '@/lib/api-helpers/auth';
import { listTasksHelper } from '@/lib/api-helpers/list-tasks';
import { TaskFiltersSchema } from '@/lib/api-schemas/tasks';

import { EmptyState } from '@/app/(app)/tarefas/_components/EmptyState';
import { TagFilterSelect } from '@/app/(app)/tarefas/_components/TagFilterSelect';
import { ViewTabs } from '@/app/(app)/tarefas/_components/ViewTabs';
import { KanbanBoardClient } from '@/app/(app)/tarefas/kanban/_components/KanbanBoardClient';
import type { KanbanColumnRow } from '@/lib/api-schemas/kanban-columns';

export const metadata: Metadata = {
  title: 'Tarefas Kanban — Expressia',
};

interface PageProps {
  searchParams: Promise<Record<string, string | undefined>>;
}

interface KanbanColumnDbRow {
  id: string;
  name: string;
  sort_order: number;
  color: string;
  is_done_column: boolean | string;
}

/**
 * `/tarefas/kanban` — Vista quadro Kanban (Story 3.4 AC1).
 *
 * Server Component (RSC) que faz fetch server-side de:
 *   1. Colunas Kanban do household (ordenadas por sort_order)
 *   2. Tarefas do household (filtros aplicados via search params)
 *
 * Auth + RLS via `getDb()` authenticated role. Componentes Story 3.3 reutilizados:
 *   - `<ViewTabs current="kanban">` — tab activo
 *   - `<EmptyState>` — quando 0 colunas configuradas (bloqueante)
 *
 * Trace: Story 3.4 AC1, AC7, AC14.
 */
export default async function TarefasKanbanPage({
  searchParams,
}: PageProps): Promise<React.ReactElement> {
  const supabase = await createServerSupabaseClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect('/entrar');

  const householdId = await resolveHouseholdId(user.id);
  if (!householdId) {
    return <EmptyState variant="error" />;
  }

  // Parse filtros — subset (search + tag) — KISS DP-3.4.3
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

  // Fetch tasks + columns em paralelo
  let columns: KanbanColumnRow[] = [];
  let tasks;
  try {
    // SEC-6 — LEAK FIX + RLS-enforced em runtime. A query `kanban_columns` não
    // tinha filtro `household_id` (1.ª rede em falta → leak cross-household com a
    // RLS inerte em runtime); é adicionado agora com parâmetro bound. Ambas as
    // leituras correm dentro de um único `withHousehold` (2.ª rede em transação).
    const [columnRows, tasksResult] = await withHousehold(
      { userId: user.id, householdId },
      (tx) =>
        Promise.all([
          tx.execute<KanbanColumnDbRow>(sql`
            select id, name, sort_order, color, is_done_column
            from public.kanban_columns
            where household_id = ${householdId}::uuid
            order by sort_order asc
          `),
          listTasksHelper({
            filters: { ...filters, limit: 100 }, // 100 tasks cap inicial — naive-first (DP-3.4.4)
            cursorPayload: null,
            householdId,
            userId: user.id,
            db: tx,
          }),
        ]),
    );
    columns = columnRows.map((row) => ({
      id: row.id,
      name: row.name,
      sort_order: row.sort_order,
      color: row.color,
      is_done_column:
        typeof row.is_done_column === 'boolean' ? row.is_done_column : row.is_done_column === 'true',
    }));
    tasks = tasksResult.tasks;
  } catch (err) {
    captureException(err instanceof Error ? err : new Error(String(err)), {
      userId: user.id,
      route: '/tarefas/kanban',
    });
    return (
      <div className="space-y-6">
        <header className="flex items-center justify-between">
          <h1 className="text-2xl font-bold">Tarefas</h1>
        </header>
        <ViewTabs current="kanban" />
        <EmptyState variant="error" />
      </div>
    );
  }

  if (columns.length === 0) {
    return (
      <div className="space-y-6">
        <header className="flex items-center justify-between">
          <h1 className="text-2xl font-bold">Tarefas</h1>
        </header>
        <ViewTabs current="kanban" />
        <div className="rounded-lg border border-black/10 bg-neutral-50 p-8 text-center dark:border-white/10 dark:bg-neutral-900/40">
          <p className="text-sm text-neutral-700 dark:text-neutral-300">
            Configura pelo menos uma coluna para começar.
          </p>
          <p className="mt-2 text-xs text-neutral-500 dark:text-neutral-500">
            As colunas predefinidas (A fazer / Em curso / Concluído) deveriam ter sido
            criadas automaticamente. Contacta suporte se o problema persistir.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <header className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">Tarefas</h1>
        <button
          type="button"
          className="rounded-md bg-blue-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
          disabled
          title="Disponível na próxima versão — usa o Jarvis para criar tarefas"
        >
          + Nova
        </button>
      </header>

      <ViewTabs current="kanban" />

      <div className="flex justify-end">
        <TagFilterSelect />
      </div>

      <KanbanBoardClient initialTasks={tasks} initialColumns={columns} />
    </div>
  );
}
