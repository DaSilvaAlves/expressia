'use client';

import { useState } from 'react';

import type { AccountDeletionJobDTO } from '@/lib/api-schemas/account-deletion';

/**
 * `<DeleteAccount>` — secção "Eliminação de conta" da página `/conta/dados`
 * (Story 6.9 AC6, GDPR Art. 17). Estados:
 *   - `none`        → botão "Eliminar conta" + diálogo de confirmação forte.
 *   - `scheduled`   → data PT-PT + botão "Cancelar eliminação".
 *   - `in_progress` → mensagem informativa, sem acção.
 *
 * Confirmação forte (AC6): o botão final só activa quando o utilizador escreve
 * `ELIMINAR` (maiúsculas exactas). Dispara `POST /api/conta/delete`.
 * O cancelamento dispara `DELETE /api/conta/delete`.
 *
 * Sem polling (AC6): o estado inicial vem do SSR; após uma acção, recarrega a
 * página (`window.location.reload`) para reler o estado.
 *
 * Tom PT-PT estrito (CON3). Tokens do design system dark-first.
 *
 * Trace: Story 6.9 AC6; FR29; CON3.
 */

/** Palavra de confirmação exigida (maiúsculas exactas). */
const CONFIRM_WORD = 'ELIMINAR';

interface DeleteAccountProps {
  /** Estado inicial lido no SSR (`null` = sem eliminação agendada). */
  readonly initialJob: AccountDeletionJobDTO | null;
}

interface ErrorResponse {
  error?: { message?: string };
}

/** Formata uma data ISO em PT-PT: "DD/MM/YYYY". */
function formatDatePt(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  const d = String(date.getDate()).padStart(2, '0');
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const y = date.getFullYear();
  return `${d}/${m}/${y}`;
}

export function DeleteAccount({ initialJob }: DeleteAccountProps): React.ReactElement {
  const status = initialJob?.status ?? 'none';

  if (status === 'in_progress') {
    return <DeleteAccountInProgress />;
  }
  if (initialJob && status === 'scheduled') {
    return <DeleteAccountScheduled job={initialJob} />;
  }
  return <DeleteAccountNone />;
}

/** Estado `in_progress` — eliminação em curso, sem acção disponível. */
function DeleteAccountInProgress(): React.ReactElement {
  return (
    <section
      className="rounded-lg border border-danger/40 p-4"
      aria-labelledby="delete-account-heading"
    >
      <h2 id="delete-account-heading" className="text-sm font-medium text-foreground">
        Eliminação de conta
      </h2>
      <div
        role="status"
        className="mt-3 rounded-md bg-danger-subtle px-3 py-2.5 text-xs text-danger"
      >
        A tua conta está a ser eliminada. Este processo pode demorar alguns minutos.
      </div>
    </section>
  );
}

/** Estado `scheduled` — eliminação agendada com data + botão de cancelamento. */
function DeleteAccountScheduled({
  job,
}: {
  readonly job: AccountDeletionJobDTO;
}): React.ReactElement {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleCancel(): Promise<void> {
    if (busy) return;
    setBusy(true);
    setError(null);

    try {
      const res = await fetch('/api/conta/delete', { method: 'DELETE' });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as ErrorResponse;
        setError(
          body.error?.message ?? 'Não foi possível cancelar a eliminação. Tenta novamente.',
        );
        setBusy(false);
        return;
      }
      // Recarrega para reler o estado (sem polling — AC6).
      window.location.reload();
    } catch {
      setError('Erro de ligação. Verifica a tua internet e tenta novamente.');
      setBusy(false);
    }
  }

  return (
    <section
      className="rounded-lg border border-danger/40 p-4"
      aria-labelledby="delete-account-heading"
    >
      <h2 id="delete-account-heading" className="text-sm font-medium text-foreground">
        Eliminação de conta
      </h2>
      <div
        role="status"
        className="mt-3 rounded-md bg-danger-subtle px-3 py-2.5 text-xs text-danger"
      >
        A tua conta será eliminada a {formatDatePt(job.scheduledFor)}. Podes cancelar a
        eliminação até essa data.
      </div>

      <button
        type="button"
        onClick={() => void handleCancel()}
        disabled={busy}
        className="mt-3 inline-flex min-h-11 items-center justify-center rounded-md border border-border bg-background px-4 py-2 text-sm font-medium text-foreground transition-colors hover:bg-muted disabled:cursor-not-allowed disabled:opacity-60"
      >
        {busy ? 'A cancelar…' : 'Cancelar eliminação'}
      </button>

      {error && (
        <div role="alert" className="mt-3 rounded-md bg-danger-subtle px-3 py-2 text-xs text-danger">
          {error}
        </div>
      )}
    </section>
  );
}

