'use client';

import { useCallback, useMemo, useOptimistic, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import {
  DndContext,
  DragOverlay,
  KeyboardSensor,
  PointerSensor,
  TouchSensor,
  closestCorners,
  useSensor,
  useSensors,
  type Announcements,
  type DragEndEvent,
  type DragStartEvent,
} from '@dnd-kit/core';
import { sortableKeyboardCoordinates } from '@dnd-kit/sortable';
import { captureException } from '@sentry/nextjs';

import type { TaskRow } from '@/lib/api-helpers/list-tasks';

import { CalendarTaskCard } from '@/app/(app)/tarefas/calendario/_components/CalendarTaskCard';
import { UnscheduledSidebar } from '@/app/(app)/tarefas/calendario/_components/UnscheduledSidebar';
import { WeekView } from '@/app/(app)/tarefas/calendario/_components/WeekView';
import { EditTaskModal } from '@/app/(app)/tarefas/_components/EditTaskModal';
import {
  formatDayShort,
  formatDayMonth,
  fromDayIso,
  resolveWeekStart,
  type DayIso,
} from '@/app/(app)/tarefas/calendario/_components/week-helpers';

/**
 * `<WeekViewClient>` — wrapper client island com DndContext + estado optimista
 * (Story 3.5 AC5, AC11 + G1.1/G1.2/G1.4).
 *
 * - Sensors @dnd-kit (Pointer 8px + Touch 250ms delay + Keyboard) (AC5a — G1.1 reuso).
 * - Drag lifecycle: onDragStart → onDragEnd (optimistic + revert) (AC5c).
 * - PATCH `/api/tasks/[id]` body `{ due_date: 'YYYY-MM-DD' | null }` (PG `date` type).
 * - Drag bidirecional sidebar ↔ DayColumn (AC5d, AC5e).
 * - 6 announcements PT-PT screen reader (AC11c).
 * - `useOptimistic` React 19 nativo — G1.2 Aria.
 * - `<DragOverlay>` Portal único — G1.4 Aria.
 * - Toast inline custom pattern Story 3.4 (PO_FIX 4 — Sonner NÃO instalado).
 */
export interface WeekViewClientProps {
  readonly initialTasks: readonly TaskRow[];
  readonly unscheduledTasks: readonly TaskRow[];
  readonly unscheduledTotalCount?: number;
  readonly weekStartIso: string;
}

interface ToastState {
  message: string;
  variant: 'error' | 'success';
}

/**
 * Reducer optimistic — aplica drag move localmente.
 * Action: { taskId, newDueDate (null = unscheduled) }
 */
interface OptimisticAction {
  readonly taskId: string;
  readonly newDueDate: DayIso | null;
}

function optimisticReducer(
  state: readonly TaskRow[],
  action: OptimisticAction,
): readonly TaskRow[] {
  return state.map((task) =>
    task.id === action.taskId ? { ...task, due_date: action.newDueDate } : task,
  );
}

function hapticFeedback(): void {
  if (typeof navigator !== 'undefined' && 'vibrate' in navigator) {
    try {
      navigator.vibrate(10);
    } catch {
      // ignore — alguns browsers throw quando user-gesture missing
    }
  }
}

export function WeekViewClient({
  initialTasks,
  unscheduledTasks,
  unscheduledTotalCount,
  weekStartIso,
}: WeekViewClientProps): React.ReactElement {
  const router = useRouter();
  const weekStart = useMemo(() => resolveWeekStart(weekStartIso), [weekStartIso]);

  // Combinamos scheduled + unscheduled num único array para estado optimista —
  // WeekView e UnscheduledSidebar filtram via `due_date != null` vs `== null`.
  const allInitial = useMemo<readonly TaskRow[]>(
    () => [...initialTasks, ...unscheduledTasks],
    [initialTasks, unscheduledTasks],
  );

  const [optimisticTasks, applyOptimistic] = useOptimistic(allInitial, optimisticReducer);
  const [activeTaskId, setActiveTaskId] = useState<string | null>(null);
  const [toast, setToast] = useState<ToastState | null>(null);
  const [editingTaskId, setEditingTaskId] = useState<string | null>(null);
  const [, startTransition] = useTransition();

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 250, tolerance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const scheduledTasks = useMemo(
    () => optimisticTasks.filter((t) => t.due_date !== null),
    [optimisticTasks],
  );

  const unscheduledFiltered = useMemo(
    () => optimisticTasks.filter((t) => t.due_date === null),
    [optimisticTasks],
  );

  const activeTask = useMemo(
    () => (activeTaskId ? optimisticTasks.find((t) => t.id === activeTaskId) ?? null : null),
    [activeTaskId, optimisticTasks],
  );

  function showToast(message: string, variant: ToastState['variant']): void {
    setToast({ message, variant });
    setTimeout(() => setToast(null), 5000);
  }

  /** Resolve destino (day:YYYY-MM-DD ou unscheduled) a partir do drop target id. */
  const resolveDropTarget = useCallback(
    (overId: string): { type: 'day'; dayIso: DayIso } | { type: 'unscheduled' } | null => {
      if (overId === 'unscheduled') return { type: 'unscheduled' };
      if (overId.startsWith('day:')) {
        return { type: 'day', dayIso: overId.slice(4) };
      }
      // Drop sobre outra task — resolver via `optimisticTasks`.
      const overTask = optimisticTasks.find((t) => t.id === overId);
      if (!overTask) return null;
      if (overTask.due_date === null) return { type: 'unscheduled' };
      return { type: 'day', dayIso: overTask.due_date };
    },
    [optimisticTasks],
  );

  const handleDragStart = useCallback((event: DragStartEvent) => {
    setActiveTaskId(event.active.id as string);
    hapticFeedback();
  }, []);

  const handleDragEnd = useCallback(
    async (event: DragEndEvent) => {
      setActiveTaskId(null);
      const { active, over } = event;
      if (!over) return;

      const taskId = active.id as string;
      const overId = String(over.id);

      const target = resolveDropTarget(overId);
      if (!target) return;

      const task = optimisticTasks.find((t) => t.id === taskId);
      if (!task) return;

      const newDueDate = target.type === 'unscheduled' ? null : target.dayIso;

      // No-op se já está no mesmo dia.
      if (task.due_date === newDueDate) return;

      const previousDueDate = task.due_date;

      // Optimistic update.
      applyOptimistic({ taskId, newDueDate });

      try {
        const res = await fetch(`/api/tasks/${taskId}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ due_date: newDueDate }),
        });
        if (!res.ok) {
          // Revert via re-aplicar previous due_date.
          applyOptimistic({ taskId, newDueDate: previousDueDate });
          showToast('Não foi possível mover a tarefa. Tenta de novo.', 'error');
          if (res.status === 500) {
            captureException(new Error(`Move task failed: ${res.status}`), {
              tags: { route: '/api/tasks/[id]' },
              extra: { taskId },
            });
          }
          if (res.status === 404) {
            startTransition(() => router.refresh());
          }
          return;
        }
        // Success — refresh server data para reconciliar (audit_log já gravado pelo PATCH).
        startTransition(() => router.refresh());
      } catch (err) {
        applyOptimistic({ taskId, newDueDate: previousDueDate });
        showToast('Não foi possível mover a tarefa. Tenta de novo.', 'error');
        captureException(err instanceof Error ? err : new Error(String(err)), {
          tags: { route: '/api/tasks/[id]' },
          extra: { taskId },
        });
      }
    },
    [optimisticTasks, applyOptimistic, router, resolveDropTarget],
  );

  const handleDragCancel = useCallback(() => {
    setActiveTaskId(null);
  }, []);

  const handleToggleChecked = useCallback(
    (_taskId: string, _nextChecked: boolean) => {
      // CalendarTaskCheckbox já faz PATCH + router.refresh — apenas precisamos
      // forçar refresh do estado optimista quando server reconcile chegar.
      // No-op aqui (CalendarTaskCheckbox tem optimistic interno via onToggle?.).
    },
    [],
  );

  // 6 anúncios PT-PT (AC11c) — pattern Story 3.4.
  const announcements: Announcements = useMemo(
    () => ({
      onDragStart({ active }) {
        const task = optimisticTasks.find((t) => t.id === active.id);
        const dayLabel = task?.due_date
          ? `${formatDayShort(fromDayIso(task.due_date))} ${formatDayMonth(fromDayIso(task.due_date))}`
          : 'Por agendar';
        return `Tarefa '${task?.title ?? ''}' agarrada. Posição: ${dayLabel}.`;
      },
      onDragOver({ active, over }) {
        if (!over) return undefined;
        const task = optimisticTasks.find((t) => t.id === active.id);
        const target = resolveDropTarget(String(over.id));
        if (!target) return undefined;
        if (target.type === 'unscheduled') {
          return `Sobre Por agendar.`;
        }
        const dayLabel = `${formatDayShort(fromDayIso(target.dayIso))} ${formatDayMonth(fromDayIso(target.dayIso))}`;
        if (task?.due_date === target.dayIso) return undefined;
        return `Sobre ${dayLabel}.`;
      },
      onDragEnd({ active, over }) {
        if (!over) return 'Movimento concluído.';
        const task = optimisticTasks.find((t) => t.id === active.id);
        const target = resolveDropTarget(String(over.id));
        if (!target) return 'Movimento concluído.';
        if (target.type === 'unscheduled') {
          return `${task?.title ?? 'Tarefa'} removida da agenda.`;
        }
        const dayLabel = `${formatDayShort(fromDayIso(target.dayIso))} ${formatDayMonth(fromDayIso(target.dayIso))}`;
        return `${task?.title ?? 'Tarefa'} movida para ${dayLabel}.`;
      },
      onDragCancel({ active }) {
        const task = optimisticTasks.find((t) => t.id === active.id);
        return `Movimento cancelado. ${task?.title ?? 'Tarefa'} mantém posição.`;
      },
    }),
    [optimisticTasks, resolveDropTarget],
  );

  const editingTask = editingTaskId ? optimisticTasks.find((t) => t.id === editingTaskId) ?? null : null;
  void weekStart;

  return (
    <div className="space-y-4">
      <DndContext
        sensors={sensors}
        collisionDetection={closestCorners}
        onDragStart={handleDragStart}
        onDragEnd={handleDragEnd}
        onDragCancel={handleDragCancel}
        accessibility={{
          announcements,
          screenReaderInstructions: {
            draggable:
              'Premir espaço para mover entre dias. Setas para reposicionar. Enter para soltar. Esc para cancelar.',
          },
        }}
      >
        <div
          className="grid gap-2 lg:grid-cols-[140px_1fr]"
          style={{ gap: 'var(--calendar-day-gap)' }}
        >
          <div className="lg:sticky lg:top-2 lg:max-h-[calc(100vh-200px)] lg:overflow-hidden">
            <UnscheduledSidebar
              tasks={unscheduledFiltered}
              totalCount={unscheduledTotalCount}
              onOpenTask={setEditingTaskId}
              onToggleChecked={handleToggleChecked}
            />
          </div>
          <WeekView
            weekStart={resolveWeekStart(weekStartIso)}
            tasks={scheduledTasks}
            onOpenTask={setEditingTaskId}
            onToggleChecked={handleToggleChecked}
          />
        </div>

        <DragOverlay>
          {activeTask ? <CalendarTaskCard task={activeTask} mode="overlay" /> : null}
        </DragOverlay>
      </DndContext>

      {toast && (
        <div
          role="status"
          aria-live="polite"
          className={
            toast.variant === 'error'
              ? 'fixed bottom-4 right-4 z-50 rounded-md border border-red-300 bg-red-50 px-4 py-2 text-sm text-red-800 shadow-lg dark:border-red-700 dark:bg-red-950 dark:text-red-200'
              : 'fixed bottom-4 right-4 z-50 rounded-md border border-green-300 bg-green-50 px-4 py-2 text-sm text-green-800 shadow-lg dark:border-green-700 dark:bg-green-950 dark:text-green-200'
          }
        >
          {toast.message}
        </div>
      )}

      {editingTask && (
        <EditTaskModal
          task={editingTask}
          open={editingTaskId !== null}
          onClose={() => setEditingTaskId(null)}
        />
      )}
    </div>
  );
}
