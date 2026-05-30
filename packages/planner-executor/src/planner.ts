/**
 * `Planner` — Estágio 2 do pipeline AI multi-intent.
 *
 * Trace: Story 2.5 AC4 + AC5 + Architecture §4.3 (Planner — Sonnet com tool
 *        calling, prompt cache ephemeral) + FR3 (multi-intent até 5) + NFR1
 *        (latência) + NFR12 (PII).
 *
 * Fluxo de `plan(input)`:
 *   1. Validar `PlannerInputSchema.parse(input)` → `PlannerValidationError`.
 *   2. Early-return: classification `[{intent: 'unknown'}]` → plan vazio sem LLM.
 *   3. Construir `ProviderCompleteInput` com:
 *      - `system`: PLANNER_SYSTEM_PROMPT (cacheable)
 *      - `messages`: [{role:'user', content: serialize classification}]
 *      - `tools`: toolRegistry.getAnthropicToolDefinitions()
 *      - `cacheControl`: 'ephemeral' (D11 default — Architecture §4.3)
 *      - `temperature`: 0.2 (mais conservador que classifier 0)
 *      - `maxTokens`: 1024
 *   4. Invocar `provider.complete(input)` via getProvider Anthropic.
 *   5. Validar tool names contra registry → `PlannerToolNotFoundError`.
 *   6. Mapear toolCalls + intent via TOOL_TO_INTENT_MAP (D6).
 *   7. Construir `PlanResult` com cost/tokens/cacheHit propagados.
 *   8. Detectar empty plan → `PlannerEmptyPlanError` (warn).
 *   9. Retry 1× temperature=0 para `PlannerOutputError`.
 *
 * Mockability: opts.client permite injectar `AnthropicClientLike` (re-exposto
 * por D9-anthropic na Task 2). Em produção `getProvider({preferredProvider:
 * 'anthropic'})` resolve via factory da 2.2.
 */
import {
  AnthropicProvider,
  CLAUDE_HAIKU_MODEL_ENUM,
  ProviderError,
  type AnthropicClientLike,
  type AnthropicModel,
  type LlmModel,
  type ProviderCompleteInput,
  type ProviderCompleteOutput,
  type ProviderInterface,
} from '@meu-jarvis/agent';
import { logger } from '@meu-jarvis/observability';
import { toolRegistry, ToolNotFoundError, type ToolRegistry } from '@meu-jarvis/tools';

import {
  PlannerEmptyPlanError,
  PlannerLLMError,
  PlannerOutputError,
  PlannerToolNotFoundError,
  PlannerValidationError,
} from './errors';
import { PLANNER_SYSTEM_PROMPT } from './prompts/planner-system';
import {
  PlanResultSchema,
  PlannerInputSchema,
  resolveIntentFromToolName,
  type PlanResult,
  type PlanToolCall,
  type PlannerInput,
} from './schemas';
import {
  annotatePlannerMetrics,
  withPlannerSpan,
} from './tracing';

// ─────────────────────────────────────────────────────────────────────────────
// Configuração e tipos públicos
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Default `maxTokens` para a chamada Anthropic — 1024 tokens é suficiente
 * para 10 tool calls × ~80 tokens/call + reasoning curto.
 */
export const DEFAULT_PLANNER_MAX_TOKENS = 1024;

/**
 * Default `temperature` — 0.2 é conservador mas permite alguma variação no
 * tool selection (mais que classifier que é determinismo puro 0).
 */
export const DEFAULT_PLANNER_TEMPERATURE = 0.2;

/**
 * Default `timeoutMs` — 15s, alinhado com NFR1 latência p95 < 6s end-to-end
 * (planner sozinho deve ficar < 4s em regime estacionário).
 */
export const DEFAULT_PLANNER_TIMEOUT_MS = 15_000;

/**
 * Opções do constructor `Planner`.
 *
 * `client` permite injecção em testes — em produção é resolvido via
 * `getProvider({preferredProvider:'anthropic'})` no constructor.
 *
 * `registry` permite injecção em testes — em produção usa singleton
 * `toolRegistry` da 2.3.
 */
