/**
 * Factory de providers — selecciona Anthropic (default) ou OpenAI (fallback
 * flag-gated ou explicit override).
 *
 * Trace: Story 2.2 AC4 + EPIC-2-EXECUTION ED6 (DP4: B fallback flag-gated Fase 2).
 *
 * Lógica de selecção (ordem):
 *   1. `preferredProvider === 'openai'` → `OpenAIProvider` (Story 2.4 Classifier)
 *   2. `AGENT_FALLBACK_OPENAI_ENABLED === 'true'` AND CB Anthropic open
 *      → `OpenAIProvider` (`fallbackUsed: true`)
 *   3. Default → `AnthropicProvider`
 *
 * Singletons lazy per `(provider, model)` tuple.
 */
import { CircuitBreaker } from '../circuit-breaker';
import type { LlmModel } from '../contracts';

import { AnthropicProvider } from './anthropic';
import type { ProviderInterface } from './interface';
import { OpenAIProvider } from './openai';

export interface GetProviderOpts {
  /** Force selecção de um provider específico (caso Classifier Story 2.4). */
  readonly preferredProvider?: 'anthropic' | 'openai';
  /** Override de modelo. Default depende do provider. */
  readonly model?: LlmModel;
}

/**
 * Reset cache de instâncias — usado em tests.
 */
export function resetProviderCache(): void {
  providerCache.clear();
}

const providerCache = new Map<string, ProviderInterface>();

function cacheKey(providerId: 'anthropic' | 'openai', model: LlmModel | undefined): string {
  return `${providerId}::${model ?? 'default'}`;
}

/**
 * Verifica se a flag de fallback OpenAI está activa via env.
 * Exposto para tests overridem facilmente.
 */
export function isFallbackOpenAIEnabled(): boolean {
  return process.env.AGENT_FALLBACK_OPENAI_ENABLED === 'true';
}

/**
 * Retorna o provider apropriado.
 *
 * Throws `MissingApiKeyError` se a key necessária não estiver em runtime.
 */
export function getProvider(opts: GetProviderOpts = {}): ProviderInterface {
  const providerId = resolveProviderId(opts);
  const key = cacheKey(providerId, opts.model);
  const cached = providerCache.get(key);
  if (cached !== undefined) return cached;

  // O AnthropicProvider só aceita modelos Anthropic (`AnthropicModel`); o
  // classifier OpenAI `gpt-4o-mini` nunca deve chegar aqui via branch anthropic.
  // Quando `opts.model` é `gpt-4o-mini` (ou undefined) passamos `undefined` para
  // o provider escolher o seu default (Story 2.12: Haiku 4.5).
  const anthropicModel =
    opts.model === undefined || opts.model === 'gpt-4o-mini' ? undefined : opts.model;
  const created: ProviderInterface =
    providerId === 'openai'
      ? new OpenAIProvider({ model: opts.model })
      : new AnthropicProvider({ model: anthropicModel });
  providerCache.set(key, created);
  return created;
}

function resolveProviderId(opts: GetProviderOpts): 'anthropic' | 'openai' {
  if (opts.preferredProvider === 'openai') return 'openai';
  if (opts.preferredProvider === 'anthropic') return 'anthropic';
  // Fallback flag-gated: só fallback se circuit Anthropic estiver open.
  if (isFallbackOpenAIEnabled() && CircuitBreaker.getInstance('anthropic').isOpen()) {
    return 'openai';
  }
  return 'anthropic';
}

export { AnthropicProvider } from './anthropic';
export { OpenAIProvider } from './openai';
export type { ProviderInterface } from './interface';
