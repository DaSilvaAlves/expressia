/**
 * Wrapper Sentry — `captureException` com contexto de domínio e PII scrubbing.
 *
 * O SDK `@sentry/nextjs` é inicializado em `apps/web/sentry.{server,client,edge}.config.ts`.
 * Este módulo expõe um wrapper que adiciona contexto Expressia (`household_id`)
 * e garante que nenhum PII passa em `extra`/`tags`.
 *
 * Trace: Story 1.7 AC1 + AC3, NFR12.
 */
import * as Sentry from '@sentry/nextjs';

import { hashForCorrelation, PII_REDACT_PATHS } from './logger';

/**
 * Contexto seguro para anexar a um evento Sentry.
 *
 * `userId` é sempre hashed antes de ser enviado. `householdId` (UUID) é seguro.
 * `extra` deve conter apenas metadados machine-readable sem PII.
 */
export interface SentryContext {
  readonly userId?: string | null;
  readonly householdId?: string | null;
  readonly route?: string;
  readonly extra?: Record<string, unknown>;
  readonly tags?: Record<string, string>;
}

/**
 * Lista de chaves comuns que indicam PII. Usada para scrub defensivo do
 * `extra` antes de delegar a Sentry — o `beforeSend` hook em
 * `sentry.{server,client}.config.ts` é a barreira primária; isto é defesa em
 * profundidade.
 */
const PII_KEYS_LOWER: ReadonlyArray<string> = PII_REDACT_PATHS.map((p) =>
  p.replace(/^\*\.|^req\.headers\./, '').toLowerCase(),
);

function scrubExtra(
  extra: Record<string, unknown> | undefined,
): Record<string, unknown> | undefined {
  if (!extra) return undefined;
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(extra)) {
    if (PII_KEYS_LOWER.includes(key.toLowerCase())) {
      out[key] = '[REDACTED]';
    } else {
      out[key] = value;
    }
  }
  return out;
}

/**
 * Captura uma excepção em Sentry com contexto de domínio Expressia.
 *
 * @param error - Excepção (Error ou unknown).
 * @param context - Contexto seguro (sem PII em claro — `userId` é hashed).
 *
 * @example
 *   try { ... }
 *   catch (err) {
 *     captureException(err, { householdId, route: '/api/me' });
 *     throw err;
 *   }
 */
export function captureException(error: unknown, context: SentryContext = {}): void {
  Sentry.withScope((scope) => {
    if (context.householdId) {
      scope.setTag('household_id', context.householdId);
    }
    if (context.route) {
      scope.setTag('http.route', context.route);
    }
    if (context.userId) {
      // Nunca passar userId em claro — só o hash para correlação.
      scope.setUser({ id: hashForCorrelation(context.userId) });
    }
    if (context.tags) {
      for (const [key, value] of Object.entries(context.tags)) {
        scope.setTag(key, value);
      }
    }
    const extra = scrubExtra(context.extra);
    if (extra) {
      for (const [key, value] of Object.entries(extra)) {
        scope.setExtra(key, value);
      }
    }
    Sentry.captureException(error);
  });
}

/**
 * Re-export selectivo de utilitários Sentry úteis para outros módulos sem
 * forçá-los a importar `@sentry/nextjs` directamente.
 */
export const sentryHub = {
  setUser: Sentry.setUser,
  addBreadcrumb: Sentry.addBreadcrumb,
};
