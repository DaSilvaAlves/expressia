'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { captureException } from '@sentry/nextjs';

import type { DayIso } from '@/app/(app)/tarefas/calendario/_components/week-helpers';

/**
 * `<CalendarAddInline>` — Pattern KISS para criar tarefa rápida directamente numa
 * DayColumn ou no UnscheduledSidebar (Story 3.5 AC3c, AC6d, T5.2).
 *
 * - `initialDueDate` define o `due_date` da nova tarefa (null = unscheduled).
 * - Compactness: 1 input + Enter para submit. Sem botão visual + por defeito.
 * - Reusa endpoint Story 3.2 POST /api/tasks (zero novo endpoint — Story 3.5 §AC1).
 */
export interface CalendarAddInlineProps {
  readonly initialDueDate: DayIso | null;
  readonly placeholder?: string;
}

export function CalendarAddInline({
  initialDueDate,
  placeholder,
}: CalendarAddInlineProps): React.ReactElement {
  const router = useRouter();
  const [title, setTitle] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [, startTransition] = useTransition();

  async function handleSubmit(event: React.FormEvent): Promise<void> {
    event.preventDefault();
    const trimmed = title.trim();
    if (!trimmed) return;

    setSubmitting(true);
    setError(null);

    try {
      const res = await fetch('/api/tasks', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: trimmed,
          due_date: initialDueDate,
        }),
      });
      if (!res.ok) {
        setError('Não foi possível criar a tarefa. Tenta de novo.');
        if (res.status === 500) {
          captureException(new Error(`POST /api/tasks failed: ${res.status}`));
        }
        return;
      }
      setTitle('');
      startTransition(() => router.refresh());
    } catch (err) {
      setError('Não foi possível criar a tarefa. Tenta de novo.');
      captureException(err instanceof Error ? err : new Error(String(err)));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="px-1 py-1">
      <input
        type="text"
        value={title}
        onChange={(event) => setTitle(event.target.value)}
        placeholder={placeholder ?? '+ Adicionar'}
        disabled={submitting}
        aria-label="Título da nova tarefa"
        className="w-full rounded-sm border-0 bg-transparent px-2 py-1 text-xs text-neutral-700 placeholder:text-neutral-400 focus:bg-white focus:outline-none focus:ring-1 focus:ring-blue-500 dark:text-neutral-200 dark:placeholder:text-neutral-600 dark:focus:bg-neutral-800"
      />
      {error && (
        <p role="alert" className="mt-1 px-2 text-[11px] text-red-600 dark:text-red-400">
          {error}
        </p>
      )}
    </form>
  );
}
