/**
 * Helper de erros API padronizados (Architecture §7.3).
 *
 * Formato `ApiError` consistente em todas as Route Handlers:
 *   { error: { code, message, timestamp, requestId, details? } }
 *
 * Mensagens em PT-PT user-facing. Nunca expor stack traces, mensagens internas
 * ou PII em `details` — esse campo é para metadados machine-readable seguros
 * (ex: campo de validação que falhou).
 *
 * Trace: Story 1.6 AC8, Architecture §7.3.
 */
import { NextResponse } from 'next/server';
import { randomUUID } from 'node:crypto';

/**
 * Corpo padronizado de erro retornado por Route Handlers.
 *
 * `requestId` é um UUID v4 gerado por resposta — preparação para correlação
 * com OpenTelemetry traces em Story 1.7.
 */
export interface ApiErrorBody {
  readonly error: {
    readonly code: string;
    readonly message: string;
    readonly details?: Record<string, unknown>;
    readonly timestamp: string;
    readonly requestId: string;
  };
}

/**
 * Cria uma resposta JSON de erro API padronizada.
 *
 * @param code - Código machine-readable em SCREAMING_SNAKE_CASE (`AUTH_REQUIRED`,
 *   `HOUSEHOLD_NOT_FOUND`, ...). Estável entre versões.
 * @param message - Mensagem user-facing em PT-PT. Nunca incluir stack traces,
 *   path de ficheiro, ou detalhes internos.
 * @param status - HTTP status (4xx para client errors, 5xx para server errors).
 * @param details - Opcional. Apenas metadados seguros (ex: nome do campo
 *   inválido). NUNCA usar para PII, tokens ou estado interno do sistema.
 */
export function apiError(
  code: string,
  message: string,
  status: number,
  details?: Record<string, unknown>,
): NextResponse<ApiErrorBody> {
  const body: ApiErrorBody = {
    error: {
      code,
      message,
      ...(details !== undefined && { details }),
      timestamp: new Date().toISOString(),
      requestId: randomUUID(),
    },
  };

  return NextResponse.json<ApiErrorBody>(body, { status });
}
