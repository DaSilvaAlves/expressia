/**
 * Tipos mínimos da Telegram Bot API necessários para a Story J-1 (echo seguro).
 *
 * Derivados do contrato HTTP público da Bot API — sem pacote externo. São
 * deliberadamente parciais: cobrem apenas o que J-1 precisa (update com
 * `message` de texto ou `callback_query`). Stories seguintes expandem:
 *   - J-2: `inline_keyboard`, payload de `callback_query.data`.
 *   - J-4: `parse_mode` no envio.
 *
 * Os updates chegam ao webhook como JSON arbitrário (input não confiável). Por
 * isso a validação em runtime faz-se com o type guard `isTelegramUpdate` — os
 * tipos abaixo descrevem apenas a forma esperada após validação.
 */

export interface TelegramChat {
  id: number;
  type: string;
}

/**
 * Botão inline da Bot API (Story J-2). `callback_data` é o payload devolvido no
 * `callback_query.data` quando o utilizador carrega no botão (≤ 64 bytes pela
 * Bot API). J-2 usa formato `acção:{runId}` (ex.: `undo:<uuid>`).
 */
export interface InlineKeyboardButton {
  text: string;
  callback_data?: string;
}

/**
 * Teclado inline da Bot API — matriz de linhas de botões (`reply_markup`).
 */
export interface InlineKeyboardMarkup {
  inline_keyboard: InlineKeyboardButton[][];
}

export interface TelegramMessage {
  message_id: number;
  chat: TelegramChat;
  text?: string;
  date: number;
}

export interface TelegramCallbackQuery {
  id: string;
  data?: string;
  message?: TelegramMessage;
}

export interface TelegramUpdate {
  update_id: number;
  message?: TelegramMessage;
  callback_query?: TelegramCallbackQuery;
}

/**
 * Type guard estrutural: verifica que um valor `unknown` (corpo JSON do
 * webhook) tem a forma mínima de um `TelegramUpdate` — `update_id` numérico e,
 * quando presentes, `message`/`callback_query` com `chat.id` numérico.
 *
 * Não valida exaustivamente todos os campos da Bot API: garante apenas que o
 * handler pode aceder com segurança ao que precisa (sem `any`).
 */
export function isTelegramUpdate(value: unknown): value is TelegramUpdate {
  if (typeof value !== 'object' || value === null) return false;
  const update = value as Record<string, unknown>;
  if (typeof update.update_id !== 'number') return false;

  if (update.message !== undefined && !isTelegramMessage(update.message)) {
    return false;
  }
  if (
    update.callback_query !== undefined &&
    !isTelegramCallbackQuery(update.callback_query)
  ) {
    return false;
  }
  return true;
}

function isTelegramChat(value: unknown): value is TelegramChat {
  if (typeof value !== 'object' || value === null) return false;
  const chat = value as Record<string, unknown>;
  return typeof chat.id === 'number' && typeof chat.type === 'string';
}

function isTelegramMessage(value: unknown): value is TelegramMessage {
  if (typeof value !== 'object' || value === null) return false;
  const message = value as Record<string, unknown>;
  if (typeof message.message_id !== 'number') return false;
  if (typeof message.date !== 'number') return false;
  if (!isTelegramChat(message.chat)) return false;
  if (message.text !== undefined && typeof message.text !== 'string') {
    return false;
  }
  return true;
}

function isTelegramCallbackQuery(
  value: unknown,
): value is TelegramCallbackQuery {
  if (typeof value !== 'object' || value === null) return false;
  const query = value as Record<string, unknown>;
  if (typeof query.id !== 'string') return false;
  if (query.data !== undefined && typeof query.data !== 'string') return false;
  if (query.message !== undefined && !isTelegramMessage(query.message)) {
    return false;
  }
  return true;
}

/**
 * Extrai o `chat_id` de um update — de `message.chat.id` ou, em fallback, de
 * `callback_query.message.chat.id`. Devolve `null` se nenhum estiver presente.
 */
export function extractChatId(update: TelegramUpdate): number | null {
  if (update.message) return update.message.chat.id;
  if (update.callback_query?.message) {
    return update.callback_query.message.chat.id;
  }
  return null;
}
