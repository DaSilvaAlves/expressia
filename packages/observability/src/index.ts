/**
 * Entry-point público do pacote `@meu-jarvis/observability`.
 *
 * Stack (Architecture §9.1, ADR-004):
 *   - Pino logger com PII redaction (NFR12)
 *   - OTel API helpers (`@opentelemetry/api`) — SDK registado pelo
 *     `apps/web/instrumentation.ts` via `@vercel/otel`
 *   - Sentry wrapper (`captureException` com contexto de domínio + PII scrub)
 *
 * Trace: Story 1.7 AC1.
 */
export { logger, childLogger, hashForCorrelation, PII_REDACT_PATHS } from './logger';
export {
  getTracer,
  annotateSpan,
  recordSpanError,
  withSpan,
  TRACER_NAME,
  TRACER_VERSION,
  type DomainAttributes,
} from './tracer';
export { captureException, sentryHub, type SentryContext } from './sentry';
