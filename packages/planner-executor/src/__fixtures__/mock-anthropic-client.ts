/**
 * Mock determinístico de `AnthropicClientLike` para testes do Planner.
 *
 * Trace: Story 2.5 AC12 + padrão mockability 2.2 AC10 + 2.4 AC11.
 *
 * O mock recebe um mapa de `{userMessageSubstring → MockResponse}` e retorna
 * uma resposta SDK Anthropic forjada quando o lookup bate. Permite testar:
 *   - Happy-path com 1, 2, 3 tool calls
 *   - Cache hit/miss
 *   - Erros (rate limit, timeout, network) — lançando subclasses de
 *     `ProviderError` que o `AnthropicProvider.complete` mapeia
 *
 * Importante: o mock NÃO substitui `AnthropicProvider` — substitui o SDK
 * que o provider usa internamente. O `AnthropicProvider` continua a aplicar
 * `cache_control: ephemeral`, retry, circuit breaker, mapping de errors.
 */
import type { AnthropicClientLike } from '@meu-jarvis/agent';

/**
 * Resposta SDK Anthropic forjada (forma simplificada da API real).
 */
export interface MockAnthropicResponse {
  readonly content: Array<
    | { type: 'tool_use'; id: string; name: string; input: Record<string, unknown> }
    | { type: 'text'; text: string }
  >;
  readonly usage: {
    readonly input_tokens: number;
    readonly output_tokens: number;
    readonly cache_read_input_tokens?: number;
    readonly cache_creation_input_tokens?: number;
  };
  readonly stop_reason: 'tool_use' | 'end_turn' | 'max_tokens' | 'stop_sequence';
}

/**
 * Erro forjado para simular falhas SDK Anthropic. O `AnthropicProvider`
 * mapeia via `mapAnthropicError` (Story 2.2 AC7).
 */
export interface MockAnthropicError {
  readonly status?: number;
  readonly name?: string;
  readonly message: string;
  readonly headers?: Record<string, string>;
}

/**
 * Lookup configurável: `(params) → MockAnthropicResponse | Error`.
 *
 * `params` é o objecto literal passado a `client.messages.create(params)`.
 * O mock pode inspeccionar `params.system`, `params.messages`, `params.tools`,
 * `params.temperature`, etc.
 */
export type MockResolver = (
  params: Record<string, unknown>,
) => MockAnthropicResponse | Error | Promise<MockAnthropicResponse | Error>;

/**
 * Cria um mock `AnthropicClientLike` que delega cada chamada
 * `messages.create` ao `resolver` fornecido.
 *
 * Uso típico em testes:
 * ```ts
 * const client = createMockAnthropicClient((params) => ({
 *   content: [{ type: 'tool_use', id: 'toolu_1', name: 'create_task', input: { title: 'Reunião' } }],
 *   usage: { input_tokens: 500, output_tokens: 50, cache_read_input_tokens: 450 },
 *   stop_reason: 'tool_use',
 * }));
 *
 * const planner = new Planner({ client });
 * ```
 */
export function createMockAnthropicClient(resolver: MockResolver): AnthropicClientLike {
  return {
    messages: {
      create: async (params: Record<string, unknown>) => {
        const result = await resolver(params);
        if (result instanceof Error) {
          throw result;
        }
        return result;
      },
    },
  };
}

/**
 * Helper para construir uma resposta happy-path simples com 1+ tool calls.
 */
export function buildToolUseResponse(
  toolCalls: Array<{ name: string; input: Record<string, unknown>; id?: string }>,
  opts: {
    inputTokens?: number;
    outputTokens?: number;
    cacheReadTokens?: number;
    cacheWriteTokens?: number;
    reasoningText?: string;
  } = {},
): MockAnthropicResponse {
  const content: MockAnthropicResponse['content'] = toolCalls.map((tc, idx) => ({
    type: 'tool_use' as const,
    id: tc.id ?? `toolu_${idx + 1}`,
    name: tc.name,
    input: tc.input,
  }));
  if (opts.reasoningText !== undefined) {
    content.push({ type: 'text', text: opts.reasoningText });
  }
  return {
    content,
    usage: {
      input_tokens: opts.inputTokens ?? 100,
      output_tokens: opts.outputTokens ?? 50,
      cache_read_input_tokens: opts.cacheReadTokens ?? 0,
      cache_creation_input_tokens: opts.cacheWriteTokens ?? 0,
    },
    stop_reason: 'tool_use',
  };
}

/**
 * Helper para construir resposta sem tool_use (planReasoning + end_turn).
 */
export function buildEmptyResponse(reasoningText = 'Sem tools a executar.'): MockAnthropicResponse {
  return {
    content: [{ type: 'text', text: reasoningText }],
    usage: { input_tokens: 100, output_tokens: 30 },
    stop_reason: 'end_turn',
  };
}

/**
 * Constrói um erro SDK forjado para testar mapping em `mapAnthropicError`.
 */
export function buildSdkError(opts: MockAnthropicError): Error {
  const err = new Error(opts.message);
  Object.assign(err, opts);
  if (opts.name !== undefined) {
    err.name = opts.name;
  }
  return err;
}
