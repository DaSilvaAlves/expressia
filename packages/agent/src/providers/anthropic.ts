/**
 * AnthropicProvider — adaptador Anthropic Sonnet (provider primary).
 *
 * Trace: Story 2.2 AC3 + Architecture §4.3 (prompt caching) + §12.2 (NFR11).
 *
 * Features:
 *   - SDK oficial `@anthropic-ai/sdk`
 *   - Prompt caching via `cache_control: ephemeral` no system + tools
 *   - Cost calculation via `pricing.ts`
 *   - Retry/backoff exponencial via `withRetry`
 *   - Circuit breaker per-process via `CircuitBreaker.getInstance('anthropic')`
 *   - OTel tracing via `withProviderSpan`
 *   - Error mapping via `mapAnthropicError`
 *
 * O construtor lança `MissingApiKeyError` se `ANTHROPIC_API_KEY` ausente.
 */
import Anthropic from '@anthropic-ai/sdk';

import {
  type ProviderCompleteInput,
  type ProviderCompleteOutput,
  CLAUDE_HAIKU_DEFAULT,
  CLAUDE_HAIKU_MODEL_ENUM,
  ProviderCompleteInputSchema,
  ProviderCompleteOutputSchema,
} from '../contracts';
import type { AnthropicModel } from '../pricing';
import { CircuitBreaker } from '../circuit-breaker';
import { MissingApiKeyError, mapAnthropicError, type ProviderId } from '../errors';
import { calculateAnthropicCost } from '../pricing';
import { withRetry } from '../retry';
import { annotateProviderMetrics, withProviderSpan } from '../tracing';

import type { ProviderInterface } from './interface';

const PROVIDER: ProviderId = 'anthropic';

/**
 * Forma minimal do client Anthropic que este adaptador usa.
 * Permite mocks tipados em tests sem coupling pesado ao SDK.
 */
export interface AnthropicClientLike {
  messages: { create: (params: Record<string, unknown>) => Promise<unknown> };
}

interface AnthropicProviderOpts {
  /** Override do modelo Anthropic. Default Story 2.12: Haiku 4.5. */
  readonly model?: AnthropicModel;
  /** Override de API key — usado apenas em tests. Default: env. */
  readonly apiKeyOverride?: string;
  /** Override do client SDK — para mocks em tests sem precisar de `vi.mock`. */
  readonly clientOverride?: AnthropicClientLike;
  /** Disable circuit breaker (apenas tests). Default false. */
  readonly disableCircuitBreaker?: boolean;
  /** Override de retry opts (e.g. tests com `random: () => 0.5`). */
  readonly retryOpts?: Parameters<typeof withRetry>[1];
}

export class AnthropicProvider implements ProviderInterface {
  public readonly id: ProviderId = PROVIDER;
  /**
   * Modelo reportado em telemetria/output e gravado na coluna enum
   * `agent_runs.executor_model` — sempre um `AnthropicModel` (subconjunto de
   * `LlmModel` que exclui o classifier OpenAI; short-form do enum).
   */
  public readonly model: AnthropicModel;
  /**
   * Identificador efectivo passado ao SDK Anthropic. Para o default Haiku é o
   * API ID full-form (`claude-haiku-4-5-20251001`); para overrides é igual ao
   * `model`. Story 2.12 — separação enum short-form vs API ID.
   */
  private readonly wireModel: string;
  private readonly client: AnthropicClientLike;
  private readonly circuitBreaker: CircuitBreaker | null;
  private readonly retryOpts: Parameters<typeof withRetry>[1];

  constructor(opts: AnthropicProviderOpts = {}) {
    if (opts.model === undefined) {
      // Default Story 2.12: Haiku 4.5. Reporta o short-form do enum; chama a API
      // com o API ID full-form.
      this.model = CLAUDE_HAIKU_MODEL_ENUM;
      this.wireModel = CLAUDE_HAIKU_DEFAULT;
    } else {
      this.model = opts.model;
      this.wireModel = opts.model;
    }

    const apiKey = opts.apiKeyOverride ?? process.env.ANTHROPIC_API_KEY;
    if (apiKey === undefined || apiKey.trim() === '') {
      // Permitir construção em tests via clientOverride (mocks) sem key.
      if (opts.clientOverride === undefined) {
        throw new MissingApiKeyError(PROVIDER);
      }
    }

    this.client = opts.clientOverride ?? (new Anthropic({ apiKey: apiKey ?? 'unset' }) as unknown as AnthropicClientLike);
    this.circuitBreaker = opts.disableCircuitBreaker
      ? null
      : CircuitBreaker.getInstance(PROVIDER);
    this.retryOpts = opts.retryOpts ?? {};
  }

