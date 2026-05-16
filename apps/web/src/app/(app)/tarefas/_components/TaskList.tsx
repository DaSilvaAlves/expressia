import type { TaskRow } from '@/lib/api-helpers/list-tasks';

import { TaskListClient } from '@/app/(app)/tarefas/_components/TaskListClient';
import { groupTasksBySections } from '@/app/(app)/tarefas/_lib/task-sections';

/**
 * `<TaskList>` — RSC que agrupa tarefas em secções e delega rendering ao client
 * wrapper `<TaskListClient>` (Story 3.3 T4.3).
 *
 * O agrupamento (Lisbon-aware) acontece server-side para evitar hydration
 * mismatch e flicker. O wrapper client adiciona state de multi-select +
 * bulk actions bar sticky-bottom.
 */
export interface TaskListProps {
  readonly tasks: readonly TaskRow[];
  readonly nextCursor?: string | null;
}

export function TaskList({ tasks, nextCursor }: TaskListProps): React.ReactElement {
  const sections = groupTasksBySections(tasks);
  const allTaskIds = tasks
    .filter((t) => t.status !== 'archived' && t.status !== 'done')
    .map((t) => t.id);

  return <TaskListClient sections={sections} allTaskIds={allTaskIds} nextCursor={nextCursor} />;
}
