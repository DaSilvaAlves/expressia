/**
 * Sentry — Edge runtime (Next.js middleware).
 *
 * O middleware `apps/web/src/middleware.ts` corre em runtime Edge (V8 isolates)
 * — separado do Node runtime do server-side rendering. Precisa de configuração
 * Sentry distinta porque o Edge não tem acesso a APIs Node (fs, crypto nativo)
 * e o Sentry usa um SDK diferente.
 *
 * Mantém política PII scrubbing igual ao server config (defesa em profundidade).
 *
 * Trace: Story 1.7 AC3, NFR12.
 */
import * as Sentry from '@sentry/nextjs';

const SENTRY_DSN = process.env.SENTRY_DSN ?? process.env.NEXT_PUBLIC_SENTRY_DSN;

Sentry.init({
  dsn: SENTRY_DSN,
  environment: process.env.NODE_ENV,

  tracesSampleRate: process.env.NODE_ENV === 'production' ? 0.1 : 1.0,

  debug: false,

  beforeSend(event) {
    if (event.request?.headers) {
      const headers = event.request.headers as Record<string, string>;
      delete headers.authorization;
      delete headers.cookie;
      delete headers.Authorization;
      delete headers.Cookie;
    }
    if (event.user) {
      delete event.user.email;
      delete event.user.username;
      delete event.user.ip_address;
    }
    return event;
  },
});
