/**
 * POST /api/telegram/webhook — webhook do bot Telegram.
 *
 * Story J-1: provou a tubagem do canal (echo seguro).
 * Story J-2: liga o canal ao motor cognitivo — o bot deixa de ecoar e passa a
 * AGIR (classificar → planear → executar + undo 30 s).
 *
 * Fluxo (J-2):
 *   1. Verificar o secret token → 401 silencioso se falhar (AC2, NFR-J4).
 *   2. Ler e validar o corpo JSON → 400 controlado se malformado.
 *   3. Resolver `chat_id` → `{ userId, householdId }` via `telegram_link`
 *      (getServiceDb — identidade fora de sessão HTTP). Desconhecido → 200
 *      silencioso (substitui a allowlist env-var de J-1).
 *   4a. `message.text` → sendChatAction('typing') → runAgentForHousehold →
 *       mensagem de confirmação (executed) ou pergunta (preview) com botões.
 *   4b. `callback_query` → undo / confirm / cancel (reutiliza executeUndo /
 *       executeConfirm sem HTTP interno).
 *
 * Runtime Node.js serverless (Vercel fra1) — NÃO edge: `verify.ts` usa
 * `node:crypto`. Sem `export const runtime = 'edge'`.
 *
 * Privacidade (NFR12 / AC12): NUNCA logamos `message.text` nem dados de
 * tarefa/finança em claro. Logs contêm apenas `update_id`, hash de correlação
 * do `user_id` (`hashForCorrelation` de @meu-jarvis/observability) e o tipo de
 * resultado.
 */
import { sql } from 'drizzle-orm';
import { type NextRequest } from 'next/server';

import { hashForCorrelation } from '@meu-jarvis/observability';

import { getServiceDb } from '@/lib/agent/db-shim';
import { runAgentForHousehold, type AgentRunOutcome } from '@/lib/agent/run-agent';
import { executeUndo } from '@/app/api/agent/prompt/[runId]/undo/route';
import { executeConfirm } from '@/app/api/agent/prompt/[runId]/confirm/route';
import {
  sendMessage,
  sendChatAction,
  answerCallbackQuery,
} from '@/lib/telegram/client';
import {
  extractChatId,
  isTelegramUpdate,
  type InlineKeyboardMarkup,
  type TelegramUpdate,
} from '@/lib/telegram/types';
import { verifyWebhookSecret } from '@/lib/telegram/verify';

/** Identidade resolvida a partir de `telegram_link`. */
interface ResolvedIdentity {
  readonly userId: string;
  readonly householdId: string;
}

export async function POST(request: NextRequest): Promise<Response> {
  // 1. Verificação do secret token (AC2). Endpoint público — primeira defesa.
  if (!verifyWebhookSecret(request)) {
    return new Response(null, { status: 401 });
  }

  // 2. Leitura e validação do corpo JSON.
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

  // 3. Resolver chat_id → identidade via telegram_link (Story J-2 AC6).
  const chatId = extractChatId(update);
  if (chatId === null) {
    console.info(`[telegram] update sem chat_id ignorado: update_id=${update.update_id}`);
    return new Response(null, { status: 200 });
  }

  const identity = await resolveIdentity(chatId);
  if (!identity) {
    // chat_id não registado em telegram_link → 200 silencioso (não revelamos a
    // existência do bot a terceiros; comportamento igual à allowlist de J-1).
    console.warn(
      `[telegram] update ignorado — chat_id não registado em telegram_link: update_id=${update.update_id}`,
    );
    return new Response(null, { status: 200 });
  }

  const userHash = hashForCorrelation(identity.userId);

  // 4b. Callback queries (botões inline) — undo / confirm / cancel.
  if (update.callback_query) {
    return handleCallbackQuery(update, identity, userHash);
  }

  // 4a. Mensagens de texto → motor cognitivo.
  const messageText = update.message?.text;
  if (update.message && typeof messageText === 'string') {
    return handleTextMessage(update, chatId, messageText, identity, userHash);
  }

  // Outros updates (edits, stickers, etc.) — ignorados graciosamente.
  console.info(
    `[telegram] update sem texto/callback ignorado: update_id=${update.update_id}`,
  );
  return new Response(null, { status: 200 });
}

