'use client';

import { useCallback, useMemo, useRef, useState, useTransition } from 'react';
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
  type DragOverEvent,
} from '@dnd-kit/core';
import { sortableKeyboardCoordinates } from '@dnd-kit/sortable';

// Story 3.4: usar @sentry/nextjs directamente em client islands (o package
// @meu-jarvis/observability importa node:crypto via logger e parte o webpack
// client bundle). Mesmo runtime, zero overhead — Sentry browser SDK já está
// inicializado via sentry.client.config.ts.
import { captureException } from '@sentry/nextjs';

import type { TaskRow } from '@/lib/api-helpers/list-tasks';
import type { KanbanColumnRow } from '@/lib/api-schemas/kanban-columns';

import { KanbanBoard } from '@/app/(app)/tarefas/kanban/_components/KanbanBoard';
import { KanbanCardOverlay } from '@/app/(app)/tarefas/kanban/_components/KanbanCardOverlay';
import { ColumnConfigSheet } from '@/app/(app)/tarefas/kanban/_components/ColumnConfigSheet';
import { KanbanFilterBar } from '@/app/(app)/tarefas/kanban/_components/KanbanFilterBar';
import { EditTaskModal } from '@/app/(app)/tarefas/_components/EditTaskModal';

/**
 * `<KanbanBoardClient>` — wrapper client island com DndContext + estado optimista.
 *
 * Responsabilidades (Story 3.4 T4.3 / AC4 + AC5):
 *   - Sensors @dnd-kit (Pointer 8px + Touch 250ms delay + Keyboard) (AC4a)
 *   - Drag lifecycle: onDragStart → onDragOver → onDragEnd (optimistic + revert) (AC4c)
 *   - PATCH `/api/tasks/[id]/move` reutilizado da Story 3.2
 *   - 4 cenários de erro PT-PT (403/404/409/500) (AC5)
 *   - Acessibilidade keyboard-first + screen reader announcements PT-PT (AC6)
 *   - EditTaskModal abre no click do body de um card (DP-3.4.2)
 *   - ColumnConfigSheet abre via botão "⚙ Configurar"
 *
 * Pattern guidance Aria:
 *   - G1.1: KanbanCard usa React.memo shallow (props primitivas/refs estáveis)
 *   - DP-3.4.5: navigator.vibrate(10) feature-detected no onDragStart
 */
export interface KanbanBoardClientProps {
  readonly initialTasks: readonly TaskRow[];
  readonly initialColumns: readonly KanbanColumnRow[];
}

type ErrorCode = 403 | 404 | 409 | 500;

