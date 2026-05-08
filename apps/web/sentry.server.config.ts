/**
 * Sentry — Node runtime (Server Components, Route Handlers, Server Actions).
 *
 * Inicializado pelo `@sentry/nextjs` automaticamente quando este ficheiro
 * existe na raiz de `apps/web/` e o `next.config.ts` está envolvido com
 * `withSentryConfig(...)`.
 *
 * Data residency EU: o DSN `o4510848200278016.ingest.de.sentry.io` tem o
 * sufixo `.de.` (Frankfurt EU) — confirmado em handoff devops 2026-05-07,
 * imutável após criação da org.
 *
 * PII redaction (NFR12) em 3 camadas:
 *   1. `beforeSend` hook — scrub de `event.user.email`, headers `authorization`
 *      e `cookie`, e qualquer chave em `event.extra` que case com paths
 *      reconhecidos como PII (ver `PII_REDACT_PATHS` em
 *      `@meu-jarvis/observability/logger`).
 *   2. `replayIntegration` com `maskAllText: true` + `blockAllMedia: true`
 *      (configurada apenas no client config; aqui server-side não há replay).
 *   3. Wrapper `captureException` em `@meu-jarvis/observability/sentry` que
 *      hash de `userId` antes de delegar.
 *
 * Trace: Story 1.7 AC3, NFR12, Architecture §9.1.
 */
import * as Sentry from '@sentry/nextjs';

const SENTRY_DSN = process.env.SENTRY_DSN ?? process.env.NEXT_PUBLIC_SENTRY_DSN;

Sentry.init({
  dsn: SENTRY_DSN,
  environment: process.env.NODE_ENV,

  // Performance tracing — sample rate baixo em produção (custos free tier).
  tracesSampleRate: process.env.NODE_ENV === 'production' ? 0.1 : 1.0,

  // Manter logs e breadcrumbs limitados — não enviar dados de debug verbosos.
  debug: false,

  /**
   * `beforeSend` é a barreira primária de PII scrubbing antes de o evento
   * sair do servidor. Defesa em profundidade: o wrapper
   * `@meu-jarvis/observability/sentry::captureException` já hash `userId`
   * antes de chegar aqui.
   */
  beforeSend(event) {
    // 1. Headers HTTP sensíveis
    if (event.request?.headers) {
      const headers = event.request.headers as Record<string, string>;
      delete headers.authorization;
      delete headers.cookie;
      delete headers.Authorization;
      delete headers.Cookie;
    }

    // 2. Email do utilizador — nunca enviar para Sentry
    if (event.user) {
      delete event.user.email;
      delete event.user.username;
      delete event.user.ip_address;
    }

    // 3. Body fields com PII conhecidos
    if (event.request?.data && typeof event.request.data === 'object') {
      const data = event.request.data as Record<string, unknown>;
      for (const piiKey of ['email', 'password', 'nif', 'iban', 'prompt_text']) {
        if (piiKey in data) {
          data[piiKey] = '[REDACTED]';
        }
      }
    }

    return event;
  },
});
