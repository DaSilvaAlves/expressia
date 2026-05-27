'use client';

import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';

/**
 * Operação aplicada — shape mínimo extraído do `AtomicOutcome` da Story 2.5.
 * Campos opcionais para resiliência a futuras mudanças no schema (Story 2.8+).
 */
export interface ResultOperation {
  readonly toolName?: string;
  readonly tool_name?: string;
  readonly intent?: string;
  readonly result_id?: string;
  readonly resultId?: string;
  readonly output?: unknown;
}

export interface ResultMessageProps {
  readonly runId: string;
  readonly summary: string;
  readonly results?: {
    readonly success?: boolean;
    readonly results?: readonly unknown[];
  };
  /**
   * Story 2.8 AC7 — URL do endpoint undo (`/api/agent/prompt/{runId}/undo`).
   * Quando ausente (caller pre-2.8 ou test legacy), o botão Undo não é
   * renderizado (D40 retrocompatibilidade).
   */
  readonly undoUrl?: string;
  /**
   * Story 2.8 AC7 — ISO 8601 da expiração da janela de undo (30s após exec).
   * Junto com `undoUrl` controla o countdown e o disable on-expiry.
   */
  readonly undoExpiresAt?: string;
}

type UndoStatus = 'idle' | 'loading' | 'success' | 'error';

interface BannerState {
  readonly tone: 'success' | 'warning' | 'error';
  readonly message: string;
}

/**
 * Mensagens PT-PT estritas (DN8/DN9) — nunca PT-BR.
 */
function bannerSuccess(opsCount: number): BannerState {
  return {
    tone: 'success',
    message: `Operação anulada com sucesso (${opsCount} registo(s) removido(s))`,
  };
}

const BANNER_EXPIRED: BannerState = {
  tone: 'warning',
  message: 'Já não é possível anular — a janela de 30 segundos passou',
};

const BANNER_ALREADY_REVERTED: BannerState = {
  tone: 'warning',
  message: 'Esta operação já foi anulada',
};

function bannerInvalidState(status: string): BannerState {
  return {
    tone: 'error',
    message: `Operação não pode ser anulada (estado: ${status})`,
  };
}

const BANNER_NETWORK_ERROR: BannerState = {
  tone: 'error',
  message: 'Erro temporário ao anular. Por favor recarrega a página e tenta de novo',
};

/**
 * `ResultMessage` — exibe o resultado bem-sucedido de uma run executada
 * com botão Undo funcional dentro da janela 30s (Story 2.8 AC7/AC8).
 *
 * Comportamento:
 *   - Sem `undoUrl`/`undoExpiresAt` → renderiza sem botão Undo (D40).
 *   - `now() < undoExpiresAt && status === 'idle'` → botão "Anular (Xs)" activo.
 *   - `now() >= undoExpiresAt` → botão disabled com texto "Expirou".
 *   - `status === 'loading'` → botão disabled com "A anular…".
 *   - `status === 'success'` → botão disabled terminal "Anulado ✓".
 *   - `status === 'error'` → botão disabled terminal "Erro".
 *
 * Click → POST ao endpoint `undoUrl` com tratamento de status:
 *   - 200 → banner verde
 *   - 409 (UNDO_EXPIRED/UNDO_ALREADY_REVERTED/UNDO_INVALID_STATE) → banner amarelo/vermelho
 *   - 401 → redirect /entrar
 *   - 5xx ou network error → banner vermelho
 */
