'use client';

/**
 * `ChatPanel` — chat AI multi-intent agnóstico de rota (Story 5.4 AC1).
 *
 * Extracção de `<JarvisChat>` Story 2.7 (267 linhas) — lógica preservada
 * byte-a-byte, estado migrado de `useState` local para `chatStore` Zustand
 * partilhado (`apps/web/src/lib/stores/chatStore.ts`). R-5.6 do Epic 5
 * mitigado: enviar prompt no panel da `/visao`, navegar para `/jarvis`,
 * ver mensagem em ambos os modes — mesmo store.
 *
 * **Prop `mode: 'panel' | 'fullscreen'`** (DP-5.4.D — KISS vs 2 componentes
 * irmãos; 95% lógica idêntica):
 *   - **`fullscreen`**: rota dedicada `/jarvis`. Outer `space-y-4`. Sem
 *     scrollable container interno (assume container pai dá o frame).
 *   - **`panel`**: collapsible 400px em desktop, overlay full-screen em
 *     tablet/mobile (montado em `ChatPanelSlot.tsx` Story 5.3 nos dois
 *     `data-slot` divs). Outer `h-full` + scrollable interno via
 *     `overflow-y-auto` para fitting em 400px width.
 *
 * **DP-5.4.G:** label sidebar mostra "Chat" mas URL é `/jarvis` —
 * divergência consciente (carry-over Story 5.3 DP-5.3.D); `metadata.title`
 * em `jarvis/page.tsx` mantém "Jarvis — Expressia".
 *
 * **Endpoint inalterado** (Story 2.7 contract preservado): `POST
 * /api/agent/prompt` com `{ prompt }` body. Branching `mode: 'executed' |
 * 'preview'` + error handling 401 redirect / 4xx PT-PT via `errorMessageFor`
 * / 5xx Sentry capture preservados byte-a-byte.
 *
 * **Vercel AI SDK `useChat` carry-over (CO-1):** architecture.md §8.3 linha
 * 711 prescreve `useChat` para chat streaming; Story 2.7 não adoptou (fetch
 * directo). Esta story preserva o pattern fetch directo intencionalmente
 * (refactor cirúrgico). Re-avaliação Fase 2 em story dedicada se houver
 * real streaming SSE.
 *
 * Tom PT-PT estrito (CON3): nunca PT-BR.
 *
 * Trace: Epic 5 §3 IN bullet 5 (chat panel persistente) + §8 DP8;
 * architecture.md §8.4 linha 727; front-end-spec §5.5; Story 5.3 D-5.3.4 +
 * DP-5.3.D (precedentes).
 */
import { useCallback } from 'react';
import { useRouter } from 'next/navigation';

import { captureException } from '@sentry/nextjs';

import { ChatInput } from '@/components/chat/ChatInput';
import {
  errorMessageFor,
  type ErrorDetails,
} from '@/components/chat/error-messages';
import { PreviewCard, type ConfirmPayload } from '@/components/chat/PreviewCard';
import { ResultMessage } from '@/components/chat/ResultMessage';
import {
  makeMessageId,
  useChatActions,
  useChatLoading,
  useChatMessages,
  useChatPreview,
} from '@/lib/stores/chatStore';

/**
 * Resposta `executed` do endpoint `/api/agent/prompt`. Preservada byte-a-byte
 * de `jarvis-chat.tsx:49-58`.
 */
interface PromptResponseExecuted {
  readonly mode: 'executed';
  readonly run_id: string;
  readonly summary: string;
  readonly results: { success?: boolean; results?: unknown[] };
  /** Story 2.8 — URL do endpoint undo (sempre presente em executed branch). */
  readonly undo_url: string;
  /** Story 2.8 — ISO 8601 da expiração undo (30s — FR6). */
  readonly undo_expires_at: string;
}

/**
 * Resposta `preview` do endpoint `/api/agent/prompt`. Preservada byte-a-byte
 * de `jarvis-chat.tsx:60-66`.
 */
interface PromptResponsePreview {
  readonly mode: 'preview';
  readonly run_id: string;
  readonly plan_summary: string[];
  readonly confidence: number;
  readonly expires_at: string;
}

type PromptResponse = PromptResponseExecuted | PromptResponsePreview;

/**
 * Props públicas do `<ChatPanel>`.
 */
export interface ChatPanelProps {
  /** Variante de styling: `panel` (collapsible 400px) ou `fullscreen` (rota `/jarvis`). */
  readonly mode: 'panel' | 'fullscreen';
}

