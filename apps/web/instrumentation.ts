/**
 * Next.js instrumentation hook (Story 1.7 AC2).
 *
 * Activo por default em Next.js 15.x — `instrumentation.ts` é estável desde
 * 15.0 e é invocado automaticamente em cada cold-start serverless. O handoff
 * devops 2026-05-07 e a story v1.2 referiam `experimental.instrumentationHook
 * = true` no `next.config.ts`, mas esse flag foi removido em Next 15. A
 * cobertura é equivalente sem flag.
 *
 * Estratégia (Architecture §9.1 + handoff devops 2026-05-07):
 *   - `@vercel/otel` é o wrapper recomendado pelo Vercel para Next.js
 *     serverless. Trata cold-start automaticamente e lê
 *     `OTEL_EXPORTER_OTLP_ENDPOINT` + `OTEL_EXPORTER_OTLP_HEADERS` directamente
 *     do environment, sem boilerplate.
 *   - `OTEL_EXPORTER_OTLP_HEADERS` chega já com formato
 *     `Authorization=Basic%20<base64>` da UI Grafana — SDKs OTel decodificam
 *     `%20` automaticamente, NÃO recalcular nem decodificar.
 *   - Cobertura automática inclui HTTP, fetch e Next.js routing.
 *
 * Sentry é inicializado em separado por `apps/web/sentry.{server,client,edge}.config.ts`
 * — manter dual-emission (Sentry para errors via SDK, Grafana para traces/metrics
 * via OTel) conforme decisão arquitectural ADR-004.
 *
 * Trace: Story 1.7 AC2, Architecture §9.1, NFR13.
 */
import { registerOTel } from '@vercel/otel';

export function register(): void {
  registerOTel({
    serviceName: 'expressia-web',
    // OTLP endpoint + headers vêm de env vars automaticamente:
    //   OTEL_EXPORTER_OTLP_ENDPOINT=https://otlp-gateway-prod-eu-west-6.grafana.net/otlp
    //   OTEL_EXPORTER_OTLP_HEADERS=Authorization=Basic%20<base64(InstanceID:Token)>
  });
}
