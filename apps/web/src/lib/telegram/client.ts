/**
 * Cliente mínimo da Telegram Bot API (Story J-1 — AC4, AC6, AC7).
 *
 * Usa `fetch` nativo (sem dependência nova no package.json). Em J-1 só é
 * necessário `sendMessage` para devolver o echo ao Eurico. Stories seguintes
 * adicionam mais métodos (J-2: `answerCallbackQuery`; J-4: `parse_mode`).
 *
 * Privacidade (PII): em caso de erro logamos apenas o código de estado HTTP —
 * nunca o corpo da resposta (pode conter conteúdo de mensagens) nem o token.
 */

interface SendMessageParams {
  chatId: number;
  text: string;
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
}: SendMessageParams): Promise<void> {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) {
    throw new Error('[telegram] TELEGRAM_BOT_TOKEN não definido');
  }

  const response = await fetch(
    `https://api.telegram.org/bot${token}/sendMessage`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: chatId, text }),
    },
  );

  if (!response.ok) {
    // Logamos só o código de estado — nunca o corpo (pode conter PII).
    console.error(`[telegram] sendMessage falhou: ${response.status}`);
    throw new Error(`[telegram] sendMessage falhou: ${response.status}`);
  }
}
