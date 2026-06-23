/**
 * POST /api/telegram/webhook — webhook do bot Telegram (Story J-1, echo seguro).
 *
 * Prova a tubagem do canal Telegram de ponta a ponta SEM tocar no motor nem na
 * base de dados. Fluxo:
 *   1. Verificar o secret token → 401 silencioso se falhar (AC2, NFR-J4).
 *   2. Ler e validar o corpo JSON → 400 controlado se malformado (SHOULD-FIX-2).
 *   3. Allowlist do `chat_id` → 200 silencioso se não for o Eurico (AC3).
 *   4. Echo se `message.text` → `sendMessage` → 200 (AC4).
 *   5. Outros updates (callback_query, edits, stickers) → 200 graciosamente.
 *
 * Runtime Node.js serverless (Vercel fra1) — NÃO edge: `verify.ts` usa
 * `node:crypto` (`timingSafeEqual`). Sem `export const runtime = 'edge'`.
 *
 * Privacidade: não persistimos conteúdo de mensagens. Logs contêm apenas
 * `update_id` e (quando bloqueado) o `chat_id` — nunca o texto do Eurico.
 */
import { type NextRequest } from 'next/server';

import { sendMessage } from '@/lib/telegram/client';
import {
  extractChatId,
  isTelegramUpdate,
  type TelegramUpdate,
} from '@/lib/telegram/types';
import { verifyWebhookSecret } from '@/lib/telegram/verify';

export async function POST(request: NextRequest): Promise<Response> {
  // 1. Verificação do secret token (AC2). Endpoint público — primeira defesa.
  //    Rejeitamos sem ler o body e sem logar conteúdo do pedido.
  if (!verifyWebhookSecret(request)) {
    return new Response(null, { status: 401 });
  }

  // 2. Leitura e validação do corpo JSON (SHOULD-FIX-2 / AC1 / NFR-J4).
  //    Body malformado ou JSON inválido NÃO pode rebentar com 500 + stack
  //    trace: tratamos o parse com try/catch e devolvemos 400 controlado.
  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    console.warn('[telegram] corpo JSON inválido — pedido ignorado');
    return new Response(null, { status: 400 });
  }

  if (!isTelegramUpdate(payload)) {
    console.warn('[telegram] update com forma inesperada — pedido ignorado');
    return new Response(null, { status: 400 });
  }

  const update: TelegramUpdate = payload;
  console.info(`[telegram] update recebido: update_id=${update.update_id}`);

  // 3. Allowlist do chat_id (AC3). Só o Eurico é processado. Comparação como
  //    string para coerção robusta (o env var é string; chat.id é número).
  const chatId = extractChatId(update);
  const allowedChatId = process.env.TELEGRAM_ALLOWED_CHAT_ID;

  if (chatId === null || String(chatId) !== String(allowedChatId ?? '')) {
    console.warn(
      `[telegram] update ignorado — chat_id bloqueado: ${chatId ?? 'desconhecido'}`,
    );
    // 200 sem resposta ao utilizador: não revelamos a existência do bot a
    // terceiros nem damos feedback a quem não está na allowlist.
    return new Response(null, { status: 200 });
  }

  // 4. Echo para mensagens de texto válidas do Eurico (AC4).
  const messageText = update.message?.text;
  if (update.message && typeof messageText === 'string') {
    try {
      await sendMessage({
        chatId: update.message.chat.id,
        text: `Echo: ${messageText}`,
      });
    } catch {
      // AC7: falha de envio → 500 sem expor detalhes ao Telegram. O detalhe já
      // foi logado em `sendMessage` (apenas o código de estado, sem PII).
      console.error(
        `[telegram] falha ao enviar echo para update_id=${update.update_id}`,
      );
      return new Response(null, { status: 500 });
    }
    return new Response(null, { status: 200 });
  }

  // 5. Outros updates (callback_query, edits, stickers, etc.) — fora do âmbito
  //    de J-1 (echo de texto puro). Ignorados graciosamente com rastreabilidade.
  const updateKind = update.callback_query ? 'callback_query' : 'outro';
  console.info(
    `[telegram] update sem texto ignorado: update_id=${update.update_id} tipo=${updateKind}`,
  );
  return new Response(null, { status: 200 });
}