export interface PlannerOpts {
  readonly client?: AnthropicClientLike;
  readonly registry?: ToolRegistry;
  readonly maxTokens?: number;
  readonly temperature?: number;
  readonly timeoutMs?: number;
  /**
   * `cacheControl` default `'ephemeral'` (D11 — Architecture §4.3 ~90% saving).
   * `null` desliga cache (apenas para testes/debug).
   */
  readonly cacheControl?: 'ephemeral' | null;
  /** Override do model — default `claude-haiku-4-5` (Story 2.12). */
  readonly model?: LlmModel;
}

// ─────────────────────────────────────────────────────────────────────────────
// Classe Planner
// ─────────────────────────────────────────────────────────────────────────────

export class Planner {
  private readonly provider: ProviderInterface;
  private readonly registry: ToolRegistry;
  private readonly maxTokens: number;
  private readonly temperature: number;
  private readonly cacheControl: 'ephemeral' | null;
  // O Planner usa sempre um provider Anthropic — `model` é um `AnthropicModel`
  // (exclui o classifier OpenAI `gpt-4o-mini`).
  private readonly model: AnthropicModel;

  constructor(opts: PlannerOpts = {}) {
    this.maxTokens = opts.maxTokens ?? DEFAULT_PLANNER_MAX_TOKENS;
    this.temperature = opts.temperature ?? DEFAULT_PLANNER_TEMPERATURE;
    // CacheControl: aceitar `null` explícito (override desliga) e `undefined`/missing → default 'ephemeral'.
    // `??` trata null como nullish, então usar comparação explícita.
    this.cacheControl = opts.cacheControl === undefined ? 'ephemeral' : opts.cacheControl;
    // Story 2.12: default do Executor passou de Sonnet → Haiku 4.5 (short-form
    // do enum, alias válido da API Anthropic). O override `opts.model` continua
    // a aceitar Sonnet/Opus. Sem esta mudança, a coluna agent_runs.executor_model
    // (escrita como 'claude-haiku-4-5' pelos route handlers, AC5) ficaria
    // incoerente com o modelo realmente usado.
    // `gpt-4o-mini` (classifier OpenAI) não é um executor Anthropic válido —
    // se passado por engano, cai no default Haiku.
    this.model =
      opts.model === undefined || opts.model === 'gpt-4o-mini'
        ? CLAUDE_HAIKU_MODEL_ENUM
        : opts.model;
    this.registry = opts.registry ?? toolRegistry;

    if (opts.client !== undefined) {
      // Modo de teste: client mocked — usa AnthropicProvider directamente
      // com clientOverride (Story 2.2 AC3 disponibiliza este hook).
      this.provider = new AnthropicProvider({
        clientOverride: opts.client,
        model: this.model,
        disableCircuitBreaker: true,
      });
    } else {
      // Modo de produção: factory canónica da 2.2 com cache de instâncias.
      // Lazy import para evitar resolver providers em testes mocked.
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const { getProvider } = require('@meu-jarvis/agent') as { getProvider: typeof import('@meu-jarvis/agent').getProvider };
      this.provider = getProvider({ preferredProvider: 'anthropic', model: this.model });
    }
  }

