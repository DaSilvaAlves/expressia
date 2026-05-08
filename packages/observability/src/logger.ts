/**
 * Logger Pino com PII redaction (NFR12).
 *
 * Logs estruturados em JSON com redaction automática de campos sensíveis.
 * Usado em todos os endpoints e jobs para correlação trace-id ↔ logs no Grafana
 * Cloud Loki.
 *
 * Paths redacted (Architecture §9.3, NFR12):
 *   - email, password, nif, iban, prompt_text (root)
 *   - *.email, *.password (qualquer profundidade)
 *   - req.headers.authorization, req.headers.cookie
 *
 * NUNCA logar: conteúdo de prompts, email, NIF, IBAN, número de cartão,
 * tokens de sessão. Para correlação debug sem PII, utilizar `hashForCorrelation`
 * (sha256 hex) — preserva agrupamento por valor sem expor o valor original.
 *
 * Vercel free plan log limit: 1024 MB log per function execution. Em hot paths
 * de produção preferir `logger.debug` em vez de `logger.info` quando aplicável.
 *
 * Trace: Story 1.7 AC6, Architecture §9.3, NFR12.
 */
import { createHash } from 'node:crypto';

import pino, { type Logger } from 'pino';

/**
 * Lista canónica de paths redacted pelo Pino.
 *
 * Re-exposta para que o Sentry `beforeSend` hook (em
 * `apps/web/sentry.server.config.ts` / `sentry.client.config.ts`) possa aplicar
 * a mesma política ao scrubbing de eventos.
 */
export const PII_REDACT_PATHS: ReadonlyArray<string> = [
  'email',
  'password',
  'nif',
  'iban',
  'prompt_text',
  '*.email',
  '*.password',
  'req.headers.authorization',
  'req.headers.cookie',
] as const;

/**
 * Logger Pino singleton com PII redaction activa.
 *
 * Level controlável via env `LOG_LEVEL` (default: `info`).
 *
 * @example
 *   import { logger } from '@meu-jarvis/observability';
 *   logger.info({ household_id: 'abc' }, 'Pedido recebido');
 */
export const logger: Logger = pino({
  level: process.env.LOG_LEVEL ?? 'info',
  redact: {
    paths: [...PII_REDACT_PATHS],
    censor: '[REDACTED]',
  },
  serializers: {
    err: pino.stdSerializers.err,
  },
  // Em produção (Vercel) emitimos JSON puro para Vercel log drain → Grafana Loki.
  // Em dev local manter Pino default (sem pretty-print para evitar dep adicional).
  base: {
    service: 'expressia-web',
  },
});

/**
 * Hash sha256 hex truncado para correlação debug sem PII.
 *
 * Permite agrupar logs/spans por valor (ex: `prompt_text`) preservando a
 * privacidade — dois pedidos com o mesmo `prompt_text` partilham o mesmo hash,
 * mas o valor original nunca é exposto.
 *
 * @param value - Valor a hashar (string ou número).
 * @param length - Comprimento do prefixo hex retornado (default 16 chars = 64
 *   bits de entropia, suficiente para correlação a curto prazo sem colisão).
 * @returns prefixo hex do sha256, ou `'[empty]'` se valor for vazio.
 */
export function hashForCorrelation(value: string | number, length = 16): string {
  const stringValue = String(value);
  if (stringValue.length === 0) return '[empty]';
  return createHash('sha256').update(stringValue, 'utf8').digest('hex').slice(0, length);
}

/**
 * Cria um logger filho com contexto (`bindings`) — útil para anexar
 * `request_id` ou `household_id` (já hashado) a todos os logs de um request.
 *
 * @example
 *   const reqLogger = childLogger({ request_id: 'abc', household_hash: hashForCorrelation(hh) });
 *   reqLogger.info('processed');
 */
export function childLogger(bindings: Record<string, unknown>): Logger {
  return logger.child(bindings);
}
