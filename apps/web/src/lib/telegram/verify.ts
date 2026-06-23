/**
 * Verificação do secret token do webhook do Telegram (Story J-1 — AC2, NFR-J4).
 *
 * O Telegram envia o cabeçalho `X-Telegram-Bot-Api-Secret-Token` em cada update
 * (quando `secret_token` é configurado no `setWebhook`). O webhook é um endpoint
 * público, logo a verificação deste segredo é a primeira linha de defesa: sem
 * ele correcto, o pedido é rejeitado com 401 sem processar o body.
 *
 * A comparação é de tempo constante (`timingSafeEqual` de `node:crypto`) para
 * evitar timing attacks — um atacante não pode inferir o segredo medindo o
 * tempo de resposta byte a byte.
 */
import { timingSafeEqual } from 'node:crypto';

/**
 * Compara o cabeçalho `X-Telegram-Bot-Api-Secret-Token` do pedido com a env var
 * `TELEGRAM_WEBHOOK_SECRET` em tempo constante.
 *
 * Devolve `false` (rejeita) se: a env var não estiver definida, o cabeçalho
 * estiver ausente, ou os comprimentos divergirem (`timingSafeEqual` lança com
 * buffers de tamanhos diferentes — por isso comparamos o comprimento primeiro).
 */
export function verifyWebhookSecret(request: Request): boolean {
  const secret = process.env.TELEGRAM_WEBHOOK_SECRET;
  if (!secret) return false;

  const header = request.headers.get('x-telegram-bot-api-secret-token') ?? '';

  const headerBuffer = Buffer.from(header, 'utf8');
  const secretBuffer = Buffer.from(secret, 'utf8');

  // Verificação prévia de comprimento: `timingSafeEqual` exige buffers do mesmo
  // tamanho. A divergência de comprimento já é, por si, indício de segredo
  // incorrecto — rejeitamos sem comparar.
  if (headerBuffer.length !== secretBuffer.length) return false;

  return timingSafeEqual(headerBuffer, secretBuffer);
}
