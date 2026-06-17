/**
 * SEC-11 — Lógica pura de auditoria da allowlist de Redirect URLs do Supabase.
 *
 * Este módulo contém EXCLUSIVAMENTE funções puras sobre input (sem I/O, sem
 * `node:*`, sem `process.exit`, sem `fetch`). É consumido por:
 *   - `scripts/audit-supabase-allowlist.ts` — o script CLI operacional que faz
 *     o I/O (env, fetch à Management API, process.exit) e delega a detecção aqui.
 *   - Testes Vitest em `apps/web/src/__tests__/audit-supabase-allowlist.test.ts`.
 *
 * Manter este ficheiro livre de dependências de runtime garante que o
 * `pnpm typecheck` do `@meu-jarvis/web` (lib DOM) o compila sem fricção e que
 * os testes correm no ambiente jsdom já existente do package.
 *
 * Fonte da allowlist: Supabase Management API
 *   GET https://api.supabase.com/v1/projects/{ref}/config/auth
 * Campo relevante: `uri_allow_list` (string CSV, NÃO array JSON).
 */

/** Severidade de um achado da auditoria. */
export type AllowlistFindingLevel = 'risk' | 'info';

/** Achado individual produzido pela auditoria. */
export interface AllowlistFinding {
  /** `risk` bloqueia (exit 1); `info` é meramente informativo (não bloqueia). */
  level: AllowlistFindingLevel;
  /** Mensagem em PT-PT pronta a imprimir no terminal. */
  message: string;
}

/** Resultado agregado da auditoria de uma allowlist. */
export interface AuditResult {
  /** `true` se não houver nenhum achado de risco (mapeia a exit code 0). */
  safe: boolean;
  /** Lista de achados (riscos + informativos), por ordem de detecção. */
  findings: AllowlistFinding[];
}

/**
 * Parseia o campo `uri_allow_list` (string CSV) da Management API para um array
 * de URLs normalizadas. Aceita `undefined`/`null` (allowlist vazia → `[]`).
 *
 * @example
 *   parseAllowlistCsv('http://localhost:3000/**,https://expressia.pt/**')
 *   // → ['http://localhost:3000/**', 'https://expressia.pt/**']
 */
export function parseAllowlistCsv(uriAllowList: string | undefined | null): string[] {
  if (!uriAllowList) return [];
  return uriAllowList
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

/**
 * Detecta o wildcard de subdomínio `*.vercel.app` numa URL da allowlist.
 * Corresponde a entradas como `https://*.vercel.app/**`.
 */
function hasVercelWildcard(url: string): boolean {
  return /\*\.vercel\.app/i.test(url);
}

/**
 * Detecta um wildcard total / não qualificado por domínio. Cobre:
 *   - `https://**` (host substituído por `**`)
 *   - `**` solto (a allowlist inteira é um curinga)
 *   - `*://...` (esquema curinga)
 *
 * Importante: NÃO classifica `https://expressia.pt/**` como total — aí o `**`
 * está qualificado por um host concreto (é apenas curinga de path, legítimo).
 */
function hasTotalWildcard(url: string): boolean {
  // `https://**` ou `http://**` — o host é puro `**` (com path opcional a seguir).
  if (/^[a-z]+:\/\/\*\*(\/|$)/i.test(url)) return true;
  // Esquema curinga, ex.: `*://qualquer`.
  if (/^\*:\/\//.test(url)) return true;
  // Entrada que é só `**` (allowlist totalmente aberta).
  if (/^\*+$/.test(url)) return true;
  return false;
}

/**
 * Audita um conjunto de URLs de Redirect (já parseadas do CSV) contra os
 * padrões de risco da SEC-11.
 *
 * Regras:
 *   1. Qualquer URL com `*.vercel.app` → achado de RISCO (bloqueia).
 *   2. Qualquer URL com wildcard total (`https://**`, `**`, `*://`) → RISCO.
 *   3. Ausência do domínio de produção (`expectedProductionPattern`) → INFO
 *      (não bloqueia: pode faltar legitimamente em ambientes de preview).
 *
 * @param urls Array de URLs da allowlist (output de `parseAllowlistCsv`).
 * @param expectedProductionPattern Padrão do domínio de produção a procurar
 *   (default `https://expressia.pt/**`). Apenas usado para o check informativo.
 */
export function auditAllowlist(
  urls: string[],
  expectedProductionPattern = 'https://expressia.pt/**',
): AuditResult {
  const findings: AllowlistFinding[] = [];

  for (const url of urls) {
    if (hasVercelWildcard(url)) {
      findings.push({
        level: 'risk',
        message: `RISCO: wildcard de subdomínio Vercel detectado na allowlist — "${url}". Qualquer deployment "*.vercel.app" pode receber tokens de reset (password-reset-poisoning). Remover após DNS estável (ver runbook SEC-11).`,
      });
    }

    if (hasTotalWildcard(url)) {
      findings.push({
        level: 'risk',
        message: `RISCO: wildcard total / não qualificado por domínio detectado na allowlist — "${url}". Abre vector de open redirect para qualquer host. Remover imediatamente.`,
      });
    }
  }

  // Check informativo: domínio de produção presente?
  const hasProductionDomain = urls.includes(expectedProductionPattern);
  if (!hasProductionDomain) {
    findings.push({
      level: 'info',
      message: `INFO: padrão de produção "${expectedProductionPattern}" não encontrado na allowlist. Pode ser esperado em ambientes de preview; confirmar manualmente em produção.`,
    });
  }

  const safe = findings.every((f) => f.level !== 'risk');
  return { safe, findings };
}

/** Forma mínima da resposta `/config/auth` da Management API. */
export interface AuthConfigResponse {
  site_url?: string;
  uri_allow_list?: string;
}

/** Resultado da avaliação ponta-a-ponta (resposta HTTP → exit code). */
export interface EvaluationResult {
  /** Exit code que o script CLI deve usar (0 = ok, 1 = problema). */
  exitCode: number;
  /** Mensagens em PT-PT a imprimir (ordem de produção). */
  messages: string[];
  /** Auditoria da allowlist quando aplicável (ausente em erros HTTP). */
  audit?: AuditResult;
}

/**
 * Mapeia uma resposta HTTP da Management API (já obtida) para um exit code +
 * mensagens PT-PT, SEM fazer I/O de rede. Permite testar o ramo de erro 401 e
 * o caminho feliz de forma determinística, mantendo o `fetch` real apenas no
 * script CLI.
 *
 * @param status Código HTTP da resposta da Management API.
 * @param body Corpo JSON já parseado (ou `undefined` se 401/erro sem corpo).
 * @param expectedProductionPattern Padrão de produção para o check informativo.
 */
export function evaluateAuthConfigResponse(
  status: number,
  body: AuthConfigResponse | undefined,
  expectedProductionPattern = 'https://expressia.pt/**',
): EvaluationResult {
  if (status === 401) {
    return {
      exitCode: 1,
      messages: [
        'ERRO: token inválido ou expirado (HTTP 401 da Management API).',
        'Solução: gera um novo Personal Access Token Supabase.',
      ],
    };
  }

  if (status < 200 || status >= 300) {
    return {
      exitCode: 1,
      messages: [`ERRO: resposta inesperada da Management API (HTTP ${status}).`],
    };
  }

  const urls = parseAllowlistCsv(body?.uri_allow_list);
  const audit = auditAllowlist(urls, expectedProductionPattern);

  return {
    exitCode: audit.safe ? 0 : 1,
    messages: audit.safe ? ['Allowlist segura.'] : ['Allowlist de risco — ver achados.'],
    audit,
  };
}
