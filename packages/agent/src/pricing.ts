/**
 * Constantes de pricing para Anthropic Sonnet 4.5, Anthropic Haiku 4.5 e
 * OpenAI GPT-4o-mini.
 *
 * Trace: Story 2.2 AC3 + AC4 + Architecture §4.2 + §4.3; Story 2.12 AC4 (Haiku).
 *
 * Valores em USD por 1M tokens — preços públicos vigentes 2026.
 * Conversão USD→EUR via env `AGENT_USD_TO_EUR_RATE` (default 0.92).
 * Story 2.9 substituirá este rate fixo por FX live.
 *
 * Fonte dos preços Haiku 4.5: https://docs.claude.com/en/docs/about-claude/pricing
 * (confirmado 2026-05-30 — input $1, output $5, cache read $0.10, cache write 5min $1.25
 * por 1M tokens). Rácios canónicos Anthropic: cache read = 0.1× input;
 * cache write 5min = 1.25× input — idênticos ao padrão Sonnet.
 */
import type { LlmModel } from './contracts';

// ─────────────────────────────────────────────────────────────────────────────
// Tarifas USD por 1M tokens — Sonnet 4.5
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Anthropic Claude Sonnet 4.5 — input padrão.
 */
export const CLAUDE_SONNET_INPUT_USD_PER_1M = 3;

/**
 * Anthropic Claude Sonnet 4.5 — output padrão.
 */
export const CLAUDE_SONNET_OUTPUT_USD_PER_1M = 15;

/**
 * Anthropic prompt cache — leitura (10× mais barato que input).
 */
export const CLAUDE_SONNET_CACHE_READ_USD_PER_1M = 0.3;

/**
 * Anthropic prompt cache — escrita (1.25× mais caro que input).
 */
export const CLAUDE_SONNET_CACHE_WRITE_USD_PER_1M = 3.75;

// ─────────────────────────────────────────────────────────────────────────────
// Tarifas USD por 1M tokens — Haiku 4.5 (Story 2.12, novo default Executor)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Anthropic Claude Haiku 4.5 — input padrão ($1 / MTok).
 */
export const CLAUDE_HAIKU_4_5_INPUT_USD_PER_1M = 1;

/**
 * Anthropic Claude Haiku 4.5 — output padrão ($5 / MTok).
 */
export const CLAUDE_HAIKU_4_5_OUTPUT_USD_PER_1M = 5;

/**
 * Anthropic Claude Haiku 4.5 — prompt cache leitura ($0.10 / MTok, 10× mais barato).
 */
export const CLAUDE_HAIKU_4_5_CACHE_READ_USD_PER_1M = 0.1;

/**
 * Anthropic Claude Haiku 4.5 — prompt cache escrita 5min ($1.25 / MTok, 1.25× input).
 */
export const CLAUDE_HAIKU_4_5_CACHE_WRITE_USD_PER_1M = 1.25;

/**
 * OpenAI GPT-4o-mini — input.
 */
export const GPT4O_MINI_INPUT_USD_PER_1M = 0.15;

/**
 * OpenAI GPT-4o-mini — output.
 */
export const GPT4O_MINI_OUTPUT_USD_PER_1M = 0.6;

// ─────────────────────────────────────────────────────────────────────────────
// FX
// ─────────────────────────────────────────────────────────────────────────────

const DEFAULT_USD_TO_EUR_RATE = 0.92;

/**
 * Converte um valor em USD para EUR usando o rate configurável via env.
 *
 * `AGENT_USD_TO_EUR_RATE` (default 0.92). Story 2.9 substituirá por FX live.
 */
export function usdToEur(usd: number): number {
  const raw = process.env.AGENT_USD_TO_EUR_RATE;
  const rate = raw === undefined || raw === '' ? DEFAULT_USD_TO_EUR_RATE : Number(raw);
  if (!Number.isFinite(rate) || rate <= 0) return usd * DEFAULT_USD_TO_EUR_RATE;
  return usd * rate;
}

// ─────────────────────────────────────────────────────────────────────────────
// Calculadoras por provider
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Resultado de pricing — devolve o cost em EUR e detalhes em USD para debug.
 */
export interface CostBreakdown {
  readonly costEur: number;
  readonly costUsd: number;
}

/**
 * Conjunto de tarifas USD/1M tokens de um modelo Anthropic.
 */
interface AnthropicTariff {
  readonly input: number;
  readonly cacheRead: number;
  readonly cacheWrite: number;
  readonly output: number;
}

