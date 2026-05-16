'use client';

import { useEffect, useRef, useState } from 'react';

/**
 * `<InlineEditTitle>` — span ↔ input swap para editar título in-place
 * (Story 3.3 T7.1 / AC8).
 *
 * Comportamento:
 *   - Click no span → swap para input pre-filled com title actual.
 *   - Blur ou Enter → PATCH `/api/tasks/[id]` com `{ title }`.
 *   - Escape → revert sem PATCH.
 *   - Validação client-side: min 1, max 200 (alinha com Zod TitleSchema Story 3.2).
 *   - Optimistic: title actualiza no DOM antes de PATCH resolver; revert se falha.
 */
export interface InlineEditTitleProps {
  readonly taskId: string;
  readonly initialTitle: string;
  readonly className?: string;
}

const MAX_LEN = 200;

export function InlineEditTitle({
  taskId,
  initialTitle,
  className,
}: InlineEditTitleProps): React.ReactElement {
  const [isEditing, setEditing] = useState(false);
  const [title, setTitle] = useState(initialTitle);
  const [draft, setDraft] = useState(initialTitle);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (isEditing && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    }
  }, [isEditing]);

  function validate(value: string): string | null {
    const trimmed = value.trim();
    if (trimmed.length === 0) return 'Título obrigatório.';
    if (trimmed.length > MAX_LEN) return `Título excede ${MAX_LEN} caracteres.`;
    return null;
  }

  async function save() {
    const trimmed = draft.trim();
    const validationError = validate(trimmed);
    if (validationError) {
      setError(validationError);
      return;
    }
    if (trimmed === title) {
      setEditing(false);
      setError(null);
      return;
    }
    const previous = title;
    setTitle(trimmed); // optimistic
    setPending(true);
    setError(null);
    try {
      const res = await fetch(`/api/tasks/${taskId}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ title: trimmed }),
      });
      if (!res.ok) {
        setTitle(previous);
        const body = (await res.json().catch(() => ({}))) as { error?: { message?: string } };
        setError(body.error?.message ?? 'Erro ao guardar. Tenta novamente.');
        return;
      }
      setEditing(false);
    } catch {
      setTitle(previous);
      setError('Erro temporário. Tenta novamente.');
    } finally {
      setPending(false);
    }
  }

  function cancel() {
    setDraft(title);
    setError(null);
    setEditing(false);
  }

  if (!isEditing) {
    return (
      <button
        type="button"
        onClick={() => {
          setDraft(title);
          setEditing(true);
        }}
        className={className ?? 'text-left text-sm hover:underline'}
        aria-label="Editar título"
      >
        {title}
      </button>
    );
  }

  return (
    <div className="flex flex-col gap-1">
      <input
        ref={inputRef}
        type="text"
        value={draft}
        onChange={(e) => {
          setDraft(e.target.value);
          if (error) setError(validate(e.target.value));
        }}
        onBlur={save}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            void save();
          } else if (e.key === 'Escape') {
            e.preventDefault();
            cancel();
          }
        }}
        disabled={pending}
        maxLength={MAX_LEN + 50}
        aria-invalid={error != null}
        className={
          error
            ? 'rounded-md border border-red-500 bg-white px-2 py-1 text-sm dark:bg-neutral-900'
            : 'rounded-md border border-blue-500 bg-white px-2 py-1 text-sm dark:bg-neutral-900'
        }
      />
      {error && (
        <span role="alert" className="text-xs text-red-600 dark:text-red-400">
          {error}
        </span>
      )}
    </div>
  );
}
