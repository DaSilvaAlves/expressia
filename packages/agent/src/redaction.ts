/**
 * Helpers de PII redaction internos ao package agent.
 *
 * Trace: Story 2.2 AC9 + Architecture §9.3 + NFR12.
 *
 * Complementa `PII_REDACT_PATHS` exportado de `@meu-jarvis/observability`:
 *   - `PII_REDACT_PATHS` cobre logs Pino/Sentry (root-level paths)
 *   - `redactProviderPayload` cobre payloads enviados a SDK Anthropic/OpenAI
 *     antes de qualquer log/captureException dentro do package agent
 *
 * Princípio: prompt content, messages array e tool input_schema NUNCA
 * aparecem em logs, span attributes ou Sentry events.
 */

/**
 * Lista canónica de campos do payload provider que são REMOVIDOS antes de log.
 *
 * - `system`: prompt system pode conter dados PT-PT do utilizador injectados
 *   por templating em Stories 2.4+
 * - `messages`: cada mensagem `content` é o prompt original (PII)
 * - `tools`: o `input_schema` JSON é verboso e não útil para debug; o `name`
 *   é mantido (ver `redactProviderPayload`)
 */
export const REDACTED_FIELD_NAMES: ReadonlyArray<string> = [
  'system',
  'messages',
  'tools',
] as const;

/**
 * Subset seguro de um payload provider para logging/debugging.
 * Faz shallow copy e remove campos PII-bearing.
 *
 * @example
 *   logger.debug({ payload: redactProviderPayload(input), provider: 'anthropic' }, 'Provider call');
 */
export function redactProviderPayload<T extends Record<string, unknown>>(
  payload: T,
): Partial<T> {
  const safe: Partial<T> = {};
  for (const [k, v] of Object.entries(payload)) {
    if (REDACTED_FIELD_NAMES.includes(k)) continue;
    safe[k as keyof T] = v as T[keyof T];
  }
  return safe;
}

/**
 * Devolve apenas os nomes das tools (sem schemas) para debug útil sem PII.
 * Aceita tanto formato Anthropic (`{ name, description, input_schema }`) como
 * OpenAI (`{ type: 'function', function: { name } }`).
 */
export function redactToolNames(tools: unknown): string[] {
  if (!Array.isArray(tools)) return [];
  return tools
    .map((t) => {
      if (typeof t !== 'object' || t === null) return null;
      const obj = t as Record<string, unknown>;
      if (typeof obj.name === 'string') return obj.name;
      if (
        typeof obj.function === 'object' &&
        obj.function !== null &&
        typeof (obj.function as Record<string, unknown>).name === 'string'
      ) {
        return (obj.function as Record<string, unknown>).name as string;
      }
      return null;
    })
    .filter((n): n is string => n !== null);
}
