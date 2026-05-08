/**
 * OpenAIProvider — adaptador OpenAI GPT-4o-mini (fallback flag-gated).
 *
 * Trace: Story 2.2 AC4 + Architecture §4.2 (classifier).
 *
 * Comportamento:
 *   - SDK oficial `openai`
 *   - `cacheControl: 'ephemeral'` é silenciosamente IGNORADO (OpenAI não tem
 *     equivalente directo no MVP). `cacheHit` retorna sempre `false`.
 *   - Tools translation: input shape `{ name, description, input_schema }`
 *     converte para OpenAI `{ type: 'function', function: { name, description, parameters } }`.
 *   - Retry/backoff via `withRetry`
 *   - Circuit breaker per-process via `CircuitBreaker.getInstance('openai')`
 *   - OTel tracing via `withProviderSpan`
 *   - Error mapping via `mapOpenAIError`
 *
 * Construtor lança `MissingApiKeyError` se `OPENAI_API_KEY` ausente.
 */
import OpenAI from 'openai';

import {
  type LlmModel,
  type ProviderCompleteInput,
  type ProviderCompleteOutput,
  OPENAI_GPT4O_MINI_DEFAULT,
  ProviderCompleteInputSchema,
  ProviderCompleteOutputSchema,
} from '../contracts';
import { CircuitBreaker } from '../circuit-breaker';
import { MissingApiKeyError, mapOpenAIError, type ProviderId } from '../errors';
import { calculateOpenAICost } from '../pricing';
import { withRetry } from '../retry';
import { annotateProviderMetrics, withProviderSpan } from '../tracing';

import type { ProviderInterface } from './interface';

const PROVIDER: ProviderId = 'openai';

/**
 * Forma minimal do client OpenAI que este adaptador usa.
 */
export interface OpenAIClientLike {
  chat: { completions: { create: (params: Record<string, unknown>) => Promise<unknown> } };
}

interface OpenAIProviderOpts {
  readonly model?: LlmModel;
  readonly apiKeyOverride?: string;
  readonly clientOverride?: OpenAIClientLike;
  readonly disableCircuitBreaker?: boolean;
  readonly retryOpts?: Parameters<typeof withRetry>[1];
}

export class OpenAIProvider implements ProviderInterface {
  public readonly id: ProviderId = PROVIDER;
  public readonly model: LlmModel;
  private readonly client: OpenAIClientLike;
  private readonly circuitBreaker: CircuitBreaker | null;
  private readonly retryOpts: Parameters<typeof withRetry>[1];

  constructor(opts: OpenAIProviderOpts = {}) {
    this.model = opts.model ?? OPENAI_GPT4O_MINI_DEFAULT;

    const apiKey = opts.apiKeyOverride ?? process.env.OPENAI_API_KEY;
    if (apiKey === undefined || apiKey.trim() === '') {
      if (opts.clientOverride === undefined) {
        throw new MissingApiKeyError(PROVIDER);
      }
    }

    this.client = opts.clientOverride ?? (new OpenAI({ apiKey: apiKey ?? 'unset' }) as unknown as OpenAIClientLike);
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
          const sdkResponse = await this.callOpenAI(validated);
          const latencyMs = Date.now() - start;
          const mapped = mapOpenAIResponse(this.model, sdkResponse, latencyMs);
          return ProviderCompleteOutputSchema.parse(mapped);
        } catch (err) {
          throw mapOpenAIError(err);
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
        cacheHit: false,
        retryCount,
        fallbackUsed: false,
        traceId: validated.traceId,
      });
      return result;
    });
  }

  private async callOpenAI(input: ProviderCompleteInput): Promise<OpenAIChatCompletion> {
    const messages = [
      { role: 'system' as const, content: input.system },
      ...input.messages.map((m) => ({ role: m.role, content: m.content })),
    ];

    const params: Record<string, unknown> = {
      model: this.model,
      messages,
      max_tokens: input.maxTokens ?? 4096,
      temperature: input.temperature ?? 0,
    };

    const tools = toOpenAIToolParam(input.tools);
    if (tools !== undefined) {
      params.tools = tools;
      params.tool_choice = 'auto';
    }

    return (await this.client.chat.completions.create(params)) as OpenAIChatCompletion;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

interface OpenAIChatCompletion {
  readonly choices?: ReadonlyArray<{
    readonly message?: {
      readonly content?: string | null;
      readonly tool_calls?: ReadonlyArray<{
        readonly type: 'function';
        readonly function: { readonly name: string; readonly arguments: string };
      }>;
    };
    readonly finish_reason?: 'stop' | 'length' | 'tool_calls' | 'content_filter' | string;
  }>;
  readonly usage?: {
    readonly prompt_tokens?: number;
    readonly completion_tokens?: number;
  };
}

function toOpenAIToolParam(tools: ProviderCompleteInput['tools']): unknown[] | undefined {
  if (tools === undefined || tools.length === 0) return undefined;
  return tools.map((t) => ({
    type: 'function' as const,
    function: {
      name: t.name,
      description: t.description,
      parameters: t.input_schema,
    },
  }));
}

function mapOpenAIResponse(
  model: LlmModel,
  resp: OpenAIChatCompletion,
  latencyMs: number,
): ProviderCompleteOutput {
  const choice = resp.choices?.[0];
  const message = choice?.message;
  const tokensInput = resp.usage?.prompt_tokens ?? 0;
  const tokensOutput = resp.usage?.completion_tokens ?? 0;
  const cost = calculateOpenAICost(tokensInput, tokensOutput);

  const toolCalls: ProviderCompleteOutput['toolCalls'] = [];
  for (const tc of message?.tool_calls ?? []) {
    if (tc.type !== 'function') continue;
    let parsed: Record<string, unknown> = {};
    try {
      parsed = JSON.parse(tc.function.arguments) as Record<string, unknown>;
    } catch {
      // arguments mal-formados — emitir tool call vazio em vez de falhar.
      parsed = {};
    }
    toolCalls.push({ name: tc.function.name, input: parsed });
  }

  const finishReason: ProviderCompleteOutput['finishReason'] =
    choice?.finish_reason === 'tool_calls'
      ? 'tool_use'
      : choice?.finish_reason === 'length'
        ? 'length'
        : choice?.finish_reason === 'stop'
          ? 'stop'
          : 'error';

  const content = message?.content ?? null;

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
    cacheHit: false,
  };
}