  /**
   * Constrói um tool plan a partir de uma `ClassificationResult` validada.
   *
   * @param input - PlannerInput com classification + ctx (households/user/run/trace).
   * @returns PlanResult com toolCalls + métricas.
   * @throws {PlannerValidationError} input estruturalmente inválido
   * @throws {PlannerLLMError} provider rate limit / timeout / network / etc.
   * @throws {PlannerToolNotFoundError} Sonnet alucinou tool name fora do registry
   * @throws {PlannerOutputError} output Sonnet não passa schema (após retry 1×)
   * @throws {PlannerEmptyPlanError} Sonnet retornou [] mas intents != [unknown]
   */
  async plan(input: PlannerInput): Promise<PlanResult> {
    return withPlannerSpan(async (span) => {
      const start = Date.now();
      const validated = this.validateInput(input);

      // Step 2: Early-return para classification puramente unknown
      const intents = validated.classification.intents;
      const allUnknown = intents.every((i) => i.intent === 'unknown');
      if (allUnknown) {
        const result: PlanResult = {
          toolCalls: [],
          planReasoning: 'Intent unknown — sem tools a executar.',
          latencyMs: 0,
          tokensInput: 0,
          tokensOutput: 0,
          costEur: 0,
          cacheHit: false,
        };
        annotatePlannerMetrics(span, {
          model: this.model,
          intentCount: intents.length,
          intentUniqueTypes: this.uniqueIntentTypes(intents),
          toolCallCount: 0,
          cacheHit: false,
          durationMs: Date.now() - start,
          tokensInput: 0,
          tokensOutput: 0,
          costEur: 0,
          householdId: validated.householdId,
        });
        return result;
      }

      // Step 3-7: Chamada LLM com retry 1× para PlannerOutputError
      let lastOutputError: PlannerOutputError | undefined;
      for (let attempt = 0; attempt < 2; attempt += 1) {
        try {
          const output = await this.callProvider(validated, attempt > 0 ? 0 : this.temperature);
          const result = this.mapOutput(output, validated, start);
          annotatePlannerMetrics(span, {
            model: this.model,
            intentCount: intents.length,
            intentUniqueTypes: this.uniqueIntentTypes(intents),
            toolCallCount: result.toolCalls.length,
            cacheHit: result.cacheHit,
            durationMs: result.latencyMs,
            tokensInput: result.tokensInput,
            tokensOutput: result.tokensOutput,
            costEur: result.costEur,
            householdId: validated.householdId,
          });
          // Step 8: Detectar empty plan degenerado (intents != [unknown] mas LLM retornou [])
          if (result.toolCalls.length === 0) {
            const nonUnknownCount = intents.filter((i) => i.intent !== 'unknown').length;
            if (nonUnknownCount > 0) {
              const err = new PlannerEmptyPlanError(nonUnknownCount);
              logger.warn({ intentCount: nonUnknownCount, traceId: validated.traceId }, 'Planner empty plan degenerado');
              throw err;
            }
          }
          return result;
        } catch (err) {
          if (err instanceof PlannerOutputError && attempt === 0) {
            lastOutputError = err;
            continue; // retry com temperature=0
          }
          throw err;
        }
      }
      // Não deveria chegar aqui — se chegou, retry esgotou
      throw lastOutputError ?? new PlannerOutputError('retry esgotado sem PlannerOutputError capturado');
    });
  }

  // ───────────────────────────────────────────────────────────────────────────
  // Internals
  // ───────────────────────────────────────────────────────────────────────────

  private validateInput(input: PlannerInput): PlannerInput {
    const parsed = PlannerInputSchema.safeParse(input);
    if (!parsed.success) {
      const issue = parsed.error.issues[0];
      throw new PlannerValidationError(
        issue?.path.join('.') ?? 'unknown',
        issue?.message ?? 'PlannerInputSchema parse failed',
      );
    }
    return parsed.data;
  }

  private uniqueIntentTypes(intents: ReadonlyArray<{ intent: string }>): number {
    const set = new Set<string>();
    for (const i of intents) set.add(i.intent);
    return set.size;
  }

  private async callProvider(
    input: PlannerInput,
    temperature: number,
  ): Promise<ProviderCompleteOutput> {
    const tools = this.registry.getAnthropicToolDefinitions();
    // Story 2.13 AC6 (ADR-002 §9.1/§9.4): o accountContext é injectado como
    // PREFIXO da user message — NUNCA no `system`/`tools` (preserva o prefixo
    // cacheável da Anthropic). Os nomes de conta viajam em `messages`, logo são
    // cobertos por `redactProviderPayload` (NFR12) por construção.
    const accountContextPrefix = serializeAccountContextForPlanner(input.accountContext);
    const userMessage = `${accountContextPrefix}${serializeClassificationForPlanner(input.classification)}`;

    const providerInput: ProviderCompleteInput = {
      system: PLANNER_SYSTEM_PROMPT,
      messages: [{ role: 'user', content: userMessage }],
      tools: tools.map((t) => ({
        name: t.name,
        description: t.description,
        input_schema: t.input_schema,
      })),
      cacheControl: this.cacheControl,
      temperature,
      maxTokens: this.maxTokens,
      traceId: input.traceId,
      householdId: input.householdId,
    };

    try {
      return await this.provider.complete(providerInput);
    } catch (err) {
      if (err instanceof ProviderError) {
        throw new PlannerLLMError(err);
      }
      // Erros não-ProviderError (ex: Zod fail no input) — re-throw como output error
      // para captura pelo retry. Mensagem genérica anti-PII.
      throw new PlannerOutputError(`provider devolveu erro não-mapeado: ${err instanceof Error ? err.name : 'unknown'}`);
    }
  }

