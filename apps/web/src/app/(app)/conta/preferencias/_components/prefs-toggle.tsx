'use client';

import { useState } from 'react';

export interface PrefsToggleProps {
  readonly initial: { always_preview: boolean };
}

type Banner =
  | { kind: 'idle' }
  | { kind: 'success'; text: string }
  | { kind: 'error'; text: string };

/**
 * `PrefsToggle` — Client Component para o toggle `always_preview`.
 *
 * Story 2.7 AC10 — comportamento:
 *   - Recebe valor inicial do Server Component (já lazy-init via endpoint).
 *   - Optimistic update: muda visualmente antes do PATCH; revert em erro.
 *   - PATCH `/api/conta/preferencias` com body `{ always_preview }`.
 *   - Banner "Guardado" / "Erro" com auto-clear após 3s.
 *
 * Tom PT-PT estrito.
 */
export function PrefsToggle({ initial }: PrefsToggleProps): React.ReactElement {
  const [alwaysPreview, setAlwaysPreview] = useState<boolean>(initial.always_preview);
  const [pending, setPending] = useState(false);
  const [banner, setBanner] = useState<Banner>({ kind: 'idle' });

  async function handleToggle(): Promise<void> {
    if (pending) return;
    const previous = alwaysPreview;
    const next = !previous;
    setAlwaysPreview(next); // optimistic
    setPending(true);
    setBanner({ kind: 'idle' });

    try {
      const res = await fetch('/api/conta/preferencias', {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ always_preview: next }),
      });
      if (!res.ok) {
        setAlwaysPreview(previous); // revert
        const body = (await res.json().catch(() => ({}))) as { error?: { message?: string } };
        setBanner({ kind: 'error', text: body.error?.message ?? 'Erro ao guardar. Tenta de novo.' });
        return;
      }
      setBanner({ kind: 'success', text: 'Guardado.' });
      setTimeout(() => setBanner({ kind: 'idle' }), 3000);
    } catch {
      setAlwaysPreview(previous); // revert
      setBanner({ kind: 'error', text: 'Erro temporário. Tenta de novo.' });
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="rounded-lg border border-black/10 p-4 dark:border-white/10">
      <label className="flex items-start gap-3 text-sm">
        <input
          type="checkbox"
          role="switch"
          aria-label="Confirmar sempre antes de gravar"
          checked={alwaysPreview}
          onChange={handleToggle}
          disabled={pending}
          className="mt-0.5 h-4 w-4 cursor-pointer disabled:cursor-not-allowed"
        />
        <span className="space-y-1">
          <span className="block font-medium">
            Confirmar sempre antes de gravar (mais seguro, mais cliques)
          </span>
          <span className="block text-xs text-muted-foreground">
            Quando activo, o Jarvis mostra-te sempre uma pré-visualização antes de gravar
            qualquer operação — mesmo em casos de alta confiança.
          </span>
        </span>
      </label>

      {banner.kind === 'success' && (
        <div
          role="status"
          className="mt-3 rounded-md bg-green-50 px-3 py-1.5 text-xs text-green-800 dark:bg-green-950/30 dark:text-green-200"
        >
          {banner.text}
        </div>
      )}
      {banner.kind === 'error' && (
        <div
          role="alert"
          className="mt-3 rounded-md bg-red-50 px-3 py-1.5 text-xs text-red-800 dark:bg-red-950/30 dark:text-red-200"
        >
          {banner.text}
        </div>
      )}
    </div>
  );
}
