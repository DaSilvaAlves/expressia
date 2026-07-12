/**
 * Upstash Redis cache para classifier results — Story 2.9 AC1+AC2+AC3.
 *
 * Lookup antes do classifier LLM em `route.ts`:
 *   ├─ HIT  → bypass classifier, retornar ClassificationResult cacheado
 *   └─ MISS → executar classifier + cache SET (TTL 300s default)
 *
 * Cache key: `sha256(normalize(prompt) + householdPlan + CLASSIFIER_SYSTEM_PROMPT_VERSION)`
 * per Architecture §4.6. Key usa `householdPlan` (não `householdId`) — dois
 * utilizadores do mesmo plano partilham cache de intents (não PII). Ver DN2 + D53.
 * Incluir a versão do system prompt do classifier garante que um bump ao prompt
 * (`'v11' → 'v12'`) invalida automaticamente as entradas cacheadas com o prompt
 * antigo — sem isto, um classificador melhorado continuaria a servir intents
 * estagnados até o TTL expirar. Papercut M-6 (cache não versionada pelo prompt).
 *
 * Modo degradado: se `UPSTASH_REDIS_REST_URL` ou `UPSTASH_REDIS_REST_TOKEN`
 * ausentes, `UpstashCache` retorna sempre `null` em `get` e no-op em `set` —
 * sem crash em dev/CI sem credentials. Ver DN1 + D44.
 *
 * Trace: Story 2.9 AC1-AC3, D44-D46+D53, Architecture §4.6.
 */
import { createHash } from 'node:crypto';

import { CLASSIFIER_SYSTEM_PROMPT_VERSION } from '@meu-jarvis/classifier';

/**
 * Interface mockable do cliente Upstash — permite swap em testes via
 * `vi.mock('@upstash/redis')` ou injecção directa de fake. Padrão consistente
 * com `OpenAIClientLike` (Story 2.2 D8) e `InngestClientLike` (Story 2.8 D43).
 */
export interface UpstashClientLike {
  get(key: string): Promise<string | null>;
  set(key: string, value: string, opts?: { ex?: number }): Promise<unknown>;
  del(key: string): Promise<unknown>;
}

/**
 * TTL default 5min (300s) — Architecture §4.6 literal "cache 5min".
 * Override via env `CACHE_TTL_SECONDS` para staging/dev sem deploy. D46.
 */
export const CACHE_TTL_SECONDS = (() => {
  const fromEnv = Number(process.env.CACHE_TTL_SECONDS);
  return Number.isFinite(fromEnv) && fromEnv > 0 ? Math.floor(fromEnv) : 300;
})();

/**
 * Normalização canónica do prompt para cache key:
 *   - trim espaços nas pontas
 *   - lowercase total
 *   - colapsa whitespace interno (múltiplos espaços, tabs, newlines → 1 espaço)
 *
 * Garante que "Quantas Tarefas Tenho?" e " quantas    tarefas tenho? " geram a
 * mesma key (maximiza hit rate sem comprometer correcção).
 */
function normalizePrompt(prompt: string): string {
  return prompt.trim().toLowerCase().replace(/\s+/g, ' ');
}

/**
 * Constrói cache key SHA-256 a partir do prompt normalizado + householdPlan.
 *
 * **NUNCA logar o prompt original** — apenas a key (hash) é segura para logs
 * Pino (NFR12 PII redaction). Ver DN4 + precedente `redaction.ts:hashPrompt`.
 *
 * @param prompt - texto original do utilizador (será normalizado)
 * @param householdPlan - tier do household (`'free'`/`'pessoal'`/`'familia'`/`'pro'`)
 * @returns hash hex 64-char SHA-256
 */
export function buildCacheKey(prompt: string, householdPlan: string): string {
  const normalized = normalizePrompt(prompt);
  // `CLASSIFIER_SYSTEM_PROMPT_VERSION` no material da key: um bump ao prompt do
  // classifier invalida automaticamente o cache antigo (evita servir intents
  // estagnados classificados por um prompt já substituído).
  return createHash('sha256')
    .update(normalized + householdPlan + CLASSIFIER_SYSTEM_PROMPT_VERSION)
    .digest('hex');
}

/**
 * Implementação concreta `UpstashClientLike` via `@upstash/redis`.
 *
 * Modo degradado: se env vars ausentes (`UPSTASH_REDIS_REST_URL` ou
 * `UPSTASH_REDIS_REST_TOKEN`), `get` retorna sempre `null` e `set`/`del` são
 * no-op — sem throw. Permite dev/CI sem Upstash provisionado (precedente DN1).
 */
export class UpstashCache implements UpstashClientLike {
  private client: UpstashClientLike | null = null;
  private degraded: boolean;

  constructor(client?: UpstashClientLike) {
    if (client) {
      // Injecção directa — usada em testes.
      this.client = client;
      this.degraded = false;
      return;
    }

    const url = process.env.UPSTASH_REDIS_REST_URL;
    const token = process.env.UPSTASH_REDIS_REST_TOKEN;

    if (!url || !token) {
      // Modo degradado — sem credentials, opera como no-op.
      this.degraded = true;
      return;
    }

    // Lazy require para evitar resolver `@upstash/redis` quando degradado em CI.
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires
      const mod = require('@upstash/redis') as {
        Redis: new (cfg: { url: string; token: string }) => UpstashClientLike;
      };
      this.client = new mod.Redis({ url, token });
      this.degraded = false;
    } catch {
      // Pacote ausente ou erro de init — cair para degraded mode.
      this.degraded = true;
    }
  }

  async get(key: string): Promise<string | null> {
    if (this.degraded || !this.client) {
      return null;
    }
    try {
      const value = await this.client.get(key);
      // Upstash pode devolver string ou objecto já parsed; normalizar p/ string.
      if (value === null || value === undefined) return null;
      if (typeof value === 'string') return value;
      return JSON.stringify(value);
    } catch {
      // Falha de network/Upstash não pode bloquear o pipeline — modo degradado.
      return null;
    }
  }

  async set(key: string, value: string, opts?: { ex?: number }): Promise<unknown> {
    if (this.degraded || !this.client) {
      return undefined;
    }
    try {
      return await this.client.set(key, value, { ex: opts?.ex ?? CACHE_TTL_SECONDS });
    } catch {
      // Falha de set não-fatal — pipeline continua sem cache.
      return undefined;
    }
  }

  async del(key: string): Promise<unknown> {
    if (this.degraded || !this.client) {
      return undefined;
    }
    try {
      return await this.client.del(key);
    } catch {
      return undefined;
    }
  }
}

/**
 * Singleton lazy do cliente cache — partilhado entre invocações do handler.
 *
 * Inicialização lazy garante que (i) testes podem fazer `vi.mock('@upstash/redis')`
 * antes do primeiro acesso, (ii) modo degradado funciona sem throw em import time.
 */
let _cacheClient: UpstashCache | null = null;
export function getCacheClient(): UpstashCache {
  if (!_cacheClient) {
    _cacheClient = new UpstashCache();
  }
  return _cacheClient;
}

/**
 * Reset utility — apenas para tests via `vi.mock` ou cleanup explícito.
 */
export function _resetCacheClientForTests(): void {
  _cacheClient = null;
}
