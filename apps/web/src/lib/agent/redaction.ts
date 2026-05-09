/**
 * PII redaction — camada 4 defense-in-depth para o endpoint POST /api/agent/prompt.
 *
 * Story 2.6 AC11 + [AUTO-DECISION D25] — opção (b) implementação local.
 *
 * Razão da decisão D25:
 *   - `@meu-jarvis/agent` exporta apenas `sanitizeHint` (cobre NIF parcial e
 *     IBAN parcial mas NÃO cobre email completo nem telefone PT 9 dígitos —
 *     gap NIT-002-NB do gate Story 2.5).
 *   - `redactProviderPayload` é privado intencionalmente em
 *     `@meu-jarvis/agent` (per `index.ts:12` comentário — "alterar a fronteira
 *     requer story dedicada").
 *   - Implementação local cobre o gap COMPLETO (email, telefone PT, NIF,
 *     IBAN, números de cartão Luhn-friendly) sem refactor cross-package.
 *   - Defesa em profundidade: `prompt_text` NUNCA é logado pelo Pino logger
 *     (Story 1.7 PII redact paths já cobre `req.body`); este helper é
 *     APENAS para o `summary` agregado retornado ao utilizador final.
 *
 * Camadas de PII redaction (defense-in-depth):
 *   1. `@meu-jarvis/agent.sanitizeHint` (Story 2.2)
 *   2. `@meu-jarvis/observability.PII_REDACT_PATHS` Pino logger (Story 1.7)
 *   3. Sentry `withScope({piiRedacted: true})` (Story 1.7)
 *   4. **Esta camada — endpoint output redaction** (Story 2.6)
 *
 * SCOPE NÃO COBERTO (intencional):
 *   - Nomes próprios: redacção de nomes requer NER ML — fora do scope MVP.
 *     `prompt_text` na coluna DB tem purge mensal (NFR12) que mitiga.
 *   - Endereços postais: idem.
 *
 * Trace: Story 2.6 AC11 + D25, NFR12, NIT-002-NB do gate 2.5.
 */
import { createHash } from 'node:crypto';

/**
 * Salt para hashing de prompts. NUNCA logar este valor. Em produção é
 * `AGENT_PROMPT_HASH_SALT` env var; fallback determinístico para dev/teste.
 */
function getPromptSalt(): string {
  return process.env.AGENT_PROMPT_HASH_SALT ?? 'expressia-dev-prompt-salt-2026';
}

/**
 * Calcula `prompt_hash` (SHA-256 + salt) do prompt original.
 *
 * Usado em `agent_runs.prompt_hash` para correlação sem PII (NFR12). O
 * `prompt_text` na coluna DB tem purge mensal — esta hash permanece para
 * audit log permanente.
 */
export function hashPrompt(prompt: string): string {
  return createHash('sha256').update(prompt + getPromptSalt()).digest('hex');
}

/**
 * Resultado do `redactEndpointInput` — apenas hash, nunca texto claro.
 */
export interface RedactedInput {
  readonly promptHash: string;
}

/**
 * Layer 4a — input antes de logar.
 *
 * Recebe o prompt raw e retorna **apenas** o hash. NUNCA persiste ou propaga
 * o texto claro fora do escopo do request. O `prompt_text` é guardado em
 * `agent_runs` directamente do handler (campo DB com purge mensal — NFR12),
 * NÃO via este helper.
 */
export function redactEndpointInput(prompt: string): RedactedInput {
  return { promptHash: hashPrompt(prompt) };
}

// ─────────────────────────────────────────────────────────────────────────────
// Output redaction (Layer 4b)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Padrões PII canónicos cobertos por `redactPiiText`.
 *
 * - **Email**: RFC 5322 simplificado (suficiente para PT users).
 * - **Telefone PT (9 dígitos)**: 9XXXXXXXX ou +351 XXXXXXXXX (com/sem espaços).
 * - **NIF**: 9 dígitos isolados (forma típica em texto livre).
 * - **IBAN PT**: PT50 + 21 dígitos (formato canónico). Tolera espaços.
 * - **Cartão crédito**: 13-19 dígitos com possíveis espaços/hífens. NÃO faz
 *   Luhn — match heurístico (cobre Visa/MC/Amex).
 *
 * NÃO COBERTO: nomes próprios (requer NER), endereços postais (requer NER),
 * datas de nascimento isoladas (ambíguas).
 */
