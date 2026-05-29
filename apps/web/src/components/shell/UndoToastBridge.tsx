'use client';

/**
 * `<UndoToastBridge>` — ponte reactiva `chatStore` → `undoStore` (Story 5.9 AC2,
 * DP-5.9.B). Componente Client sem UI (renderiza `null`); montado no `AppShell`.
 *
 * Subscreve `useChatMessages()` e, sempre que a ÚLTIMA mensagem é uma
 * `AgentResultMessage` (`kind='result'`) com `undoUrl`+`undoExpiresAt`, alimenta
 * o `undoStore` via `setUndo()`. Mantém os dois stores desacoplados — nenhum
 * conhece o outro; a ponte vive só aqui.
 *
 * **SSR-safety (lição FIX-1 da 5.7):** a escrita no `undoStore` acontece SÓ
 * dentro do `useEffect` (client-only) — nunca no corpo do render. Effects não
 * correm no SSR → o singleton `undoStore` nunca é mutado no servidor (sem
 * cross-request leak). Precedente: `WidgetConfigHydrator` (5.7).
 *
 * **AC2.d edge case:** mensagens sem `undoUrl`/`undoExpiresAt` (respostas
 * `preview` ou callers pre-2.8) NÃO actualizam o store. Mensagens `kind='user'`/
 * `kind='error'` também não.
 *
 * Trace: Story 5.9 AC2; DP-5.9.B; `chatStore` (`AgentResultMessage.undoUrl?`).
 */
import { useEffect } from 'react';

import { useChatMessages } from '@/lib/stores/chatStore';
import { useUndoActions } from '@/lib/stores/undoStore';

export function UndoToastBridge(): null {
  const messages = useChatMessages();
  const { setUndo } = useUndoActions();

  useEffect(() => {
    const last = messages[messages.length - 1];
    if (last && last.kind === 'result' && last.undoUrl && last.undoExpiresAt) {
      setUndo(last.undoUrl, last.undoExpiresAt);
    }
  }, [messages, setUndo]);

  return null;
}
