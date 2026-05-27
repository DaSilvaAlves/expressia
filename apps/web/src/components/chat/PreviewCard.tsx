'use client';

import { useEffect, useState } from 'react';

/**
 * Props da `PreviewCard` — corresponde ao shape de resposta `mode='preview'`
 * do `POST /api/agent/prompt` (Story 2.6 D21+DOC-FIX-001 + Story 2.7 v1.1).
 *
 * `expiresAt` é ISO 8601 (5min TTL — Story 2.6 D20). Countdown calcula em
 * tempo real a partir desta string.
 *
 * Story 2.8 PO_FIX_INLINE 2 — `onConfirm` alargou o shape para propagar
 * também `undoUrl` + `undoExpiresAt` da response do confirm endpoint
 * (`/api/agent/prompt/{runId}/confirm` retorna ambos os campos per
 * confirm/route.ts:295-303). Antes (Story 2.7) `onConfirm(data.results)`
 * DESCARTAVA estes campos, impedindo o flow Undo via branch preview.
 */
export interface ConfirmPayload {
  readonly results: unknown;
  readonly undoUrl?: string;
  readonly undoExpiresAt?: string;
}

export interface PreviewCardProps {
  readonly runId: string;
  readonly planSummary: readonly string[];
  readonly confidence: number;
  readonly expiresAt: string;
  readonly onConfirm: (payload: ConfirmPayload) => void;
  readonly onCancel: () => void;
}

/**
 * Cor do badge de confidence — vermelho < 0.70, amarelo < 0.85, verde ≥ 0.85.
 */
function confidenceColorClass(confidence: number): string {
  if (confidence < 0.7) return 'bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-200';
  if (confidence < 0.85) return 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900/40 dark:text-yellow-200';
  return 'bg-green-100 text-green-800 dark:bg-green-900/40 dark:text-green-200';
}

/**
 * Formata segundos como `M:SS` (ex: `4:23`).
 */
function formatCountdown(secondsRemaining: number): string {
  if (secondsRemaining <= 0) return 'Expirado';
  const m = Math.floor(secondsRemaining / 60);
  const s = secondsRemaining % 60;
  return `${m}:${s.toString().padStart(2, '0')}`;
}

/**
 * `PreviewCard` — UI do branch preview-then-confirm (FR4).
 *
 * Story 2.7 AC8 — renderiza:
 *   - Título "Vais fazer:"
 *   - Lista de `planSummary` (uma string por linha — formato Story 2.6:
 *     "intent (XX%)")
 *   - Badge de confidence cor-codificada
 *   - Countdown timer 5min (re-render por segundo via setInterval)
 *   - Botões Confirmar / Cancelar
 *
 * Confirmar dispara `POST /api/agent/prompt/{runId}/confirm` e chama
 * `onConfirm` com `outcome.results`. Cancelar limpa local state via
 * `onCancel` (Story 2.8 endereça persistência — comentado no story).
 *
 * Disable do botão Confirmar quando `now() >= expiresAt` ou loading.
 */
export function PreviewCard({
  runId,
  planSummary,
  confidence,
  expiresAt,
  onConfirm,
  onCancel,
}: PreviewCardProps): React.ReactElement {
  const expiresAtMs = new Date(expiresAt).getTime();
  const [secondsRemaining, setSecondsRemaining] = useState<number>(() =>
    Math.max(0, Math.floor((expiresAtMs - Date.now()) / 1000)),
  );
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const interval = setInterval(() => {
      const remaining = Math.max(0, Math.floor((expiresAtMs - Date.now()) / 1000));
      setSecondsRemaining(remaining);
      if (remaining <= 0) {
        clearInterval(interval);
      }
    }, 1000);
    return () => clearInterval(interval);
  }, [expiresAtMs]);

  const expired = secondsRemaining <= 0;
  const confidencePct = Math.round(confidence * 100);

  async function handleConfirm(): Promise<void> {
    if (expired || loading) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/agent/prompt/${runId}/confirm`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: { message?: string } };
        setError(body.error?.message ?? 'Erro ao confirmar. Tenta de novo.');
        return;
      }
      const data = (await res.json()) as {
        results?: unknown;
        undo_url?: string;
        undo_expires_at?: string;
      };
      onConfirm({
        results: data.results,
        undoUrl: data.undo_url,
        undoExpiresAt: data.undo_expires_at,
      });
    } catch {
      setError('Erro temporário. Tenta de novo.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div
      role="region"
      aria-label="Pré-visualização de operações"
      className="rounded-lg border border-black/15 bg-white p-4 shadow-sm dark:border-white/15 dark:bg-neutral-900"
    >
      <div className="flex items-start justify-between gap-3">
        <h2 className="text-base font-semibold">Vais fazer:</h2>
        <span
          className={`rounded-full px-2 py-0.5 text-xs font-medium ${confidenceColorClass(confidence)}`}
          aria-label={`Confiança: ${confidencePct}%`}
        >
          {confidencePct}%
        </span>
      </div>

      <ul className="mt-3 space-y-1 text-sm">
        {planSummary.map((line, i) => (
          <li key={i} className="text-neutral-700 dark:text-neutral-200">
            • {line}
          </li>
        ))}
      </ul>

      <div className="mt-3 text-xs text-muted-foreground" aria-live="polite">
        {expired ? 'Janela de confirmação expirou.' : `Expira em ${formatCountdown(secondsRemaining)}`}
      </div>

      {error && (
        <div role="alert" className="mt-2 text-xs text-red-600 dark:text-red-400">
          {error}
        </div>
      )}

      <div className="mt-4 flex justify-end gap-2">
        <button
          type="button"
          onClick={onCancel}
          disabled={loading}
          className="rounded-md border border-black/15 px-3 py-1.5 text-sm hover:bg-neutral-50 disabled:cursor-not-allowed disabled:opacity-50 dark:border-white/15 dark:hover:bg-neutral-800"
        >
          Cancelar
        </button>
        <button
          type="button"
          onClick={handleConfirm}
          disabled={expired || loading}
          className="rounded-md bg-blue-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {loading ? 'A confirmar…' : 'Confirmar'}
        </button>
      </div>
    </div>
  );
}
