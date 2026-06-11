'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';

import type { TaskPriorityInput } from '@/lib/api-schemas/tasks';

/**
 * `<NewTaskModal>` — formulário completo de criação de tarefa (P1 make-it-work).
 *
 * Campos: título (obrigatório) + descrição + prazo + hora + prioridade + projecto.
 * Resolve o gap "criar tarefa fragmentado": o Calendário criava sem hora/prioridade,
 * o Kanban só com título e o botão "+ Nova" da Lista estava `disabled`. O backend
 * `POST /api/tasks` (Story 3.2) já aceitava todos estes campos — faltava a UI.
 *
 * Pattern hand-rolled (zero deps Radix/shadcn) seguindo `EditTaskModal.tsx`:
 * dialog overlay + Escape para fechar + alerta inline PT-PT.
 *
 * A `hora` só é enviada quando há `prazo` (due_time sem due_date não faz sentido
 * de domínio); o campo fica desactivado enquanto não houver data.
 */
export interface NewTaskModalProps {
  readonly open: boolean;
  readonly onClose: () => void;
  /** Data pré-preenchida (YYYY-MM-DD) — ex.: abrir a partir de um dia do Calendário. */
  readonly initialDueDate?: string | null;
}

const EMPTY = {
  title: '',
  description: '',
  dueDate: '',
  dueTime: '',
  priority: 'medium' as TaskPriorityInput,
  project: '',
};

export function NewTaskModal({
  open,
  onClose,
  initialDueDate,
}: NewTaskModalProps): React.ReactElement | null {
  const router = useRouter();
  const [title, setTitle] = useState(EMPTY.title);
  const [description, setDescription] = useState(EMPTY.description);
  const [dueDate, setDueDate] = useState(initialDueDate ?? EMPTY.dueDate);
  const [dueTime, setDueTime] = useState(EMPTY.dueTime);
  const [priority, setPriority] = useState<TaskPriorityInput>(EMPTY.priority);
  const [project, setProject] = useState(EMPTY.project);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Reset ao abrir — começa sempre limpo (excepto data pré-preenchida).
  useEffect(() => {
    if (open) {
      setTitle(EMPTY.title);
      setDescription(EMPTY.description);
      setDueDate(initialDueDate ?? EMPTY.dueDate);
      setDueTime(EMPTY.dueTime);
      setPriority(EMPTY.priority);
      setProject(EMPTY.project);
      setError(null);
    }
  }, [open, initialDueDate]);

  useEffect(() => {
    function onKey(e: KeyboardEvent): void {
      if (e.key === 'Escape') onClose();
    }
    if (open) document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;

  async function handleCreate(): Promise<void> {
    const trimmedTitle = title.trim();
    if (!trimmedTitle) {
      setError('O título é obrigatório.');
      return;
    }

    setPending(true);
    setError(null);
    try {
      const body: Record<string, unknown> = {
        title: trimmedTitle,
        description: description.trim() || null,
        due_date: dueDate || null,
        // due_time só faz sentido com data — caso contrário fica null.
        due_time: dueDate && dueTime ? dueTime : null,
        priority,
        project: project.trim() || null,
      };
      const res = await fetch('/api/tasks', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const respBody = (await res.json().catch(() => ({}))) as {
          error?: { message?: string };
        };
        setError(respBody.error?.message ?? 'Erro ao criar tarefa. Tenta novamente.');
        return;
      }
      router.refresh();
      onClose();
    } catch {
      setError('Erro temporário. Tenta novamente.');
    } finally {
      setPending(false);
    }
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="new-task-title"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      onClick={onClose}
    >
      <div
        className="w-full max-w-md rounded-lg bg-white p-6 shadow-lg dark:bg-neutral-900"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 id="new-task-title" className="text-lg font-semibold">
          Nova tarefa
        </h2>

        <form
          className="mt-4 space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            void handleCreate();
          }}
        >
          <label className="block">
            <span className="text-sm font-medium">
              Título <span className="text-red-600">*</span>
            </span>
            <input
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              maxLength={200}
              autoFocus
              aria-label="Título da tarefa"
              className="mt-1 block w-full rounded-md border border-black/15 bg-white px-2 py-1 text-sm dark:border-white/15 dark:bg-neutral-800"
            />
          </label>

          <label className="block">
            <span className="text-sm font-medium">Descrição</span>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={3}
              maxLength={5000}
              className="mt-1 block w-full rounded-md border border-black/15 bg-white px-2 py-1 text-sm dark:border-white/15 dark:bg-neutral-800"
            />
          </label>

          <div className="flex gap-3">
            <label className="block flex-1">
              <span className="text-sm font-medium">Prazo</span>
              <input
                type="date"
                value={dueDate}
                onChange={(e) => setDueDate(e.target.value)}
                aria-label="Prazo"
                className="mt-1 block w-full rounded-md border border-black/15 bg-white px-2 py-1 text-sm dark:border-white/15 dark:bg-neutral-800"
              />
            </label>
            <label className="block flex-1">
              <span className="text-sm font-medium">Hora</span>
              <input
                type="time"
                value={dueTime}
                onChange={(e) => setDueTime(e.target.value)}
                disabled={!dueDate}
                aria-label="Hora"
                title={!dueDate ? 'Define primeiro um prazo.' : undefined}
                className="mt-1 block w-full rounded-md border border-black/15 bg-white px-2 py-1 text-sm disabled:opacity-50 dark:border-white/15 dark:bg-neutral-800"
              />
            </label>
          </div>

          <label className="block">
            <span className="text-sm font-medium">Prioridade</span>
            <select
              value={priority}
              onChange={(e) => setPriority(e.target.value as TaskPriorityInput)}
              aria-label="Prioridade"
              className="mt-1 block w-full rounded-md border border-black/15 bg-white px-2 py-1 text-sm dark:border-white/15 dark:bg-neutral-800"
            >
              <option value="high">Alta</option>
              <option value="medium">Média</option>
              <option value="low">Baixa</option>
            </select>
          </label>

          <label className="block">
            <span className="text-sm font-medium">Projecto</span>
            <input
              type="text"
              value={project}
              onChange={(e) => setProject(e.target.value)}
              maxLength={100}
              placeholder="Opcional"
              aria-label="Projecto"
              className="mt-1 block w-full rounded-md border border-black/15 bg-white px-2 py-1 text-sm dark:border-white/15 dark:bg-neutral-800"
            />
          </label>

          {error && (
            <div
              role="alert"
              className="rounded-md bg-red-50 px-3 py-1.5 text-xs text-red-800 dark:bg-red-950/30 dark:text-red-200"
            >
              {error}
            </div>
          )}

          <div className="flex justify-end gap-2 pt-2">
            <button
              type="button"
              onClick={onClose}
              disabled={pending}
              className="rounded-md border border-black/15 bg-white px-3 py-1.5 text-sm font-medium hover:bg-neutral-50 disabled:opacity-50 dark:border-white/15 dark:bg-neutral-800 dark:hover:bg-neutral-700"
            >
              Cancelar
            </button>
            <button
              type="submit"
              disabled={pending}
              className="rounded-md bg-blue-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
            >
              {pending ? 'A criar...' : 'Criar tarefa'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