const CLAUDE_SONNET_TARIFF: AnthropicTariff = {
  input: CLAUDE_SONNET_INPUT_USD_PER_1M,
  cacheRead: CLAUDE_SONNET_CACHE_READ_USD_PER_1M,
  cacheWrite: CLAUDE_SONNET_CACHE_WRITE_USD_PER_1M,
  output: CLAUDE_SONNET_OUTPUT_USD_PER_1M,
};

const CLAUDE_HAIKU_4_5_TARIFF: AnthropicTariff = {
  input: CLAUDE_HAIKU_4_5_INPUT_USD_PER_1M,
  cacheRead: CLAUDE_HAIKU_4_5_CACHE_READ_USD_PER_1M,
  cacheWrite: CLAUDE_HAIKU_4_5_CACHE_WRITE_USD_PER_1M,
  output: CLAUDE_HAIKU_4_5_OUTPUT_USD_PER_1M,
};

/**
 * Selecciona o conjunto de tarifas Anthropic para o modelo dado.
 *
 * Story 2.12: dispatch explícito por modelo — Haiku usa tarifas próprias,
 * nunca as de Sonnet. Sem fallback silencioso: modelos Anthropic não mapeados
 * lançam erro (evita confundir custo Haiku com Sonnet nos dashboards Grafana —
 * Story 2.11). `gpt-4o-mini` não é Anthropic e por isso é rejeitado aqui.
 */
function resolveAnthropicTariff(model: AnthropicModel): AnthropicTariff {
  switch (model) {
    case 'claude-sonnet-4-5':
    // `claude-opus-4-7` ainda não tem tarifas dedicadas — usa Sonnet como
    // aproximação conservadora superior (Opus é mais caro, não mais barato),
    // evitando subestimar custo. Substituir quando Opus for activado.
    case 'claude-opus-4-7':
      return CLAUDE_SONNET_TARIFF;
    case 'claude-haiku-4-5':
      return CLAUDE_HAIKU_4_5_TARIFF;
    default: {
      const exhaustive: never = model;
      throw new Error(`Modelo Anthropic sem tarifa de pricing definida: ${String(exhaustive)}`);
    }
  }
}

/**
 * Modelos Anthropic com tarifa de pricing — subconjunto de `LlmModel` que
 * exclui o classifier OpenAI `gpt-4o-mini`.
 */
export type AnthropicModel = Exclude<LlmModel, 'gpt-4o-mini'>;

/**
 * Calcula o custo em EUR de uma chamada Anthropic, distinguindo tokens
 * regulares de tokens lidos/escritos do prompt cache (mais baratos), com
 * dispatch das tarifas correctas por modelo.
 *
 * Story 2.12: a função passou a receber o modelo como primeiro argumento e
 * selecciona as tarifas via `resolveAnthropicTariff` — custo Haiku != custo
 * Sonnet para os mesmos tokens.
 *
 * @param model modelo Anthropic efectivo da chamada (short-form do enum)
 * @param tokensInputRegular tokens de input não-cacheados
 * @param tokensInputCacheRead tokens lidos do prompt cache (default 0)
 * @param tokensInputCacheWrite tokens escritos no cache (default 0)
 * @param tokensOutput tokens gerados na resposta
 */
export function calculateAnthropicCost(
  model: AnthropicModel,
  tokensInputRegular: number,
  tokensInputCacheRead: number,
  tokensInputCacheWrite: number,
  tokensOutput: number,
): CostBreakdown {
  const tariff = resolveAnthropicTariff(model);
  const usd =
    (tokensInputRegular * tariff.input +
      tokensInputCacheRead * tariff.cacheRead +
      tokensInputCacheWrite * tariff.cacheWrite +
      tokensOutput * tariff.output) /
    1_000_000;
  return { costUsd: usd, costEur: usdToEur(usd) };
}

/**
 * Calcula o custo em EUR de uma chamada OpenAI GPT-4o-mini.
 * GPT-4o-mini não suporta prompt caching nesta abstracção.
 */
export function calculateOpenAICost(
  tokensInput: number,
  tokensOutput: number,
): CostBreakdown {
  const usd =
    (tokensInput * GPT4O_MINI_INPUT_USD_PER_1M +
      tokensOutput * GPT4O_MINI_OUTPUT_USD_PER_1M) /
    1_000_000;
  return { costUsd: usd, costEur: usdToEur(usd) };
}
