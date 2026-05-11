'use client';

import { useCallback, useState } from 'react';
import { useRouter } from 'next/navigation';

import { ChatInput } from '@/app/(app)/jarvis/_components/chat-input';
import { PreviewCard, type ConfirmPayload } from '@/app/(app)/jarvis/_components/preview-card';
import { ResultMessage } from '@/app/(app)/jarvis/_components/result-message';

interface UserMessage {
  readonly kind: 'user';
  readonly id: string;
  readonly text: string;
}

interface AgentResultMessage {
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

interface AgentErrorMessage {
  readonly kind: 'error';
  readonly id: string;
  readonly text: string;
}

type ChatMessage = UserMessage | AgentResultMessage | AgentErrorMessage;

interface PreviewState {
  readonly runId: string;
  readonly planSummary: string[];
  readonly confidence: number;
  readonly expiresAt: string;
}

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

interface PromptResponsePreview {
  readonly mode: 'preview';
  readonly run_id: string;
  readonly plan_summary: string[];
  readonly confidence: number;
  readonly expires_at: string;
}

type PromptResponse = PromptResponseExecuted | PromptResponsePreview;

function makeId(): string {
  // Determinístico-suficiente para keys; não criptográfico.
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

/**
 * `JarvisChat` — orquestrador do chat /jarvis (Story 2.7 AC6-AC9).
 *
 * Responsabilidades:
 *   - Mantém histórico `messages` (user prompts + agent results/errors).
 *   - Submete `POST /api/agent/prompt` e despacha branching `mode`:
 *     'executed' → ResultMessage; 'preview' → PreviewCard.
 *   - Trata erros HTTP: 401 → redirect /entrar; 429 → mensagem PT-PT
 *     com retry; 5xx → mensagem genérica + Sentry capture client-side.
 *   - PreviewCard chama `handleConfirmResult` quando user confirma; recebe
 *     `outcome.results` da response do confirm e renderiza ResultMessage.
 *
 * Tom PT-PT estrito: nunca PT-BR.
 */
export function JarvisChat(): React.ReactElement {
  const router = useRouter();
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [loading, setLoading] = useState(false);
  const [preview, setPreview] = useState<PreviewState | null>(null);

  const appendMessage = useCallback((msg: ChatMessage) => {
    setMessages((prev) => [...prev, msg]);
  }, []);

  const handleSubmit = useCallback(
    async (prompt: string): Promise<void> => {
      // Limpa preview anterior se existir (UX: novo prompt = novo contexto).
      setPreview(null);
      appendMessage({ kind: 'user', id: makeId(), text: prompt });
      setLoading(true);

      try {
        const res = await fetch('/api/agent/prompt', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ prompt }),
        });

        if (res.status === 401) {
          // Redirect para login (Story 1.5 pattern — middleware faria isto
          // num server-side request; em client após render há que redirect manual).
          router.push('/entrar');
          return;
        }

        if (res.status === 429) {
          const body = (await res.json().catch(() => ({}))) as {
            error?: { details?: { retry_after_seconds?: number } };
          };
          const retry = body.error?.details?.retry_after_seconds ?? 60;
          appendMessage({
            kind: 'error',
            id: makeId(),
            text: `Excedeste o limite. Tenta de novo em ${retry} segundos.`,
          });
          return;
        }

        if (!res.ok) {
          // 4xx (não 401/429) ou 5xx — mensagem PT-PT genérica.
          const body = (await res.json().catch(() => ({}))) as { error?: { message?: string } };
          appendMessage({
            kind: 'error',
            id: makeId(),
            text: body.error?.message ?? 'Erro temporário. Tenta de novo.',
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
            id: makeId(),
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
          id: makeId(),
          text: 'Erro temporário. Tenta de novo.',
        });
      } finally {
        setLoading(false);
      }
    },
    [appendMessage, router],
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
        id: makeId(),
        runId: preview.runId,
        summary,
        results: typed,
        undoUrl: payload.undoUrl,
        undoExpiresAt: payload.undoExpiresAt,
      });
      setPreview(null);
    },
    [appendMessage, preview],
  );

  const handleCancelPreview = useCallback(() => {
    setPreview(null);
  }, []);

  return (
    <div className="space-y-4">
      <div className="space-y-3" aria-live="polite">
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