const PII_PATTERNS: ReadonlyArray<{ name: string; regex: RegExp; replacement: string }> = [
  // Email — antes do telefone porque pode conter dígitos no @host
  {
    name: 'email',
    regex: /[\w._%+-]+@[\w.-]+\.[A-Za-z]{2,}/g,
    replacement: '[EMAIL_REDACTED]',
  },
  // IBAN PT — antes do NIF porque IBAN começa com PT50 e tem 21 dígitos
  {
    name: 'iban_pt',
    regex: /\bPT50[\s-]?[\d\s-]{20,28}\b/gi,
    replacement: '[IBAN_REDACTED]',
  },
  // Cartão crédito — sequência de 13-19 dígitos com separadores opcionais
  {
    name: 'credit_card',
    regex: /\b(?:\d[\s-]?){13,19}\b/g,
    replacement: '[CARD_REDACTED]',
  },
  // Telefone PT — +351 prefixo opcional, depois 9 dígitos começando por 9
  {
    name: 'phone_pt',
    regex: /(?:\+351[\s-]?)?\b9\d{8}\b/g,
    replacement: '[PHONE_REDACTED]',
  },
  // NIF PT — 9 dígitos isolados (com word boundary). Aplicado depois para não
  // colidir com telefone (telefone começa por 9; NIF típico 1-3).
  {
    name: 'nif_pt',
    regex: /\b\d{9}\b/g,
    replacement: '[NIF_REDACTED]',
  },
];

/**
 * Aplica todos os padrões PII a uma string. Retorna versão redacted.
 *
 * Idempotente — passar uma string já redacted retorna a mesma string (os
 * placeholders `[*_REDACTED]` não match nenhum padrão).
 */
export function redactPiiText(text: string): string {
  if (typeof text !== 'string' || text.length === 0) {
    return text;
  }
  let result = text;
  for (const { regex, replacement } of PII_PATTERNS) {
    result = result.replace(regex, replacement);
  }
  return result;
}

/**
 * Layer 4b — output redaction antes de retornar ao cliente.
 *
 * Recebe um objecto qualquer (tipicamente `AtomicResult.summary` ou um
 * resumo agregado) e aplica `redactPiiText` recursivamente em strings.
 *
 * NUNCA modifica o objecto original — retorna deep clone redacted.
 *
 * @param payload - Objecto/array/primitivo a redactar.
 * @returns Versão deep-cloned com strings redacted.
 */
export function redactEndpointOutput<T>(payload: T): T {
  if (payload === null || payload === undefined) {
    return payload;
  }
  if (typeof payload === 'string') {
    return redactPiiText(payload) as unknown as T;
  }
  if (typeof payload === 'number' || typeof payload === 'boolean' || typeof payload === 'bigint') {
    return payload;
  }
  if (Array.isArray(payload)) {
    return payload.map((item) => redactEndpointOutput(item)) as unknown as T;
  }
  if (typeof payload === 'object') {
    const out: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(payload as Record<string, unknown>)) {
      out[key] = redactEndpointOutput(value);
    }
    return out as unknown as T;
  }
  return payload;
}

/**
 * Helper para construir contexto Sentry seguro (NUNCA inclui prompt_text raw).
 *
 * Padrão de uso:
 * ```ts
 * captureException(err, { ...sentrySafeContext({ householdId, runId }), tags: {...} });
 * ```
 */
export interface SentrySafeContext {
  readonly piiRedacted: true;
  readonly route: string;
  readonly householdId?: string;
  readonly runId?: string;
}

export function sentrySafeContext(opts: {
  readonly route: string;
  readonly householdId?: string;
  readonly runId?: string;
}): SentrySafeContext {
  return {
    piiRedacted: true,
    route: opts.route,
    ...(opts.householdId !== undefined && { householdId: opts.householdId }),
    ...(opts.runId !== undefined && { runId: opts.runId }),
  };
}
