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
 */
export function getServiceDb(): DbShim {
  // eslint-disable-next-line @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires
  const mod = require('@meu-jarvis/db/client') as { getServiceDb: () => DbShim };
  return mod.getServiceDb();
}
