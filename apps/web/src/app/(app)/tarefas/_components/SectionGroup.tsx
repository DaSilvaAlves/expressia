import { TaskRow } from '@/app/(app)/tarefas/_components/TaskRow';
import type { SectionGroup as SectionGroupShape } from '@/app/(app)/tarefas/_lib/task-sections';

/**
 * `<SectionGroup>` — header + lista de `<TaskRow>` (Story 3.3 T4.4).
 *
 * Variants:
 *   - `danger` (Atrasadas FR11): border-left red + count badge red.
 *   - `success` (Concluídas hoje): collapsed por defeito via `<details>`.
 *   - `default`: standard.
 */
export interface SectionGroupProps {
  readonly section: SectionGroupShape;
}

export function SectionGroup({ section }: SectionGroupProps): React.ReactElement {
  const isOverdue = section.variant === 'danger';
  const isCompleted = section.variant === 'success';

  if (isCompleted) {
    return (
      <details className="space-y-2 rounded-md border border-green-200 bg-green-50/30 p-3 dark:border-green-900 dark:bg-green-950/20">
        <summary className="cursor-pointer text-sm font-medium text-green-800 dark:text-green-200">
          {section.label}
        </summary>
        <ul className="mt-2 space-y-1">
          {section.tasks.map((task) => (
            <li key={task.id}>
              <TaskRow task={task} />
            </li>
          ))}
        </ul>
      </details>
    );
  }

  return (
    <section
      className={
        isOverdue
          ? 'space-y-2 rounded-md border-l-[3px] border-l-red-500 bg-red-50/30 p-3 dark:bg-red-950/20'
          : 'space-y-2'
      }
      aria-label={section.label}
    >
      <header className="flex items-center gap-2">
        <h2
          className={
            isOverdue
              ? 'text-sm font-semibold text-red-700 dark:text-red-300'
              : 'text-sm font-semibold text-neutral-700 dark:text-neutral-300'
          }
        >
          {section.label}
        </h2>
        {isOverdue && (
          <span
            aria-label="aviso"
            className="rounded-full bg-red-100 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-red-700 dark:bg-red-900/50 dark:text-red-300"
          >
            atenção
          </span>
        )}
      </header>
      <ul className="space-y-1">
        {section.tasks.map((task) => (
          <li key={task.id}>
            <TaskRow task={task} highlightOverdue={isOverdue} />
          </li>
        ))}
      </ul>
    </section>
  );
}