function mapErrorToCopy(status: number): string {
  const code = status as ErrorCode;
  switch (code) {
    case 403:
      return 'Não tens permissão para mover esta tarefa.';
    case 404:
      return 'Esta tarefa foi eliminada. A lista vai actualizar.';
    case 409:
      return 'A coluna foi removida. A lista vai actualizar.';
    case 500:
    default:
      return 'Ocorreu um erro a mover a tarefa. Tenta de novo.';
  }
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

interface ToastState {
  message: string;
  variant: 'error' | 'success';
}

export function KanbanBoardClient({
  initialTasks,
  initialColumns,
}: KanbanBoardClientProps): React.ReactElement {
  const router = useRouter();
  const [tasks, setTasks] = useState<readonly TaskRow[]>(initialTasks);
  const [columns, setColumns] = useState<readonly KanbanColumnRow[]>(initialColumns);
  const [activeTaskId, setActiveTaskId] = useState<string | null>(null);
  const [toast, setToast] = useState<ToastState | null>(null);
  const [, startTransition] = useTransition();
  const [showConfigSheet, setShowConfigSheet] = useState(false);
  const [editingTaskId, setEditingTaskId] = useState<string | null>(null);
  const taskOriginalRef = useRef<TaskRow | null>(null);

  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: { distance: 8 },
    }),
    useSensor(TouchSensor, {
      activationConstraint: { delay: 250, tolerance: 5 },
    }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    }),
  );

  const activeTask = useMemo(
    () => (activeTaskId ? (tasks.find((t) => t.id === activeTaskId) ?? null) : null),
    [activeTaskId, tasks],
  );

  const columnsById = useMemo(
    () => new Map(columns.map((c) => [c.id, c])),
    [columns],
  );

  const findColumnIdOfTask = useCallback(
    (taskId: string): string | null => {
      const task = tasks.find((t) => t.id === taskId);
      return task?.kanban_column_id ?? null;
    },
    [tasks],
  );

  const findTargetColumnId = useCallback(
    (overId: string): string | null => {
      // overId pode ser column.id (drop directo na coluna) ou task.id (drop sobre card)
      if (columnsById.has(overId)) return overId;
      const overTask = tasks.find((t) => t.id === overId);
      return overTask?.kanban_column_id ?? null;
    },
    [tasks, columnsById],
  );

  function showToast(message: string, variant: ToastState['variant']): void {
    setToast({ message, variant });
    setTimeout(() => setToast(null), 5000);
  }

  const handleDragStart = useCallback((event: DragStartEvent) => {
    setActiveTaskId(event.active.id as string);
    const original = initialTasks.find((t) => t.id === event.active.id) ?? null;
    taskOriginalRef.current = original;
    hapticFeedback();
  }, [initialTasks]);

  const handleDragOver = useCallback((_event: DragOverEvent) => {
    // Visual feedback handled pelo @dnd-kit + SortableContext nativo (drop-target border).
    // Mantemos hook para futuro live-update visual.
  }, []);

  const handleDragEnd = useCallback(
    async (event: DragEndEvent) => {
      setActiveTaskId(null);
      const { active, over } = event;
      if (!over) return;

      const taskId = active.id as string;
      const overId = over.id as string;

      const targetColumnId = findTargetColumnId(overId);
      if (!targetColumnId) return;

      const sourceColumnId = findColumnIdOfTask(taskId);
      const task = tasks.find((t) => t.id === taskId);
      if (!task) return;

      // Compute new position:
      //  - se drop sobre coluna directa → vai para o fim da coluna
      //  - se drop sobre outro card → take that card's position
      let targetPosition: number;
      if (columnsById.has(overId)) {
        // drop sobre header / espaço vazio da coluna → fim da coluna
        const sameCol = tasks.filter((t) => t.kanban_column_id === targetColumnId);
        targetPosition = sameCol.length;
      } else {
        const overTask = tasks.find((t) => t.id === overId);
        targetPosition = overTask?.kanban_position ?? 0;
      }

      // Se não mudou nada, abort silently
      if (
        sourceColumnId === targetColumnId &&
        task.kanban_position === targetPosition
      ) {
        return;
      }

      const previousTasks = tasks;

      // Optimistic update: mover task localmente
      const optimistic = tasks.map((t) => {
        if (t.id === taskId) {
          return {
            ...t,
            kanban_column_id: targetColumnId,
            kanban_position: targetPosition,
          };
        }
        return t;
      });
      setTasks(optimistic);

      try {
        const res = await fetch(`/api/tasks/${taskId}/move`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            kanban_column_id: targetColumnId,
            kanban_position: targetPosition,
          }),
        });
        if (!res.ok) {
          setTasks(previousTasks);
          showToast(mapErrorToCopy(res.status), 'error');
          if (res.status === 500) {
            captureException(new Error(`Move task failed: ${res.status}`), {
              tags: { route: '/api/tasks/[id]/move' },
              extra: { taskId },
            });
          }
          if (res.status === 404 || res.status === 409) {
            startTransition(() => router.refresh());
          }
          return;
        }
        // Sucesso silent — refresh server data para reconciliar
        startTransition(() => router.refresh());
      } catch (err) {
        setTasks(previousTasks);
        showToast(mapErrorToCopy(500), 'error');
        captureException(err instanceof Error ? err : new Error(String(err)), {
          tags: { route: '/api/tasks/[id]/move' },
          extra: { taskId },
        });
      }
    },
    [tasks, columnsById, router, findColumnIdOfTask, findTargetColumnId],
  );

  const handleDragCancel = useCallback(() => {
    setActiveTaskId(null);
    taskOriginalRef.current = null;
  }, []);

  // Anúncios PT-PT (AC6c) — usados por @dnd-kit accessibility prop
  const announcements: Announcements = useMemo(
    () => ({
      onDragStart({ active }) {
        const task = tasks.find((t) => t.id === active.id);
        const col = task?.kanban_column_id ? columnsById.get(task.kanban_column_id) : null;
        return `Pegaste em ${task?.title ?? 'tarefa'} da coluna ${col?.name ?? 'sem coluna'}.`;
      },
      onDragOver({ active, over }) {
        if (!over) return undefined;
        const task = tasks.find((t) => t.id === active.id);
        const targetColId = findTargetColumnId(String(over.id));
        if (!targetColId) return undefined;
        const targetCol = columnsById.get(targetColId);
        const sameColTasks = tasks.filter((t) => t.kanban_column_id === targetColId);
        const posIndex =
          sameColTasks.findIndex((t) => t.id === over.id) + 1 || sameColTasks.length;
        const total = sameColTasks.length;
        if (task?.kanban_column_id !== targetColId) {
          return `Sobre coluna ${targetCol?.name ?? ''}, posição ${posIndex} de ${total}.`;
        }
        return `Posição ${posIndex} de ${total} na coluna ${targetCol?.name ?? ''}.`;
      },
      onDragEnd({ active, over }) {
        if (!over) return 'Movimento concluído.';
        const task = tasks.find((t) => t.id === active.id);
        const targetColId = findTargetColumnId(String(over.id));
        const targetCol = targetColId ? columnsById.get(targetColId) : null;
        const sameColTasks = tasks.filter((t) => t.kanban_column_id === targetColId);
        const posIndex =
          sameColTasks.findIndex((t) => t.id === over.id) + 1 || sameColTasks.length;
        return `${task?.title ?? 'Tarefa'} movida para ${targetCol?.name ?? ''}, posição ${posIndex}.`;
      },
      onDragCancel({ active }) {
        const task = tasks.find((t) => t.id === active.id);
        const col = task?.kanban_column_id ? columnsById.get(task.kanban_column_id) : null;
        return `Movimento cancelado. ${task?.title ?? 'Tarefa'} permanece em ${col?.name ?? 'coluna actual'}.`;
      },
    }),
    [tasks, columnsById, findTargetColumnId],
  );

  const editingTask = editingTaskId ? tasks.find((t) => t.id === editingTaskId) ?? null : null;

  function handleColumnsSaved(newColumns: readonly KanbanColumnRow[]): void {
    setColumns(newColumns);
    setShowConfigSheet(false);
    startTransition(() => router.refresh());
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
        <KanbanFilterBar />
        <button
          type="button"
          onClick={() => setShowConfigSheet(true)}
          className="rounded-md border border-black/15 bg-white px-3 py-1.5 text-sm font-medium hover:bg-neutral-50 dark:border-white/15 dark:bg-neutral-800 dark:hover:bg-neutral-700"
        >
          Configurar colunas
        </button>
      </div>

      <DndContext
        sensors={sensors}
        collisionDetection={closestCorners}
        onDragStart={handleDragStart}
        onDragOver={handleDragOver}
        onDragEnd={handleDragEnd}
        onDragCancel={handleDragCancel}
        accessibility={{
          announcements,
          screenReaderInstructions: {
            draggable:
              'Premir espaço para mover. Setas para reposicionar. Enter para soltar. Esc para cancelar.',
          },
        }}
      >
        <KanbanBoard
          columns={columns}
          tasks={tasks}
          onOpenTask={setEditingTaskId}
        />
        <DragOverlay>{activeTask ? <KanbanCardOverlay task={activeTask} /> : null}</DragOverlay>
      </DndContext>

      {/* sr-only live region complementar — @dnd-kit usa o seu próprio mas duplicamos
          para garantir compatibilidade screen readers que possam ignorar o seu */}
      <div
        id="kanban-instructions"
        className="sr-only"
        aria-live="polite"
        aria-atomic="true"
      >
        Quadro Kanban. Premir espaço sobre um card para iniciar mover. Setas para
        reposicionar entre colunas e dentro da coluna. Enter para soltar. Esc para
        cancelar.
      </div>

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

      {showConfigSheet && (
        <ColumnConfigSheet
          currentColumns={columns}
          onClose={() => setShowConfigSheet(false)}
          onSaved={handleColumnsSaved}
        />
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
