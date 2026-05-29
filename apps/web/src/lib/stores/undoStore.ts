/**
 * `undoStore` — token de undo global activo (Story 5.9 AC1 — DP-5.9.A).
 *
 * Zustand store **sem middleware `persist`** — os tokens de undo expiram em 30s
 * (Story 2.8: `expires_at = now() + 30s`), pelo que persistir em `localStorage`
 * seria inútil (TTL curto) e um risco de segurança (token expirado retido).
 *
 * **Fonte de alimentação:** o `<UndoToastBridge>` (AC2) subscreve o `chatStore`
 * e chama `setUndo()` sempre que chega uma `AgentResultMessage` com `undoUrl`.
 * O `<UndoToast>` (AC3) lê o estado e executa `clearUndo()` em handlers.
 *
 * **R-5.9 (Epic 5 §6):** `setUndo` substitui SEMPRE o token anterior — não há
 * stack. Quando T2 chega antes de T1 expirar, T1 é descartado silenciosamente
 * (a acção anterior continua acessível no histórico do chat via `ResultMessage`).
 *
 * **SSR-safety (lição FIX-1 da 5.7):** este store é um singleton de módulo e
 * **nunca é mutado no servidor** — toda a escrita acontece no `<UndoToastBridge>`
 * dentro de um `useEffect` (client-only) ou em handlers de evento do `<UndoToast>`.
 * NÃO há hidratação no corpo de render de Client Component. Este ficheiro não
 * importa `useEffect` — a lógica de hidratação vive fora do store.
 *
 * Trace: Story 5.9 AC1/AC2/AC3; DP-5.9.A; Epic 5 §6 R-5.9; precedente
 * `widgetConfigStore`/`chatStore` (Zustand sem persist, SSR-safe).
 */
import { create } from 'zustand';

/** Estado do token de undo activo (efémero — não persistido). */
interface UndoEphemeralState {
  /** Endpoint do último undo activo (`/api/agent/prompt/{runId}/undo`). `null` = sem toast. */
  undoUrl: string | null;
  /** ISO 8601 da expiração (30s após exec). `null` = sem toast. */
  expiresAt: string | null;
}

/** Acções expostas pelo store. */
export interface UndoActions {
  /** Define o token activo — substitui o anterior (R-5.9: T2 substitui T1). */
  setUndo: (url: string, expiresAt: string) => void;
  /** Limpa o token activo (pós-undo executado ou expiração). */
  clearUndo: () => void;
}

interface UndoState extends UndoEphemeralState, UndoActions {}

/** Defaults — sem token activo. */
const DEFAULT_STATE: UndoEphemeralState = {
  undoUrl: null,
  expiresAt: null,
};

/**
 * Store principal — exportado para test setup / subscribe directo. Consumidores
 * normais usam os selectores tipados abaixo.
 */
export const useUndoStore = create<UndoState>()((set) => ({
  ...DEFAULT_STATE,
  setUndo: (url, expiresAt) => set({ undoUrl: url, expiresAt }),
  clearUndo: () => set({ ...DEFAULT_STATE }),
}));

// ───────────────────────────────────────────────────────────────────────────
// Selectores tipados — minimizar re-renders
// ───────────────────────────────────────────────────────────────────────────

/** Lê `undoUrl`. `null` quando não há token activo. */
export function useUndoUrl(): string | null {
  return useUndoStore((s) => s.undoUrl);
}

/** Lê `expiresAt`. `null` quando não há token activo. */
export function useUndoExpiresAt(): string | null {
  return useUndoStore((s) => s.expiresAt);
}

/** Acções (estabilidade referencial garantida pelo Zustand). */
export function useUndoActions(): UndoActions {
  const setUndo = useUndoStore((s) => s.setUndo);
  const clearUndo = useUndoStore((s) => s.clearUndo);
  return { setUndo, clearUndo };
}
