/**
 * `chatStore` — estado partilhado do chat AI multi-intent (Story 5.4 AC2).
 *
 * Zustand store **sem middleware `persist`** — mensagens são in-memory por
 * sessão (DP-5.4.F). Re-load do browser reinicia o histórico, alinhado com
 * comportamento Story 2.7 actual + privacy concern (prompts plaintext no
 * localStorage seriam risco GDPR antes de existir schema `chat_history` no
 * server).
 *
 * **Trace:**
 *   - `architecture.md §8.3 linha 711-712` — "UI ephemeral (modals, sidebar
 *     collapse, theme) | Zustand | Persist em localStorage"; chat messages
 *     são session-bound (não persistem cross-session conscientemente).
 *   - `architecture.md §8.4 linha 727` — "apps/web/src/components/chat/ #
 *     ChatPanel, MessageList, PreviewCard, UndoToast".
 *   - Story 5.3 `shellStore` pattern testado (217 linhas, 7 selectores
 *     tipados) — reutilizado aqui com adaptação (sem `persist`).
 *
 * **R-5.6 mitigado:** Pattern unidireccional — `<ChatPanel mode="fullscreen">`
 * em `/jarvis` E `<ChatPanel mode="panel">` no shell consomem o **MESMO** store.
 * Enviar prompt no panel da `/visao`, navegar para `/jarvis`, ver mensagem.
 *
 * **DP-5.4.E:** Sem `useChatHydrated()` análogo ao `shellStore` Story 5.3 —
 * `chatStore` não usa `persist`, defaults são determinísticos, zero hydration
 * mismatch SSR↔CSR possível.
 */
import { create } from 'zustand';

/**
 * Mensagem do utilizador no chat — discriminated union (Story 2.7 preservado
 * byte-a-byte de `jarvis-chat.tsx:16-20`).
 */
export interface UserMessage {
  readonly kind: 'user';
  readonly id: string;
  readonly text: string;
}

/**
 * Mensagem de resultado do agente — inclui campos undo do Story 2.8.
 * Preservado byte-a-byte de `jarvis-chat.tsx:22-32`.
 */
export interface AgentResultMessage {
  readonly kind: 'result';
  readonly id: string;
  readonly runId: string;
  readonly summary: string;
  readonly results?: { success?: boolean; results?: unknown[] };
  /** Story 2.8 — URL do endpoint undo. */
  readonly undoUrl?: string;
  /** Story 2.8 — ISO 8601 da expiração undo (30s após exec). */
  readonly undoExpiresAt?: string;
}

/**
 * Mensagem de erro do agente — texto PT-PT amigável via `errorMessageFor`.
 * Preservado byte-a-byte de `jarvis-chat.tsx:34-38`.
 */
export interface AgentErrorMessage {
  readonly kind: 'error';
  readonly id: string;
  readonly text: string;
}

/**
 * União discriminada de todas as mensagens do chat.
 * Preservado byte-a-byte de `jarvis-chat.tsx:40`.
 */
export type ChatMessage = UserMessage | AgentResultMessage | AgentErrorMessage;

/**
 * Estado da `PreviewCard` quando o agente devolve `mode: 'preview'`
 * (confidence < 0.70 ou acção destrutiva — FR4). Preservado byte-a-byte de
 * `jarvis-chat.tsx:42-47`.
 */
export interface PreviewState {
  readonly runId: string;
  readonly planSummary: readonly string[];
  readonly confidence: number;
  readonly expiresAt: string;
}

/**
 * Estado efémero do chat — `messages`, `preview`, `loading`. NÃO persistido.
 */
interface ChatEphemeralState {
  messages: readonly ChatMessage[];
  preview: PreviewState | null;
  loading: boolean;
}

/**
 * Acções expostas pelo store.
 */
export interface ChatActions {
  /** Adiciona mensagem ao final do array `messages`. */
  appendMessage: (msg: ChatMessage) => void;
  /** Limpa apenas o array `messages` (preserva preview/loading). */
  clearMessages: () => void;
  /** Define ou limpa o estado da `PreviewCard`. */
  setPreview: (preview: PreviewState | null) => void;
  /** Toggle loading state durante fetch. */
  setLoading: (loading: boolean) => void;
  /** Reset completo — limpa messages + preview + loading. */
  resetChat: () => void;
}

/**
 * Estado completo do store (efémero + actions).
 */
interface ChatState extends ChatEphemeralState, ChatActions {}

/**
 * Defaults — mensagens vazias, sem preview, sem loading.
 */
const DEFAULT_STATE: ChatEphemeralState = {
  messages: [],
  preview: null,
  loading: false,
};

/**
 * Store principal — exportado para casos avançados (subscribe directo,
 * test setup). Consumidores normais devem usar os selectores tipados abaixo.
 */
export const useChatStore = create<ChatState>()((set) => ({
  ...DEFAULT_STATE,
  appendMessage: (msg) =>
    set((state) => ({ messages: [...state.messages, msg] })),
  clearMessages: () => set({ messages: [] }),
  setPreview: (preview) => set({ preview }),
  setLoading: (loading) => set({ loading }),
  resetChat: () => set({ ...DEFAULT_STATE }),
}));

// ───────────────────────────────────────────────────────────────────────────
// Selectores tipados — minimizar re-renders dos consumidores
// ───────────────────────────────────────────────────────────────────────────

/**
 * Lê `messages`. Re-renderiza apenas quando o array muda.
 */
export function useChatMessages(): readonly ChatMessage[] {
  return useChatStore((state) => state.messages);
}

/**
 * Lê `preview`. Re-renderiza apenas quando muda.
 */
export function useChatPreview(): PreviewState | null {
  return useChatStore((state) => state.preview);
}

/**
 * Lê `loading`. Re-renderiza apenas quando a flag muda.
 */
export function useChatLoading(): boolean {
  return useChatStore((state) => state.loading);
}

/**
 * Bundle das acções comuns. Cada action é seleccionada individualmente —
 * Zustand garante estabilidade referencial das funções definidas no `create()`.
 */
export function useChatActions(): ChatActions {
  const appendMessage = useChatStore((state) => state.appendMessage);
  const clearMessages = useChatStore((state) => state.clearMessages);
  const setPreview = useChatStore((state) => state.setPreview);
  const setLoading = useChatStore((state) => state.setLoading);
  const resetChat = useChatStore((state) => state.resetChat);
  return {
    appendMessage,
    clearMessages,
    setPreview,
    setLoading,
    resetChat,
  };
}

/**
 * Gera ID determinístico-suficiente para keys de mensagens (não criptográfico).
 * Preservado byte-a-byte de `jarvis-chat.tsx:70-73` — D-5.4.2 move para o store
 * porque é utility ligada ao contexto de criar `ChatMessage`.
 */
export function makeMessageId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}