export function ChatPanel({ mode }: ChatPanelProps): React.ReactElement {
  const router = useRouter();
  const messages = useChatMessages();
  const preview = useChatPreview();
  const loading = useChatLoading();
  const { appendMessage, setPreview, setLoading } = useChatActions();

  const handleSubmit = useCallback(
    async (prompt: string): Promise<void> => {
      // Limpa preview anterior se existir (UX: novo prompt = novo contexto).
      // Preservado byte-a-byte de jarvis-chat.tsx:102.
      setPreview(null);
      appendMessage({ kind: 'user', id: makeMessageId(), text: prompt });
      setLoading(true);

      try {
        const res = await fetch('/api/agent/prompt', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ prompt }),
        });

        if (res.status === 401) {
          // Redirect para login (Story 1.5 pattern — middleware faria isto
          // num server-side request; em client após render há que redirect
          // manual).
          router.push('/entrar');
          return;
        }

        if (!res.ok) {
          // Qualquer 4xx/5xx (excepto 401, tratado acima). O `error.code` decide
          // a mensagem PT-PT amigável via `errorMessageFor`; o `error.message`
          // técnico do servidor NUNCA é renderizado — em 5xx vai para Sentry.
          // Cobre 429 (RATE_LIMIT_EXCEEDED + QUOTA_EXCEEDED distinguidos por code).
          // Trace: docs/ux/jarvis-error-ux-spec.md.
          const body = (await res.json().catch(() => ({}))) as {
            error?: { code?: string; message?: string; details?: ErrorDetails };
          };
          if (res.status >= 500) {
            captureException(
              new Error(body.error?.message ?? `Jarvis prompt failed (HTTP ${res.status})`),
              {
                tags: { 'http.route': '/api/agent/prompt' },
                extra: { http_status: res.status, error_code: body.error?.code ?? 'UNKNOWN' },
              },
            );
          }
          appendMessage({
            kind: 'error',
            id: makeMessageId(),
            text: errorMessageFor(body.error?.code, body.error?.details),
          });
          return;
        }

        const data = (await res.json()) as PromptResponse;

        if (data.mode === 'preview') {
          setPreview({
            runId: data.run_id,
            planSummary: [...data.plan_summary],
            confidence: data.confidence,
            expiresAt: data.expires_at,
          });
        } else {
          appendMessage({
            kind: 'result',
            id: makeMessageId(),
            runId: data.run_id,
            summary: data.summary,
            results: data.results,
            undoUrl: data.undo_url,
            undoExpiresAt: data.undo_expires_at,
          });
        }
      } catch {
        appendMessage({
          kind: 'error',
          id: makeMessageId(),
          text: 'Erro temporário. Tenta de novo.',
        });
      } finally {
        setLoading(false);
      }
    },
    [appendMessage, router, setLoading, setPreview],
  );

  const handleConfirmResult = useCallback(
    (payload: ConfirmPayload) => {
      if (!preview) return;
      const typed = payload.results as
        | { success?: boolean; results?: unknown[] }
        | undefined;
      const opCount = typed?.results?.length ?? 0;
      const summary =
        opCount > 0
          ? `Executei ${opCount} operação(ões) com sucesso. Tens 30 segundos para reverter.`
          : 'Pedido confirmado.';
      appendMessage({
        kind: 'result',
        id: makeMessageId(),
        runId: preview.runId,
        summary,
        results: typed,
        undoUrl: payload.undoUrl,
        undoExpiresAt: payload.undoExpiresAt,
      });
      setPreview(null);
    },
    [appendMessage, preview, setPreview],
  );

  const handleCancelPreview = useCallback(() => {
    setPreview(null);
  }, [setPreview]);

  // Styling adaptativo por mode (DP-5.4.D).
  // - fullscreen: outer space-y-4 (pattern original Story 2.7)
  // - panel: outer h-full overflow-y-auto + space-y-3 (scrollable em 400px)
  const outerClassName =
    mode === 'fullscreen'
      ? 'space-y-4'
      : 'flex h-full flex-col space-y-3 overflow-y-auto';

  const messagesContainerClassName =
    mode === 'fullscreen' ? 'space-y-3' : 'space-y-2';

  return (
    <div className={outerClassName}>
      <div className={messagesContainerClassName} aria-live="polite">
        {messages.map((m) => {
          if (m.kind === 'user') {
            return (
              <div
                key={m.id}
                className="rounded-lg border border-black/10 bg-neutral-50 p-3 text-sm dark:border-white/10 dark:bg-neutral-800"
              >
                <div className="text-xs font-medium text-muted-foreground">Tu</div>
                <div className="mt-1 whitespace-pre-wrap">{m.text}</div>
              </div>
            );
          }
          if (m.kind === 'result') {
            return (
              <ResultMessage
                key={m.id}
                runId={m.runId}
                summary={m.summary}
                results={m.results}
                undoUrl={m.undoUrl}
                undoExpiresAt={m.undoExpiresAt}
              />
            );
          }
          return (
            <div
              key={m.id}
              role="alert"
              className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800 dark:border-red-900/40 dark:bg-red-950/30 dark:text-red-200"
            >
              {m.text}
            </div>
          );
        })}

        {preview && (
          <PreviewCard
            runId={preview.runId}
            planSummary={preview.planSummary}
            confidence={preview.confidence}
            expiresAt={preview.expiresAt}
            onConfirm={handleConfirmResult}
            onCancel={handleCancelPreview}
          />
        )}
      </div>

      {loading && (
        <div className="text-xs text-muted-foreground" aria-live="polite">
          A pensar…
        </div>
      )}

      <ChatInput onSubmit={handleSubmit} disabled={loading} />
    </div>
  );
}