export function ResultMessage({
  runId,
  summary,
  results,
  undoUrl,
  undoExpiresAt,
}: ResultMessageProps): React.ReactElement {
  const router = useRouter();
  const ops: ResultOperation[] = (results?.results ?? []).map((r) =>
    typeof r === 'object' && r !== null ? (r as ResultOperation) : {},
  );

  const hasUndo = Boolean(undoUrl && undoExpiresAt);
  const expiresAtMs = undoExpiresAt ? new Date(undoExpiresAt).getTime() : 0;

  const [status, setStatus] = useState<UndoStatus>('idle');
  const [banner, setBanner] = useState<BannerState | null>(null);
  const [remainingSec, setRemainingSec] = useState<number>(() =>
    hasUndo ? Math.max(0, Math.floor((expiresAtMs - Date.now()) / 1000)) : 0,
  );

  // Countdown — corre apenas se `status === 'idle' && hasUndo`.
  // Cleanup on unmount obrigatório (DN7 — leak risk).
  useEffect(() => {
    if (!hasUndo || status !== 'idle') return;
    const interval = setInterval(() => {
      const remaining = Math.max(0, Math.floor((expiresAtMs - Date.now()) / 1000));
      setRemainingSec(remaining);
      if (remaining <= 0) {
        clearInterval(interval);
      }
    }, 1000);
    return () => clearInterval(interval);
  }, [hasUndo, status, expiresAtMs]);

  const expired = hasUndo && remainingSec <= 0;

  const handleUndo = useCallback(async (): Promise<void> => {
    if (!undoUrl || status !== 'idle' || expired) return;
    setStatus('loading');
    setBanner(null);
    try {
      const res = await fetch(undoUrl, { method: 'POST' });
      if (res.status === 401) {
        router.push('/entrar');
        return;
      }
      if (res.status === 200) {
        const body = (await res.json().catch(() => ({}))) as { ops_count?: number };
        const opsCount = typeof body.ops_count === 'number' ? body.ops_count : 0;
        setStatus('success');
        setBanner(bannerSuccess(opsCount));
        return;
      }
      if (res.status === 409) {
        const body = (await res.json().catch(() => ({}))) as {
          error?: { code?: string; details?: { status?: string } };
        };
        const code = body.error?.code;
        setStatus('error');
        if (code === 'UNDO_EXPIRED') {
          setBanner(BANNER_EXPIRED);
        } else if (code === 'UNDO_ALREADY_REVERTED') {
          setBanner(BANNER_ALREADY_REVERTED);
        } else if (code === 'UNDO_INVALID_STATE') {
          setBanner(bannerInvalidState(body.error?.details?.status ?? 'desconhecido'));
        } else {
          setBanner(BANNER_NETWORK_ERROR);
        }
        return;
      }
      // 5xx ou outro 4xx
      setStatus('error');
      setBanner(BANNER_NETWORK_ERROR);
    } catch {
      setStatus('error');
      setBanner(BANNER_NETWORK_ERROR);
    }
  }, [undoUrl, status, expired, router]);

  const undoButtonLabel = (() => {
    if (status === 'loading') return 'A anular…';
    if (status === 'success') return 'Anulado ✓';
    if (status === 'error') return 'Erro';
    if (expired) return 'Expirou';
    return `Anular (${remainingSec}s)`;
  })();

  const undoButtonDisabled = status !== 'idle' || expired;

  return (
    <div
      role="region"
      aria-label="Resultado da operação"
      className="rounded-lg border border-green-200 bg-green-50 p-4 dark:border-green-900/40 dark:bg-green-950/30"
    >
      <div className="flex items-start justify-between gap-3">
        <h2 className="text-base font-semibold text-green-900 dark:text-green-100">
          Feito ✓
        </h2>
        {hasUndo && (
          <button
            type="button"
            onClick={handleUndo}
            disabled={undoButtonDisabled}
            aria-label={`Anular operação ${runId}`}
            className="rounded-md border border-black/10 bg-white px-2 py-1 text-xs hover:bg-neutral-50 disabled:cursor-not-allowed disabled:opacity-50 dark:border-white/10 dark:bg-neutral-900 dark:hover:bg-neutral-800"
          >
            {undoButtonLabel}
          </button>
        )}
      </div>

      <p className="mt-2 text-sm text-green-900 dark:text-green-100">{summary}</p>

      {ops.length > 0 && (
        <ul className="mt-3 space-y-1 text-xs text-neutral-700 dark:text-neutral-200">
          {ops.map((op, i) => {
            const tool = op.tool_name ?? op.toolName ?? 'tool';
            const intent = op.intent ? ` (${op.intent})` : '';
            const id = op.result_id ?? op.resultId;
            return (
              <li key={i} className="font-mono">
                • {tool}
                {intent}
                {id ? ` → ${id}` : ''}
              </li>
            );
          })}
        </ul>
      )}

      {banner && (
        <div
          role="alert"
          className={`mt-3 rounded-md border px-3 py-2 text-xs ${
            banner.tone === 'success'
              ? 'border-green-300 bg-green-100 text-green-900 dark:border-green-800 dark:bg-green-900/40 dark:text-green-100'
              : banner.tone === 'warning'
                ? 'border-yellow-300 bg-yellow-100 text-yellow-900 dark:border-yellow-800 dark:bg-yellow-900/40 dark:text-yellow-100'
                : 'border-red-300 bg-red-100 text-red-900 dark:border-red-800 dark:bg-red-900/40 dark:text-red-100'
          }`}
        >
          {banner.message}
        </div>
      )}

      <div className="mt-3 text-[10px] font-mono text-muted-foreground">run: {runId}</div>
    </div>
  );
}
