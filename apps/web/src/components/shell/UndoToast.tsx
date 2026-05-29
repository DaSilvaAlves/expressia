'use client';

/**
 * `<UndoToast>` — toast de undo GLOBAL, visível em qualquer rota (Story 5.9 AC3,
 * DP-5.9.E). Montado no `AppShell` ao nível do shell (fora dos painéis). Lê o
 * `undoStore` (alimentado pelo `<UndoToastBridge>`) e mostra um botão "Anular
 * (Xs)" com countdown em tempo real.
 *
 * Comportamento (reutiliza o padrão de `ResultMessage.tsx` — countdown +
 * POST `/undo` + microcopy PT-PT, mas é um componente distinto: `ResultMessage`
 * é o registo histórico no chat; este é o feedback temporário global):
 *   - `undoUrl === null` → não renderiza nada.
 *   - idle: "Anular (Xs)" activo; ao chegar a 0s → `clearUndo()` (auto-dismiss).
 *   - clique → POST `undoUrl`: 200 → "Anulado ✓" (2s, depois some); 409 (expirado/
 *     já anulado) → some; 401 → redirect `/entrar`; outro erro → "Erro ao anular".
 *
 * **R-5.9:** quando um novo token chega (T2 substitui T1 no `undoStore`), o
 * `status` reinicia para `idle` e o countdown recomeça.
 *
 * **SSR-safety (FIX-1 da 5.7):** mutação do store (`clearUndo`) só em `useEffect`/
 * handlers — nunca no corpo do render. Posição `fixed bottom-center` para não
 * colidir com o FAB do chat (bottom-right em mobile — Story 5.4).
 *
 * **A11y:** `role="status"` + `aria-live="polite"` (não é erro → não `alert`);
 * botão com `aria-label` explícito, foco visível, navegável por teclado.
 *
 * Trace: Story 5.9 AC3/AC8; DP-5.9.E; precedente `ResultMessage.tsx:119-129`.
 */
import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';

import { useUndoActions, useUndoExpiresAt, useUndoUrl } from '@/lib/stores/undoStore';

type UndoStatus = 'idle' | 'loading' | 'success' | 'error';

export function UndoToast(): React.ReactElement | null {
  const router = useRouter();
  const undoUrl = useUndoUrl();
  const expiresAt = useUndoExpiresAt();
  const { clearUndo } = useUndoActions();

  const [status, setStatus] = useState<UndoStatus>('idle');
  const [remainingSec, setRemainingSec] = useState<number>(0);

  const expiresAtMs = expiresAt ? new Date(expiresAt).getTime() : 0;

  // Novo token (T2 substitui T1 — R-5.9) → reinicia o status para idle.
  useEffect(() => {
    if (undoUrl) setStatus('idle');
  }, [undoUrl, expiresAt]);

  // Countdown — corre só quando idle + token activo. Ao chegar a 0 → auto-dismiss.
  // Cleanup obrigatório no unmount (leak risk — precedente ResultMessage DN7).
  useEffect(() => {
    if (!undoUrl || status !== 'idle') return;
    const tick = (): void => {
      const remaining = Math.max(0, Math.floor((expiresAtMs - Date.now()) / 1000));
      setRemainingSec(remaining);
      if (remaining <= 0) clearUndo();
    };
    tick();
    const interval = setInterval(tick, 1000);
    return () => clearInterval(interval);
  }, [undoUrl, status, expiresAtMs, clearUndo]);

  // Estado terminal (success/error) → some após 2s.
  useEffect(() => {
    if (status !== 'success' && status !== 'error') return;
    const t = setTimeout(() => clearUndo(), 2000);
    return () => clearTimeout(t);
  }, [status, clearUndo]);

  const handleUndo = useCallback(async (): Promise<void> => {
    if (!undoUrl || status !== 'idle') return;
    setStatus('loading');
    try {
      const res = await fetch(undoUrl, { method: 'POST' });
      if (res.status === 401) {
        router.push('/entrar');
        return;
      }
      if (res.status === 200) {
        setStatus('success');
        return;
      }
      if (res.status === 409) {
        // Expirado / já anulado — fecha sem ruído.
        clearUndo();
        return;
      }
      setStatus('error');
    } catch {
      setStatus('error');
    }
  }, [undoUrl, status, router, clearUndo]);

  if (!undoUrl) return null;

  const containerClass =
    'fixed bottom-4 left-1/2 z-50 flex -translate-x-1/2 items-center gap-3 rounded-lg border border-black/10 bg-white px-4 py-3 text-sm shadow-lg dark:border-white/10 dark:bg-neutral-900';

  // Estados terminais: só mensagem (sem botão).
  if (status === 'success') {
    return (
      <div role="status" aria-live="polite" className={containerClass}>
        <span className="text-green-700 dark:text-green-300">Anulado ✓</span>
      </div>
    );
  }
  if (status === 'error') {
    return (
      <div role="status" aria-live="polite" className={containerClass}>
        <span className="text-red-700 dark:text-red-300">Erro ao anular</span>
      </div>
    );
  }

  // idle / loading → botão de acção.
  const label = status === 'loading' ? 'A anular…' : `Anular (${remainingSec}s)`;
  return (
    <div role="status" aria-live="polite" className={containerClass}>
      <span className="text-neutral-700 dark:text-neutral-200">Acção executada.</span>
      <button
        type="button"
        onClick={handleUndo}
        disabled={status !== 'idle'}
        aria-label="Anular última acção do agente"
        className="rounded-md border border-black/15 bg-white px-3 py-1.5 text-xs font-medium hover:bg-neutral-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 disabled:cursor-not-allowed disabled:opacity-50 dark:border-white/15 dark:bg-neutral-800 dark:hover:bg-neutral-700"
      >
        {label}
      </button>
    </div>
  );
}