  private mapOutput(
    output: ProviderCompleteOutput,
    input: PlannerInput,
    startMs: number,
  ): PlanResult {
    // Validar cada tool name contra registry — defense-in-depth (Planner step 5)
    for (const call of output.toolCalls) {
      try {
        this.registry.get(call.name);
      } catch (err) {
        if (err instanceof ToolNotFoundError) {
          throw new PlannerToolNotFoundError(call.name);
        }
        throw err;
      }
    }

    const toolCalls: PlanToolCall[] = output.toolCalls.map((call) => ({
      toolName: call.name,
      input: call.input as Record<string, unknown>,
      intent: resolveIntentFromToolName(call.name),
    }));

    const candidate: PlanResult = {
      toolCalls,
      planReasoning: output.content,
      latencyMs: output.latencyMs > 0 ? output.latencyMs : Date.now() - startMs,
      tokensInput: output.tokensInput,
      tokensOutput: output.tokensOutput,
      costEur: output.costEur,
      cacheHit: output.cacheHit,
    };

    const parsed = PlanResultSchema.safeParse(candidate);
    if (!parsed.success) {
      const issue = parsed.error.issues[0];
      throw new PlannerOutputError(
        `${issue?.path.join('.') ?? 'unknown'}: ${issue?.message ?? 'PlanResultSchema parse failed'}`,
      );
    }
    return parsed.data;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Helper de serialização de classification para user message
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Serializa uma `ClassificationResult` para texto PT-PT que o Sonnet recebe
 * como user message. Inclui apenas `intent`, `confidence`, e `raw_span` —
 * mas `raw_span` foi já validado pela 2.4 como sub-string do prompt original
 * do utilizador, sem PII adicional além do que o utilizador escolheu enviar.
 *
 * **Importante**: o prompt original do utilizador NÃO é re-enviado nesta
 * camada — o Planner trabalha apenas com a classificação validada.
 */
/**
 * Serializa o `accountContext` (contas/cartões do household) num prefixo
 * compacto PT-PT para anteceder a user message (Story 2.13 AC6 / ADR-002 §9.4).
 *
 * Formato denso — uma linha por categoria, ids inline para o LLM resolver
 * desambiguação ("cartão Millennium" → id). Retorna string vazia (sem prefixo)
 * quando `accountContext` é ausente ou ambas as listas estão vazias
 * (utilizador novo pré-backfill; o fallback `resolveDefaultAccount` da peça B
 * resolve a jusante).
 *
 * Os nomes de conta/cartão aqui são PII ligeira — viajam em `messages`, logo
 * cobertos por `redactProviderPayload` (NFR12). NÃO entram em span attributes.
 */
function serializeAccountContextForPlanner(
  accountContext: PlannerInput['accountContext'],
): string {
  if (
    accountContext === undefined ||
    (accountContext.accounts.length === 0 && accountContext.cards.length === 0)
  ) {
    return '';
  }

  const lines: string[] = ['[Contexto de contas do household]'];
  if (accountContext.accounts.length > 0) {
    const items = accountContext.accounts
      .map((a) => `${a.name} (${a.id})`)
      .join(', ');
    lines.push(`Contas: ${items}`);
  }
  if (accountContext.cards.length > 0) {
    const items = accountContext.cards.map((c) => `${c.name} (${c.id})`).join(', ');
    lines.push(`Cartões: ${items}`);
  }
  lines.push(
    'Se o utilizador não indicar conta nem cartão, OMITE accountId/cardId (a tool usa a conta por defeito).',
  );
  lines.push('');
  lines.push('');
  return lines.join('\n');
}

function serializeClassificationForPlanner(classification: PlannerInput['classification']): string {
  const lines: string[] = ['Classificação validada (Estágio 1):', ''];
  for (const [idx, intent] of classification.intents.entries()) {
    lines.push(`${idx + 1}. intent: ${intent.intent}, confidence: ${intent.confidence.toFixed(2)}, raw_span: "${intent.raw_span}"`);
  }
  lines.push('');
  lines.push(`overall_confidence: ${classification.overall_confidence.toFixed(2)}`);
  lines.push(`needs_confirmation: ${classification.needs_confirmation}`);
  lines.push('');
  lines.push('Constrói o tool plan correspondente usando tool_use. Se uma intent não tem tool registada, devolve plan vazio com reasoning explicativo.');
  return lines.join('\n');
}
