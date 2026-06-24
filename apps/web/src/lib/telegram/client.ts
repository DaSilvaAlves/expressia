/**
 * Cliente mínimo da Telegram Bot API (Story J-1 + J-2).
 *
 * Usa `fetch` nativo (sem dependência nova no package.json).
 *   - J-1: `sendMessage` (echo).
 *   - J-2: `reply_markup` (botões inline) no `sendMessage`, `sendChatAction`
 *     (indicador "a escrever...") e `answerCallbackQuery` (acknowledge de
 *     callbacks de botões inline).
 *
 * Privacidade (PII): em caso de erro logamos apenas o código de estado HTTP —
 * nunca o corpo da resposta (pode conter conteúdo de mensagens) nem o token.
 */
import type { InlineKeyboardMarkup } from './types';

interface SendMessageParams {
  chatId: number;
  text: string;
  /** Story J-2 — teclado inline opcional (botões (Cancelar) / sim/não). */
  replyMarkup?: InlineKeyboardMarkup;
}

/**
 * Envia uma mensagem de texto via Bot API `sendMessage`.
 *
 * Lê `TELEGRAM_BOT_TOKEN` da env em runtime (não no top-level — permite testar
 * com `vi.stubEnv`). Lança se a env var faltar ou se a Bot API responder
 * não-2xx, para o handler poder devolver 500 sem expor detalhes ao Telegram.
 */
export async function sendMessage({
  chatId,
  text,
  replyMarkup,
}: SendMessageParams): Promise<void> {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) {
    throw new Error('[telegram] TELEGRAM_BOT_TOKEN não definido');
  }

  const body: {
    chat_id: number;
    text: string;
    reply_markup?: InlineKeyboardMarkup;
  } = { chat_id: chatId, text };
  if (replyMarkup) {
    body.reply_markup = replyMarkup;
  }

  const response = await fetch(
    `https://api.telegram.org/bot${token}/sendMessage`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    },
  );

  if (!response.ok) {
    // Logamos só o código de estado — nunca o corpo (pode conter PII).
    console.error(`[telegram] sendMessage falhou: ${response.status}`);
    throw new Error(`[telegram] sendMessage falhou: ${response.status}`);
  }
}

/**
 * Sinaliza ao utilizador que o bot está a processar (indicador "a escrever...").
 *
 * Story J-2 AC11 — chamado imediatamente ao receber a mensagem, antes de
 * invocar o motor. Falha silenciosamente: é apenas um indicador de UX e nunca
 * deve impedir o processamento da mensagem nem alterar o resultado.
 */
export async function sendChatAction(
  chatId: number,
  action: 'typing',
): Promise<void> {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) {
    // Falha silenciosa — indicador de UX, não bloqueante.
    console.error('[telegram] sendChatAction ignorado: TELEGRAM_BOT_TOKEN não definido');
    return;
  }
  try {
    await fetch(`https://api.telegram.org/bot${token}/sendChatAction`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: chatId, action }),
    });
  } catch {
    // Falha silenciosa — nunca afecta o resultado do pedido.
    console.error('[telegram] sendChatAction falhou (não-fatal)');
  }
}

/**
 * Confirma (acknowledge) um `callback_query` — remove o estado "a carregar" no
 * botão inline e, opcionalmente, mostra um toast ao utilizador.
 *
 * Story J-2 — chamado após processar um callback (undo/confirm/cancel). Falha de
 * envio é logada (só o código de estado) mas não-fatal.
 */
export async function answerCallbackQuery(
  callbackQueryId: string,
  text?: string,
): Promise<void> {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) {
    console.error('[telegram] answerCallbackQuery ignorado: TELEGRAM_BOT_TOKEN não definido');
    return;
  }
  const body: { callback_query_id: string; text?: string } = {
    callback_query_id: callbackQueryId,
  };
  if (text !== undefined) {
    body.text = text;
  }
  const res = await fetch(
    `https://api.telegram.org/bot${token}/answerCallbackQuery`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    },
  );
  if (!res.ok) {
    console.error(`[telegram] answerCallbackQuery falhou: ${res.status}`);
  }
}
