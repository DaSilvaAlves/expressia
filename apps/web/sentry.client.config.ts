/**
 * Sentry — Browser runtime (componentes client React).
 *
 * Carregado em todas as páginas pelo `@sentry/nextjs` após `withSentryConfig`.
 * Activa Session Replay com `maskAllText` para conformidade com NFR12 (zero
 * PII captado dos inputs do utilizador).
 *
 * `replaysSessionSampleRate: 0` — replay desactivado por default.
 * `replaysOnErrorSampleRate: 0.1` — apenas 10% das sessões com erro são gravadas.
 *
 * Trace: Story 1.7 AC3, NFR12.
 */
import * as Sentry from '@sentry/nextjs';

const SENTRY_DSN = process.env.NEXT_PUBLIC_SENTRY_DSN ?? process.env.SENTRY_DSN;

Sentry.init({
  dsn: SENTRY_DSN,
  environment: process.env.NODE_ENV,

  tracesSampleRate: process.env.NODE_ENV === 'production' ? 0.1 : 1.0,

  // Session Replay com PII masking obrigatório (NFR12)
  integrations: [
    Sentry.replayIntegration({
      maskAllText: true,
      blockAllMedia: true,
    }),
  ],
  replaysSessionSampleRate: 0, // desactivado por default
  replaysOnErrorSampleRate: 0.1, // apenas em erros

  debug: false,

  beforeSend(event) {
    // Mesma política do server: scrub PII conhecidas
    if (event.user) {
      delete event.user.email;
      delete event.user.username;
      delete event.user.ip_address;
    }
    return event;
  },
});