/** Estado `none` — botão "Eliminar conta" + diálogo de confirmação forte. */
function DeleteAccountNone(): React.ReactElement {
  const [confirming, setConfirming] = useState(false);
  const [typed, setTyped] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const canConfirm = typed === CONFIRM_WORD && !busy;

  function openDialog(): void {
    setTyped('');
    setError(null);
    setConfirming(true);
  }

  function closeDialog(): void {
    if (busy) return;
    setConfirming(false);
    setTyped('');
    setError(null);
  }

  async function handleDelete(): Promise<void> {
    if (!canConfirm) return;
    setBusy(true);
    setError(null);

    try {
      const res = await fetch('/api/conta/delete', { method: 'POST' });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as ErrorResponse;
        setError(
          body.error?.message ?? 'Não foi possível agendar a eliminação. Tenta novamente.',
        );
        setBusy(false);
        return;
      }
      // Recarrega para mostrar o estado agendado (sem polling — AC6).
      window.location.reload();
    } catch {
      setError('Erro de ligação. Verifica a tua internet e tenta novamente.');
      setBusy(false);
    }
  }

  return (
    <section
      className="rounded-lg border border-danger/40 p-4"
      aria-labelledby="delete-account-heading"
    >
      <h2 id="delete-account-heading" className="text-sm font-medium text-foreground">
        Eliminação de conta
      </h2>
      <p className="mt-1 text-xs text-muted-foreground">
        Os teus dados serão permanentemente eliminados após 30 dias. Podes cancelar durante
        esse período. Esta acção elimina toda a tua conta, incluindo tarefas, finanças e
        preferências.
      </p>

      {!confirming && (
        <button
          type="button"
          onClick={openDialog}
          className="mt-3 inline-flex min-h-11 items-center justify-center rounded-md bg-danger px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-danger/90"
        >
          Eliminar conta
        </button>
      )}

      {confirming && (
        <div
          role="alertdialog"
          aria-labelledby="delete-confirm-title"
          aria-describedby="delete-confirm-desc"
          className="mt-3 rounded-md border border-danger/50 bg-danger-subtle p-4"
        >
          <h3 id="delete-confirm-title" className="text-sm font-semibold text-danger">
            Confirmar eliminação de conta
          </h3>
          <p id="delete-confirm-desc" className="mt-1 text-xs text-danger/90">
            Esta acção agenda a eliminação permanente da tua conta para daqui a 30 dias.
            Para confirmar, escreve <strong>{CONFIRM_WORD}</strong> no campo abaixo.
          </p>

          <label htmlFor="delete-confirm-input" className="mt-3 block text-xs font-medium text-foreground">
            Escreve {CONFIRM_WORD} para confirmar
          </label>
          <input
            id="delete-confirm-input"
            type="text"
            value={typed}
            onChange={(e) => setTyped(e.target.value)}
            disabled={busy}
            autoComplete="off"
            autoCapitalize="characters"
            spellCheck={false}
            className="mt-1 w-full rounded-md border border-border bg-background px-3 py-2 text-sm text-foreground focus:border-danger focus:outline-none focus:ring-1 focus:ring-danger disabled:opacity-60"
          />

          <div className="mt-3 flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => void handleDelete()}
              disabled={!canConfirm}
              className="inline-flex min-h-11 items-center justify-center rounded-md bg-danger px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-danger/90 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {busy ? 'A agendar…' : 'Confirmar eliminação'}
            </button>
            <button
              type="button"
              onClick={closeDialog}
              disabled={busy}
              className="inline-flex min-h-11 items-center justify-center rounded-md border border-border bg-background px-4 py-2 text-sm font-medium text-foreground transition-colors hover:bg-muted disabled:cursor-not-allowed disabled:opacity-60"
            >
              Cancelar
            </button>
          </div>

          {error && (
            <div role="alert" className="mt-3 rounded-md bg-danger-subtle px-3 py-2 text-xs text-danger">
              {error}
            </div>
          )}
        </div>
      )}
    </section>
  );
}