  async complete(input: ProviderCompleteInput): Promise<ProviderCompleteOutput> {
    const validated = ProviderCompleteInputSchema.parse(input);

    return withProviderSpan(this.id, this.model, async (span) => {
      let retryCount = 0;
      const onRetry = () => {
        retryCount += 1;
      };

      const callOnce = async (): Promise<ProviderCompleteOutput> => {
        const start = Date.now();
        try {
          const sdkResponse = await this.callAnthropic(validated);
          const latencyMs = Date.now() - start;
          const mapped = mapAnthropicResponse(this.model, sdkResponse, latencyMs);
          return ProviderCompleteOutputSchema.parse(mapped);
        } catch (err) {
          throw mapAnthropicError(err);
        }
      };

      const wrapped = async (): Promise<ProviderCompleteOutput> => {
        return withRetry(callOnce, { ...this.retryOpts, onRetry });
      };

      const result = this.circuitBreaker !== null
        ? await this.circuitBreaker.execute(wrapped)
        : await wrapped();

      annotateProviderMetrics(span, {
        tokensInput: result.tokensInput,
        tokensOutput: result.tokensOutput,
        costEur: result.costEur,
        latencyMs: result.latencyMs,
        cacheHit: result.cacheHit,
        retryCount,
        fallbackUsed: false,
        traceId: validated.traceId,
      });
      return result;
    });
  }

  // ───────────────────────────────────────────────────────────────────────────
  // Internals
  // ───────────────────────────────────────────────────────────────────────────

  private async callAnthropic(input: ProviderCompleteInput): Promise<AnthropicMessagesResponse> {
    const systemBlocks = buildSystemBlocks(input);
    const tools = buildToolsParam(input);

    const params: Record<string, unknown> = {
      model: this.wireModel,
      max_tokens: input.maxTokens ?? 4096,
      temperature: input.temperature ?? 0,
      system: systemBlocks,
      messages: input.messages.map((m) => ({ role: m.role, content: m.content })),
    };
    if (tools !== undefined) params.tools = tools;

    return (await this.client.messages.create(params)) as AnthropicMessagesResponse;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Helpers de construção do payload Anthropic
// ─────────────────────────────────────────────────────────────────────────────

interface AnthropicUsage {
  readonly input_tokens?: number;
  readonly output_tokens?: number;
  readonly cache_read_input_tokens?: number;
  readonly cache_creation_input_tokens?: number;
}

interface AnthropicMessagesResponse {
  readonly content?: ReadonlyArray<{
    readonly type: 'text' | 'tool_use';
    readonly text?: string;
    readonly id?: string;
    readonly name?: string;
    readonly input?: Record<string, unknown>;
  }>;
  readonly usage?: AnthropicUsage;
  readonly stop_reason?: 'end_turn' | 'max_tokens' | 'tool_use' | 'stop_sequence' | string;
}

function buildSystemBlocks(input: ProviderCompleteInput): unknown {
  if (input.cacheControl !== 'ephemeral') {
    return input.system;
  }
  // Marca o system prompt para caching ephemeral (5min TTL).
  return [
    {
      type: 'text',
      text: input.system,
      cache_control: { type: 'ephemeral' },
    },
  ];
}

function buildToolsParam(input: ProviderCompleteInput): unknown[] | undefined {
  if (input.tools === undefined || input.tools.length === 0) return undefined;
  const last = input.tools.length - 1;
  return input.tools.map((t, idx) => {
    const base: Record<string, unknown> = {
      name: t.name,
      description: t.description,
      input_schema: t.input_schema,
    };
    // Cache_control aplicado ao último tool propaga cache para todo o array
    // de tool definitions (Anthropic semantics).
    if (input.cacheControl === 'ephemeral' && idx === last) {
      base.cache_control = { type: 'ephemeral' };
    }
    return base;
  });
}

function mapAnthropicResponse(
  model: AnthropicModel,
  resp: AnthropicMessagesResponse,
  latencyMs: number,
): ProviderCompleteOutput {
  const usage = resp.usage ?? {};
  const tokensInputRegular = usage.input_tokens ?? 0;
  const tokensInputCacheRead = usage.cache_read_input_tokens ?? 0;
  const tokensInputCacheWrite = usage.cache_creation_input_tokens ?? 0;
  const tokensOutput = usage.output_tokens ?? 0;
  const cacheHit = tokensInputCacheRead > 0;

  const cost = calculateAnthropicCost(
    model,
    tokensInputRegular,
    tokensInputCacheRead,
    tokensInputCacheWrite,
    tokensOutput,
  );

  const blocks = resp.content ?? [];
  const textParts: string[] = [];
  const toolCalls: ProviderCompleteOutput['toolCalls'] = [];
  for (const block of blocks) {
    if (block.type === 'text' && typeof block.text === 'string') {
      textParts.push(block.text);
    } else if (block.type === 'tool_use' && typeof block.name === 'string') {
      toolCalls.push({ name: block.name, input: block.input ?? {} });
    }
  }

  const content = textParts.length > 0 ? textParts.join('\n') : null;

  const finishReason: ProviderCompleteOutput['finishReason'] =
    resp.stop_reason === 'tool_use'
      ? 'tool_use'
      : resp.stop_reason === 'max_tokens'
        ? 'length'
        : resp.stop_reason === 'end_turn' || resp.stop_reason === 'stop_sequence'
          ? 'stop'
          : 'error';

  // tokensInput total = regular + cache_read + cache_write (todos contam para
  // a métrica de input). Architecture §4.6 trata cache hits para cost routing
  // mas nesta abstracção devolvemos o total para o caller decidir.
  const tokensInput = tokensInputRegular + tokensInputCacheRead + tokensInputCacheWrite;

  return {
    provider: PROVIDER,
    model,
    content,
    toolCalls,
    finishReason,
    tokensInput,
    tokensOutput,
    costEur: cost.costEur,
    latencyMs,
    cacheHit,
  };
}
