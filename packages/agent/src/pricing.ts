/**
 * Constantes de pricing para Anthropic Sonnet 4.5 e OpenAI GPT-4o-mini.
 *
 * Trace: Story 2.2 AC3 + AC4 + Architecture §4.2 + §4.3.
 *
 * Valores em USD por 1M tokens — preços públicos vigentes 2026.
 * Conversão USD→EUR via env `AGENT_USD_TO_EUR_RATE` (default 0.92).
 * Story 2.9 substituirá este rate fixo por FX live.
 */

// ─────────────────────────────────────────────────────────────────────────────
// Tarifas USD por 1M tokens
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
 * Calcula o custo em EUR de uma chamada Anthropic Sonnet, distinguindo
 * tokens regulares de tokens lidos do prompt cache (mais baratos).
 *
 * @param tokensInputRegular tokens de input não-cacheados
 * @param tokensInputCacheRead tokens lidos do prompt cache (default 0)
 * @param tokensInputCacheWrite tokens escritos no cache (default 0)
 * @param tokensOutput tokens gerados na resposta
 */
export function calculateAnthropicCost(
  tokensInputRegular: number,
  tokensInputCacheRead: number,
  tokensInputCacheWrite: number,
  tokensOutput: number,
): CostBreakdown {
  const usd =
    (tokensInputRegular * CLAUDE_SONNET_INPUT_USD_PER_1M +
      tokensInputCacheRead * CLAUDE_SONNET_CACHE_READ_USD_PER_1M +
      tokensInputCacheWrite * CLAUDE_SONNET_CACHE_WRITE_USD_PER_1M +
      tokensOutput * CLAUDE_SONNET_OUTPUT_USD_PER_1M) /
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