// ─────────────────────────────────────────────────────────────────────────────
// Resolução de identidade (chat_id → telegram_link)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Resolve `chat_id` → `{ userId, householdId }` via `telegram_link`.
 *
 * Usa `getServiceDb()` — uso legítimo SEC-10: resolve a tabela de mapeamento de
 * identidade fora de sessão HTTP (o webhook não tem JWT). NÃO acede a dados de
 * domínio (tarefas/finanças) — esses passam por `runAgentForHousehold` →
 * `withHousehold` (RLS viva). Devolve `null` se o chat_id não estiver registado.
 */
async function resolveIdentity(chatId: number): Promise<ResolvedIdentity | null> {
  try {
    const serviceDb = getServiceDb();
    const rows = await serviceDb.execute<{ user_id: string; household_id: string }>(sql`
      select user_id, household_id
      from public.telegram_link
      where chat_id = ${chatId}
      limit 1
    `);
    const row = rows[0];
    if (!row) {
      return null;
    }
    return { userId: row.user_id, householdId: row.household_id };
  } catch (err) {
    // Falha de DB ao resolver identidade — não revelamos detalhes, 200 silencioso
    // a montante. Logamos só a presença do erro (sem PII).
    console.error('[telegram] falha ao resolver identidade via telegram_link', err instanceof Error ? err.message : '');
    return null;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Handler de mensagem de texto → motor
// ─────────────────────────────────────────────────────────────────────────────

async function handleTextMessage(
  update: TelegramUpdate,
  chatId: number,
  messageText: string,
  identity: ResolvedIdentity,
  userHash: string,
): Promise<Response> {
  // AC11 — sinalizar processamento ao Telegram ANTES de invocar o motor.
  await sendChatAction(chatId, 'typing');

  let outcome: AgentRunOutcome;
  try {
    outcome = await runAgentForHousehold({
      userId: identity.userId,
      householdId: identity.householdId,
      prompt: messageText,
    });
  } catch (err) {
    // Erro do pipeline (Classifier/Planner/Tool/...). Nunca expomos detalhes nem
    // o texto da mensagem — mensagem neutra ao utilizador.
    console.error(
      `[telegram] pipeline falhou: update_id=${update.update_id} user_hash=${userHash} err=${err instanceof Error ? err.constructor.name : 'unknown'}`,
    );
    await safeSend(chatId, 'Não consegui tratar disso agora. Tenta de novo daqui a pouco.');
    return new Response(null, { status: 200 });
  }

  console.info(
    `[telegram] resultado do motor: update_id=${update.update_id} user_hash=${userHash} status=${outcome.status}`,
  );

  await replyForOutcome(chatId, outcome);
  return new Response(null, { status: 200 });
}

/**
 * Traduz um `AgentRunOutcome` numa mensagem do Telegram (AC7/AC8).
 */
async function replyForOutcome(chatId: number, outcome: AgentRunOutcome): Promise<void> {
  switch (outcome.status) {
    case 'executed': {
      if (outcome.kind === 'direct_query') {
        // Consulta read-only (cost-router) — sem undo.
        await safeSend(chatId, outcome.summary);
        return;
      }
      // Execução com mutação — confirmação + botão (Cancelar) activo 30 s.
      await safeSend(chatId, `Feito. ${outcome.summary}`, cancelKeyboard(outcome.runId));
      return;
    }

    case 'preview': {
      // Confiança baixa (ou acção destrutiva) — pergunta de confirmação.
      const detalhe = outcome.planSummary.length > 0 ? ` (${outcome.planSummary.join(', ')})` : '';
      await safeSend(
        chatId,
        `Não tenho a certeza${detalhe}. Confirmas? Responde **sim** para avançar ou diz-me o que querias.`,
        confirmKeyboard(outcome.runId),
      );
      return;
    }

    case 'rate_limited':
      await safeSend(chatId, 'Estás a enviar pedidos demasiado depressa. Espera um pouco e tenta de novo.');
      return;

    case 'quota_exceeded':
      await safeSend(chatId, 'Atingiste o limite de pedidos deste período. Tenta novamente mais tarde.');
      return;

    case 'idempotency_in_progress':
      await safeSend(chatId, 'Esse pedido ainda está a ser processado. Aguarda um instante.');
      return;

    case 'replay':
      // Pedido repetido (idempotency) — confirmamos sem repetir a acção.
      await safeSend(chatId, 'Esse pedido já tinha sido tratado.');
      return;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Handler de callback_query (botões inline)
// ─────────────────────────────────────────────────────────────────────────────

async function handleCallbackQuery(
  update: TelegramUpdate,
  identity: ResolvedIdentity,
  userHash: string,
): Promise<Response> {
  const callback = update.callback_query!;
  const chatId = extractChatId(update);
  const data = callback.data ?? '';

  const parsed = parseCallbackData(data);
  if (!parsed || chatId === null) {
    await answerCallbackQuery(callback.id);
    return new Response(null, { status: 200 });
  }

  const { action, runId } = parsed;
  console.info(
    `[telegram] callback: update_id=${update.update_id} user_hash=${userHash} action=${action}`,
  );

  if (action === 'undo') {
    const result = await executeUndo({
      runId,
      householdId: identity.householdId,
      userId: identity.userId,
    });
    await answerCallbackQuery(callback.id);
    await safeSend(chatId, result.ok ? 'Revertido.' : result.message);
    return new Response(null, { status: 200 });
  }

  if (action === 'confirm') {
    const result = await executeConfirm({
      runId,
      householdId: identity.householdId,
      userId: identity.userId,
    });
    await answerCallbackQuery(callback.id);
    if (result.ok) {
      // Nova janela de 30 s para reverter a acção agora executada.
      await safeSend(chatId, `Feito. ${result.summary}`, cancelKeyboard(runId));
    } else {
      await safeSend(chatId, result.message);
    }
    return new Response(null, { status: 200 });
  }

  // action === 'cancel' (negação de preview).
  await answerCallbackQuery(callback.id);
  await safeSend(chatId, 'Ok, não fiz nada.');
  return new Response(null, { status: 200 });
}

// ─────────────────────────────────────────────────────────────────────────────
// Helpers de UI / parsing
// ─────────────────────────────────────────────────────────────────────────────

type CallbackAction = 'undo' | 'confirm' | 'cancel';

/**
 * Faz parse de `callback_data` no formato `acção:{runId}`. Devolve `null` se o
 * formato for inválido ou a acção desconhecida (input não confiável).
 */
function parseCallbackData(data: string): { action: CallbackAction; runId: string } | null {
  const sep = data.indexOf(':');
  if (sep <= 0) return null;
  const action = data.slice(0, sep);
  const runId = data.slice(sep + 1);
  if (runId.length === 0) return null;
  if (action === 'undo' || action === 'confirm' || action === 'cancel') {
    return { action, runId };
  }
  return null;
}

/** Botão (Cancelar) após execução — `callback_data = "undo:{runId}"`. */
function cancelKeyboard(runId: string): InlineKeyboardMarkup {
  return {
    inline_keyboard: [[{ text: '(Cancelar)', callback_data: `undo:${runId}` }]],
  };
}

/** Botões sim/não para preview — `confirm:{runId}` / `cancel:{runId}`. */
function confirmKeyboard(runId: string): InlineKeyboardMarkup {
  return {
    inline_keyboard: [
      [
        { text: 'sim', callback_data: `confirm:${runId}` },
        { text: 'não', callback_data: `cancel:${runId}` },
      ],
    ],
  };
}

/**
 * Envia uma mensagem sem propagar erros — o webhook deve sempre devolver 200 ao
 * Telegram nos caminhos de resposta ao utilizador (uma falha de envio não deve
 * provocar reentregas infinitas do update pelo Telegram). O erro já é logado em
 * `sendMessage` (só o código de estado).
 */
async function safeSend(
  chatId: number,
  text: string,
  replyMarkup?: InlineKeyboardMarkup,
): Promise<void> {
  try {
    await sendMessage({ chatId, text, replyMarkup });
  } catch {
    console.error('[telegram] falha ao enviar resposta (não-fatal)');
  }
}
