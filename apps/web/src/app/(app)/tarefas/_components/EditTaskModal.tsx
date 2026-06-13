'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';

import type { TaskRow } from '@/lib/api-helpers/list-tasks';
import type { Tag } from '@/lib/api-schemas/tags';

import { TagBadge } from '@/app/(app)/tarefas/_components/TagBadge';
import { TagPicker } from '@/app/(app)/tarefas/_components/TagPicker';

/**
 * `<EditTaskModal>` — modal subset minimal (DP6-3.3 A — Story 3.3 T7.3 / Story 3.6 T6.4).
 *
 * Campos editáveis: description + due_date + priority + tags (Story 3.6 T6.4) +
 * atribuição a um membro do household (A6 — finish-line). Os membros são
 * carregados ao abrir de `GET /api/conta/household`; o `PATCH /api/tasks/[id]`
 * já aceitava `assigned_to_user_id` (UUID ou null) — faltava só a UI.
 */
export interface EditTaskModalProps {
  readonly task: TaskRow;
  readonly open: boolean;
  readonly onClose: () => void;
}

/** Subset de `HouseholdMemberDTO` consumido pelo select "Atribuir a" (A6). */
interface AssignableMember {
  readonly id: string;
  readonly fullName: string | null;
}

export function EditTaskModal({ task, open, onClose }: EditTaskModalProps): React.ReactElement | null {
  const router = useRouter();
  const [description, setDescription] = useState(task.description ?? '');
  const [dueDate, setDueDate] = useState(task.due_date ?? '');
  const [priority, setPriority] = useState(task.priority);
  const [tags, setTags] = useState<Tag[]>(task.tags ?? []);
  const [assignedTo, setAssignedTo] = useState(task.assigned_to_user_id ?? '');
  const [members, setMembers] = useState<readonly AssignableMember[] | null>(null);
  const [membersFailed, setMembersFailed] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setDescription(task.description ?? '');
      setDueDate(task.due_date ?? '');
      setPriority(task.priority);
      setTags(task.tags ?? []);
      setAssignedTo(task.assigned_to_user_id ?? '');
      setError(null);
    }
  }, [open, task]);

  // Carrega os membros do household ao abrir (para o select "Atribuir a").
  // Degrada graceful: se falhar, esconde o select e mantém a atribuição actual.
  useEffect(() => {
    if (!open) return;
    setMembers(null);
    setMembersFailed(false);

    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch('/api/conta/household');
        if (!res.ok) throw new Error(`GET household ${res.status}`);
        const data = (await res.json()) as { members: AssignableMember[] };
        if (cancelled) return;
        setMembers(data.members);
      } catch {
        if (!cancelled) setMembersFailed(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [open]);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
    }
    if (open) document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;

  async function handleSave() {
    setPending(true);
    setError(null);
    try {
      const body: Record<string, unknown> = {
        description: description.trim() || null,
        due_date: dueDate || null,
        priority,
        // Vazio → null (desatribui); UUID → atribui. `TaskUpdateSchema` aceita ambos.
        assigned_to_user_id: assignedTo || null,
      };
      const res = await fetch(`/api/tasks/${task.id}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const respBody = (await res.json().catch(() => ({}))) as { error?: { message?: string } };
        setError(respBody.error?.message ?? 'Erro ao guardar. Tenta novamente.');
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
      aria-labelledby="edit-task-title"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      onClick={onClose}
    >
      <div
        className="w-full max-w-md rounded-lg bg-white p-6 shadow-lg dark:bg-neutral-900"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 id="edit-task-title" className="text-lg font-semibold">
          Editar tarefa
        </h2>

        <div className="mt-4 space-y-4">
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

          <label className="block">
            <span className="text-sm font-medium">Prazo</span>
            <input
              type="date"
              value={dueDate}
              onChange={(e) => setDueDate(e.target.value)}
              className="mt-1 block w-full rounded-md border border-black/15 bg-white px-2 py-1 text-sm dark:border-white/15 dark:bg-neutral-800"
            />
          </label>

          <label className="block">
            <span className="text-sm font-medium">Prioridade</span>
            <select
              value={priority}
              onChange={(e) => setPriority(e.target.value)}
              className="mt-1 block w-full rounded-md border border-black/15 bg-white px-2 py-1 text-sm dark:border-white/15 dark:bg-neutral-800"
            >
              <option value="high">Alta</option>
              <option value="medium">Média</option>
              <option value="low">Baixa</option>
            </select>
          </label>

          {!membersFailed && (
            <label className="block">
              <span className="text-sm font-medium">Atribuir a</span>
              <select
                value={assignedTo}
                onChange={(e) => setAssignedTo(e.target.value)}
                disabled={members === null}
                aria-label="Atribuir a"
                className="mt-1 block w-full rounded-md border border-black/15 bg-white px-2 py-1 text-sm dark:border-white/15 dark:bg-neutral-800"
              >
                {members === null ? (
                  <option value="">A carregar membros...</option>
                ) : (
                  <option value="">Sem responsável</option>
                )}
                {(members ?? []).map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.fullName ?? 'Membro sem nome'}
                  </option>
                ))}
              </select>
            </label>
          )}

          {membersFailed && (
            <p role="status" className="text-xs text-amber-700 dark:text-amber-300">
              Não foi possível carregar os membros — a atribuição actual é mantida.
            </p>
          )}

          <div>
            <span className="text-sm font-medium">Tags</span>
            <div className="mt-1 flex flex-wrap items-center gap-1">
              {tags.length > 0 && (
                <ul role="list" aria-label="Tags actuais" className="flex flex-wrap items-center gap-1">
                  {tags.map((t) => (
                    <TagBadge key={t.id} tag={t} size="sm" />
                  ))}
                </ul>
              )}
              <TagPicker
                taskId={task.id}
                currentTags={tags}
                onTagsChange={(next) => setTags(next)}
              />
            </div>
          </div>

          {error && (
            <div role="alert" className="rounded-md bg-red-50 px-3 py-1.5 text-xs text-red-800 dark:bg-red-950/30 dark:text-red-200">
              {error}
            </div>
          )}
        </div>

        <div className="mt-6 flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            disabled={pending}
            className="rounded-md border border-black/15 bg-white px-3 py-1.5 text-sm font-medium hover:bg-neutral-50 disabled:opacity-50 dark:border-white/15 dark:bg-neutral-800 dark:hover:bg-neutral-700"
          >
            Cancelar
          </button>
          <button
            type="button"
            onClick={handleSave}
            disabled={pending}
            className="rounded-md bg-blue-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
          >
            {pending ? 'A guardar...' : 'Guardar'}
          </button>
        </div>
      </div>
    </div>
  );
}
