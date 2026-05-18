'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { captureException } from '@sentry/nextjs';

/**
 * `<CalendarTaskCheckbox>` — checkbox compacto para toggle done/todo em CalendarTaskCard.
 *
 * G2.1 Aria: NÃO re-usa `TaskCheckbox` Story 3.3 (sem `size` prop, sem variant, acoplado
 * a `useBulkSelection` context que não existe no calendário). PATCH directo body
 * `{ status: 'done' | 'todo' }`.
 *
 * Trace: Story 3.5 AC4 + PO_FIX 1 v1.1 + G2.1 Aria.
 */
export interface CalendarTaskCheckboxProps {
  readonly taskId: string;
  readonly checked: boolean;
  readonly title: string;
  readonly disabled?: boolean;
  /** Hook para atualizar optimistic state no parent. */
  readonly onToggle?: (nextChecked: boolean) => void;
}

export function CalendarTaskCheckbox({
  taskId,
  checked,
  title,
  disabled,
  onToggle,
}: CalendarTaskCheckboxProps): React.ReactElement {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const [pending, setPending] = useState(false);

  async function handleChange(event: React.ChangeEvent<HTMLInputElement>): Promise<void> {
    const next = event.target.checked;
    onToggle?.(next);
    setPending(true);
    try {
      const res = await fetch(`/api/tasks/${taskId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: next ? 'done' : 'todo' }),
      });
      if (!res.ok) {
        onToggle?.(!next);
        captureException(new Error(`CalendarTaskCheckbox PATCH failed: ${res.status}`), {
          tags: { route: '/api/tasks/[id]' },
          extra: { taskId },
        });
        return;
      }
      startTransition(() => router.refresh());
    } catch (err) {
      onToggle?.(!next);
      captureException(err instanceof Error ? err : new Error(String(err)), {
        tags: { route: '/api/tasks/[id]' },
        extra: { taskId },
      });
    } finally {
      setPending(false);
    }
  }

  return (
    <input
      type="checkbox"
      checked={checked}
      disabled={disabled || pending}
      onChange={handleChange}
      onClick={(event) => event.stopPropagation()}
      aria-label={`Marcar ${title} como ${checked ? 'por fazer' : 'concluída'}`}
      className="h-3.5 w-3.5 cursor-pointer rounded border-neutral-300 text-blue-600 focus:ring-2 focus:ring-blue-500 dark:border-neutral-600 dark:bg-neutral-800"
    />
  );
}
