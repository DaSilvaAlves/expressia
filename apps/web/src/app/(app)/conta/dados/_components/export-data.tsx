'use client';

import { useState } from 'react';

/**
 * `<ExportData>` — secção "Exportar os meus dados" da página `/conta/dados`
 * (Story 6.8 AC6). Dispara `POST /api/conta/export` (geração síncrona inline —
 * PO-D1) e apresenta o link de download quando pronto.
 *
 * Estados: idle → loading (a gerar) → ready (link + expiração) / error.
 * O caso 409 (export já em curso/disponível) é tratado com mensagem dedicada.
 *
 * Tom PT-PT estrito (CON3). Tokens do design system dark-first.
 *
 * Trace: Story 6.8 AC6; FR28; CON3.
 */

interface ReadyState {
  readonly downloadUrl: string;
  readonly expiresAt: string;
}

type State =
  | { kind: 'idle' }
  | { kind: 'loading' }
  | { kind: 'ready'; data: ReadyState }
  | { kind: 'error'; message: string };

interface InitiateResponse {
  jobId?: string;
  downloadUrl?: string;
  expiresAt?: string;
  error?: { message?: string };
}

/** Formata a data de expiração ISO em PT-PT: "DD/MM/YYYY às HH:MM". */
function formatExpiry(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  const d = String(date.getDate()).padStart(2, '0');
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const y = date.getFullYear();
  const hh = String(date.getHours()).padStart(2, '0');
  const mm = String(date.getMinutes()).padStart(2, '0');
  return `${d}/${m}/${y} às ${hh}:${mm}`;
}

export function ExportData(): React.ReactElement {
  const [state, setState] = useState<State>({ kind: 'idle' });

  async function handleExport(): Promise<void> {
    if (state.kind === 'loading') return;
    setState({ kind: 'loading' });

    try {
      const res = await fetch('/api/conta/export', { method: 'POST' });
      const body = (await res.json().catch(() => ({}))) as InitiateResponse;

      if (res.status === 409) {
        setState({
          kind: 'error',
          message:
            body.error?.message ?? 'Já tens um export em curso ou disponível para download.',
        });
        return;
      }

      if (!res.ok || !body.downloadUrl || !body.expiresAt) {
        setState({
          kind: 'error',
          message:
            body.error?.message ?? 'Não foi possível gerar a exportação. Tenta novamente.',
        });
        return;
      }

      setState({
        kind: 'ready',
        data: { downloadUrl: body.downloadUrl, expiresAt: body.expiresAt },
      });
    } catch {
      setState({
        kind: 'error',
        message: 'Erro de ligação. Verifica a tua internet e tenta novamente.',
      });
    }
  }

  return (
    <div className="rounded-lg border border-border p-4">
      <div className="space-y-1">
        <span className="block text-sm font-medium text-foreground">
          Exportar os meus dados
        </span>
        <span className="block text-xs text-muted-foreground">
          Gera um ficheiro ZIP com todos os teus dados (tarefas, finanças, família e
          preferências) em formato JSON e CSV. A geração pode demorar alguns segundos.
        </span>
      </div>

      <button
        type="button"
        onClick={() => void handleExport()}
        disabled={state.kind === 'loading'}
        className="mt-3 inline-flex min-h-11 items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-60"
      >
        {state.kind === 'loading' ? 'A gerar exportação…' : 'Exportar os meus dados'}
      </button>

      {state.kind === 'ready' && (
        <div
          role="status"
          className="mt-3 space-y-2 rounded-md bg-success-subtle px-3 py-2.5 text-xs text-success"
        >
          <p>A tua exportação está pronta.</p>
          <a
            href={state.data.downloadUrl}
            className="inline-flex min-h-11 items-center font-medium underline underline-offset-2"
            download
          >
            Descarregar ficheiro ZIP
          </a>
          <p className="text-success/80">
            Disponível até {formatExpiry(state.data.expiresAt)}.
          </p>
        </div>
      )}

      {state.kind === 'error' && (
        <div
          role="alert"
          className="mt-3 rounded-md bg-danger-subtle px-3 py-2 text-xs text-danger"
        >
          {state.message}
        </div>
      )}
    </div>
  );
}
