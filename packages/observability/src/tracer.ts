/**
 * Tracer OTel — wrappers para `@opentelemetry/api` com convenções da Expressia.
 *
 * O SDK OTel é registado pelo `apps/web/instrumentation.ts` via `@vercel/otel`.
 * Este módulo apenas expõe helpers para criar/anotar spans em endpoints.
 *
 * Convenções de atributos (compatíveis com OTel semantic conventions):
 *   - `http.method`, `http.route`, `http.status_code` (auto-instrumentados pelo
 *     `@vercel/otel`, mas reforçamos manualmente em endpoints custom).
 *   - `user.id` — sempre hashed (sha256 prefix) para evitar PII em traces.
 *   - `household.id` — UUID directo é seguro (não é PII).
 *
 * Trace: Story 1.7 AC1 + AC5, Architecture §9.2.
 */
import {
  SpanStatusCode,
  trace,
  type Attributes,
  type Span,
  type Tracer,
} from '@opentelemetry/api';

import { hashForCorrelation } from './logger';

/**
 * Nome canónico do tracer da Expressia. Match com `serviceName` registado
 * pelo `@vercel/otel` em `instrumentation.ts`.
 */
export const TRACER_NAME = 'expressia-web';

/**
 * Versão do tracer — incrementada em mudanças de schema de atributos.
 */
export const TRACER_VERSION = '0.1.0';

/**
 * Obtém o tracer global da aplicação. Se o SDK OTel ainda não foi registado
 * (ex: em testes Vitest sem instrumentation), retorna um no-op tracer.
 *
 * @example
 *   const tracer = getTracer();
 *   const span = tracer.startSpan('GET /api/me');
 *   try { ... } finally { span.end(); }
 */
export function getTracer(name: string = TRACER_NAME): Tracer {
  return trace.getTracer(name, TRACER_VERSION);
}

/**
 * Atributos de domínio Expressia para anotar um span.
 *
 * Convenção: nunca passar `userId` em claro — usar `userIdHashed` (já produzido
 * por `hashForCorrelation`) ou deixar este wrapper aplicar o hash.
 */
export interface DomainAttributes {
  readonly userId?: string | null;
  readonly householdId?: string | null;
  readonly route?: string;
  readonly statusCode?: number;
  readonly method?: string;
  /** Atributos extra livres (sem PII). */
  readonly extra?: Attributes;
}

/**
 * Aplica atributos de domínio a um span já criado, com PII redaction
 * automática para `userId`.
 *
 * @example
 *   annotateSpan(span, { userId: user.id, householdId, route: '/api/me', statusCode: 200, method: 'GET' });
 */
export function annotateSpan(span: Span, attrs: DomainAttributes): void {
  if (attrs.method !== undefined) span.setAttribute('http.method', attrs.method);
  if (attrs.route !== undefined) span.setAttribute('http.route', attrs.route);
  if (attrs.statusCode !== undefined) span.setAttribute('http.status_code', attrs.statusCode);
  if (attrs.userId !== undefined && attrs.userId !== null) {
    span.setAttribute('user.id', hashForCorrelation(attrs.userId));
  }
  if (attrs.householdId !== undefined && attrs.householdId !== null) {
    span.setAttribute('household.id', attrs.householdId);
  }
  if (attrs.extra !== undefined) span.setAttributes(attrs.extra);
}

/**
 * Marca um span como erro com causa associada e atributos de status HTTP.
 *
 * Uso típico em endpoints:
 *   ```
 *   try { ... }
 *   catch (err) {
 *     recordSpanError(span, err, 500);
 *     throw err;
 *   }
 *   finally { span.end(); }
 *   ```
 */
export function recordSpanError(
  span: Span,
  error: unknown,
  statusCode?: number,
): void {
  const message = error instanceof Error ? error.message : String(error);
  if (error instanceof Error) {
    span.recordException(error);
  } else {
    span.recordException({ name: 'NonErrorThrown', message });
  }
  span.setStatus({ code: SpanStatusCode.ERROR, message });
  if (statusCode !== undefined) span.setAttribute('http.status_code', statusCode);
}

/**
 * Helper de conveniência: corre um async callback dentro de um span,
 * encerrando-o automaticamente e propagando o erro se ocorrer.
 *
 * @example
 *   return withSpan('GET /api/me', { method: 'GET', route: '/api/me' }, async (span) => {
 *     // ... lógica
 *     annotateSpan(span, { statusCode: 200 });
 *     return NextResponse.json(body);
 *   });
 */
export async function withSpan<T>(
  name: string,
  initialAttrs: DomainAttributes,
  fn: (span: Span) => Promise<T>,
): Promise<T> {
  const tracer = getTracer();
  const span = tracer.startSpan(name);
  annotateSpan(span, initialAttrs);
  try {
    return await fn(span);
  } catch (err) {
    recordSpanError(span, err);
    throw err;
  } finally {
    span.end();
  }
}
