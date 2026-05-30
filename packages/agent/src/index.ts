/**
 * Entry-point público do package `@meu-jarvis/agent`.
 *
 * Trace: Story 2.2 AC1 + AC2 + AC10.
 *
 * Exports:
 *   - Factory + Provider classes (Anthropic + OpenAI)
 *   - Contratos (Zod + tipos derivados)
 *   - Errors (toda a hierarquia)
 *   - Constantes default model
 *
 * NÃO exporta: helpers internos como `mapAnthropicError`, `redactProviderPayload`,
 * `withProviderSpan`, `CircuitBreaker`, `withRetry`. São intencionalmente
 * privados ao package — alterar a fronteira requer story dedicada.
 */
export { getProvider, resetProviderCache, isFallbackOpenAIEnabled, AnthropicProvider, OpenAIProvider } from './providers';
export type { ProviderInterface } from './providers';
export type { GetProviderOpts } from './providers';
export type { OpenAIClientLike } from './providers/openai';
export type { AnthropicClientLike } from './providers/anthropic';

export {
  ProviderCompleteInputSchema,
  ProviderCompleteOutputSchema,
  ProviderMessageSchema,
  ProviderToolCallSchema,
  MinimalToolDefinitionSchema,
  LlmModelSchema,
  FinishReasonSchema,
  CLAUDE_SONNET_DEFAULT,
  CLAUDE_HAIKU_DEFAULT,
  CLAUDE_HAIKU_MODEL_ENUM,
  OPENAI_GPT4O_MINI_DEFAULT,
} from './contracts';
export type {
  ProviderCompleteInput,
  ProviderCompleteOutput,
  ProviderMessage,
  ProviderToolCall,
  MinimalToolDefinition,
  LlmModel,
  FinishReason,
} from './contracts';
export type { AnthropicModel } from './pricing';

export {
  ProviderError,
  RateLimitError,
  TimeoutError,
  ServerError,
  NetworkError,
  AuthError,
  BadRequestError,
  ContentPolicyError,
  MissingApiKeyError,
  CircuitOpenError,
  mapOpenAIError,
  sanitizeHint,
} from './errors';
export type { ProviderId } from './errors';
