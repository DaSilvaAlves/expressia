/**
 * DB shim — re-export de `getDb`/`getServiceDb` do package `@meu-jarvis/db`
 * com tipos minimal locais.
 *
 * Razão (Story 2.6 implementation):
 *   O package `@meu-jarvis/db` usa `import * as schema from '@/schema'` no
 *   `client.ts` (path alias interno). Quando importado directamente via
 *   `@meu-jarvis/db/client` em apps/web, o tsc do apps/web tenta resolver
 *   `@/schema` no contexto cross-package e falha (paths internos do package
 *   não são externos).
 *
 *   Pattern usado pelo `@meu-jarvis/auth/server` (que evita imports internos
 *   complexos) é o ideal mas requer refactor do package db (fora do scope
 *   desta story).
 *
 *   Workaround: dynamic require em runtime — Node.js resolve via package
 *   exports a `./src/client.ts`. Tipo é estabelecido via interface local
 *   minimal que casa com o uso (apenas `execute` é necessário).
 */
import type { sql } from 'drizzle-orm';

/**
 * Tipo minimal de executor DB — `execute` apenas. Exportado para eliminar as
 * cópias locais `type Database` em audit-log, cost-router, rate-limiter e
 * idempotency (todos usam apenas `execute`).
 */
export type DbExecutor = {
  execute<T = unknown>(query: ReturnType<typeof sql>): Promise<T[]>;
};

/**
 * Interface minimal do cliente Drizzle — compatível com `DrizzleDbClient` de
 * `@meu-jarvis/tools` (que requer `transaction`, `insert`, `execute`).
 *
 * Qualquer cliente Drizzle real (`PostgresJsDatabase`) satisfaz esta interface.
 * Uso polimórfico — não tentamos reproduzir o type system completo do Drizzle.
 */
export interface DbShim {
  execute<T = unknown>(query: ReturnType<typeof sql>): Promise<T[]>;
  transaction<T>(fn: (tx: DbShim) => Promise<T>): Promise<T>;
  insert(table: unknown): {
    values(values: unknown): {
      returning(columns?: unknown): Promise<Array<Record<string, unknown>>>;
    };
  };
}

/**
 * Carrega `getDb` lazy via require — evita typecheck cross-package.
 * Em testes este módulo é mockado via `vi.mock('@/lib/agent/db-shim')`.
 */
export function getDb(): DbShim {
  // eslint-disable-next-line @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires
  const mod = require('@meu-jarvis/db/client') as { getDb: () => DbShim };
  return mod.getDb();
}

/**
 * Carrega `getServiceDb` lazy via require.
 *
 * ⚠️ GUARD DE SEGURANÇA (SEC-10): re-exporta o cliente `service_role` que IGNORA
 * RLS. **NUNCA usar em response handlers de utilizador final** (Route Handlers,
 * RSC, Server Actions). Em caminhos de utilizador usar `getDb()` ou
 * `withHousehold()` (ver acima).
 *
 * As ÚNICAS três categorias de uso legítimo (excepções permanentes, auditadas em
 * SEC-10 — zero usos suspeitos no código de produção de `apps/web`):
 *   1. Jobs Inngest controlados disparados por cron (sem JWT de utilizador):
 *      `generate-recurring-tasks`, `generate-finance-recurrences`,
 *      `cleanup-expired-reverse-ops`.
 *   2. `incrementQuota` (audit-log.ts) — D50: RLS bloqueia `agent_quotas` a
 *      `authenticated`.
 *   3. `undo/route.ts` — D-12C: trigger de imutabilidade bloqueia a transição
 *      terminal `success→reverted` em `authenticated` (pertença verificada
 *      app-enforced antes — cross-household → 404).
 *
 * @see packages/db/src/client.ts — guard canónico de `getServiceDb()`
 * @see CLAUDE.md §Multi-tenancy via Postgres RLS
 * @see docs/adr/ADR-003-rls-enforced-runtime-hardening.md §D6, §12.3, §12.5
 * @see docs/stories/active/SEC-10.audit-service-db-auth-rate-limiting.story.md
 */
export function getServiceDb(): DbShim {
  // eslint-disable-next-line @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires
  const mod = require('@meu-jarvis/db/client') as { getServiceDb: () => DbShim };
  return mod.getServiceDb();
}

/**
 * Contexto de autenticação per-request passado a `withHousehold` (shape mínimo
 * — corresponde a `AuthContext` de `@/lib/api-helpers/auth`).
 */
export interface WithHouseholdAuth {
  readonly userId: string;
  readonly householdId: string;
}

/**
 * Carrega `withHousehold` lazy via require (SEC-2 / ADR-003 Fase 1).
 *
 * Roteado por este shim — tal como `getDb`/`getServiceDb` — para NÃO reintroduzir
 * o break de tsc cross-package que o import directo de `@meu-jarvis/db/client`
 * provoca em apps/web (ver cabeçalho deste ficheiro).
 *
 * O `tx` que `withHousehold` injecta no callback é um `Database` real do Drizzle
 * (`PostgresJsDatabase`), que satisfaz estruturalmente a interface `DbShim`
 * (`execute`/`transaction`/`insert`). Em testes este módulo é mockado via
 * `vi.mock('@/lib/agent/db-shim')`.
 */
export function withHousehold<T>(
  auth: WithHouseholdAuth,
  fn: (tx: DbShim) => Promise<T>,
): Promise<T> {
  // eslint-disable-next-line @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires
  const mod = require('@meu-jarvis/db/client') as {
    withHousehold: <R>(auth: WithHouseholdAuth, fn: (tx: DbShim) => Promise<R>) => Promise<R>;
  };
  return mod.withHousehold(auth, fn);
}
