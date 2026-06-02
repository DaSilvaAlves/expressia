/**
 * Cliente Drizzle + Postgres para o meu-jarvis (Expressia).
 *
 * Padrões:
 *   - Em rotas Next.js (RSC, Route Handlers, Server Actions) usar `getDb()`
 *     com utilizador autenticado: a connection string usa pgbouncer transaction-mode
 *     do Supabase Pooler (porta 6543).
 *   - Para acesso `service_role` (jobs Inngest, migrations, scripts) usar `getServiceDb()`.
 *
 * RLS — estado real (ver ADR-003 §1.1 e Fase 0 do diagnóstico `diag-adr003-phase0.ts`):
 *   - `getDb()` liga ao Supabase Pooler com um role que tem `rolbypassrls = TRUE`.
 *     Em ligações postgres-js cruas (não-PostgREST) o `request.jwt.claims` NUNCA é
 *     injectado automaticamente, logo `auth.uid()` devolve NULL e as 104 RLS policies
 *     ficam INERTES em runtime. O isolamento cross-tenant é hoje garantido pelo filtro
 *     `household_id` explícito ao nível da aplicação (SEC-1 — 1.ª rede).
 *   - `withHousehold(auth, fn)` é o caminho RLS-enforced (SEC-2 / ADR-003 Fase 1): abre
 *     uma transação, faz `SET LOCAL ROLE authenticated` + `SET LOCAL request.jwt.claims`
 *     (com `sub` + `household_id`), o que ACTIVA as 104 policies sem as alterar. O
 *     `SET LOCAL` reverte no COMMIT — seguro em pgbouncer transaction-mode (2.ª rede,
 *     defense-in-depth por baixo do filtro app-enforced, que NÃO é removido).
 *   - `getServiceDb()` usa `service_role` e IGNORA RLS por design — usar APENAS em código
 *     de servidor controlado (jobs Inngest, migrations, scripts).
 *
 * Ver `architecture.md` §3.2, §5.1, §11.2; `docs/adr/ADR-003-rls-enforced-runtime-hardening.md`.
 */
import { sql } from 'drizzle-orm';
import { drizzle, type PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import postgres, { type Sql } from 'postgres';

// Story 2.6 fix: relative import (era `@/schema`) para resolver cross-package
// quando consumido por apps/web via webpack/Next.js. Pattern alinhado com
// 2.2/2.3/2.4 (D16 directive da 2.5).
import * as schema from './schema';

export type Database = PostgresJsDatabase<typeof schema>;

let _db: Database | null = null;
let _dbSql: Sql | null = null;
let _serviceDb: Database | null = null;

/**
 * Cliente Postgres comum — usa role `authenticated` (RLS aplicada via JWT do Supabase).
 *
 * Singleton lazy: cria uma única `postgres()` connection pool por processo.
 */
export function getDb(): Database {
  if (_db) return _db;

  _dbSql = createDbSql();
  _db = drizzle(_dbSql, { schema, logger: process.env.DB_DEBUG === '1' });
  return _db;
}

/**
 * Cria a pool `postgres-js` subjacente ao `getDb()`.
 *
 * Extraído para função privada porque o `withHousehold` precisa da instância
 * `Sql` crua (para `begin()` + `SET LOCAL`), enquanto `getDb()` só expõe o
 * wrapper Drizzle.
 */
function createDbSql(): Sql {
  const url = process.env.DATABASE_URL;
  if (!url) {
    throw new Error(
      '[db/client] DATABASE_URL não definido. Configure em Vercel env vars ou .env.local.',
    );
  }

  // pgbouncer transaction-mode: prepared statements desactivadas, max_lifetime baixo
  return postgres(url, {
    prepare: false,
    max: 10,
    idle_timeout: 20,
    max_lifetime: 60 * 10,
  });
}

/**
 * Devolve a pool `postgres-js` crua subjacente ao `getDb()` (singleton lazy).
 *
 * Privado ao módulo — `withHousehold` usa-a para abrir a transação RLS-enforced.
 * Garante que partilha a MESMA pool que `getDb()` (não cria uma segunda).
 */
function getDbSql(): Sql {
  if (_dbSql) return _dbSql;
  // Inicializa a pool via getDb() para manter o invariante "uma só pool".
  getDb();
  // _dbSql é garantidamente não-nulo após getDb() correr com sucesso.
  return _dbSql as unknown as Sql;
}

/**
 * Executa `fn` com as 104 RLS policies ACTIVAS, ligado ao role `authenticated`
 * e com os JWT claims (`sub` + `household_id`) definidos para a transação.
 *
 * Mecânica (provada na Fase 0 do ADR-003 — `diag-adr003-phase0.ts`, caminho 3b;
 * replica `rls-harness.ts:asUser()`):
 *   1. Abre uma transação na pool de `getDb()` (`begin()`).
 *   2. `SET LOCAL ROLE authenticated` — activa as policies (role sem `rolbypassrls`).
 *   3. `set_config('request.jwt.claims', $claims, true)` PARAMETRIZADO — shape
 *      `{"sub": userId, "household_id": householdId, "role": "authenticated"}`.
 *      `is_local = true` limita à transação (anti-injection: o JSON nunca é
 *      concatenado, vai como parâmetro bound).
 *   4. `set_config('app.current_household_id', $householdId, true)` — defense-in-depth
 *      extra: alimenta o COALESCE em `current_household_id()` para policies/funções
 *      que leiam o GUC. Não substitui o `sub` dos claims.
 *   5. Corre `fn(tx)` com um `Database` Drizzle scoped à transação.
 *   6. COMMIT (ou ROLLBACK em erro) — o `SET LOCAL` reverte automaticamente, zero
 *      fuga de contexto entre requests no mesmo pool pgbouncer transaction-mode.
 *
 * IMPORTANTE: usa `SET LOCAL` em toda a parte — nunca `SET` simples (que persistiria
 * na connection e vazaria contexto cross-request). NÃO remove o filtro `household_id`
 * app-enforced (SEC-1) das queries do callback — é defense-in-depth, 2.ª rede.
 *
 * @see docs/adr/ADR-003-rls-enforced-runtime-hardening.md §3
 * @see packages/db-test/src/rls-harness.ts (asUser — mecânica de referência)
 * @see packages/db-test/src/scripts/diag-adr003-phase0.ts (Fase 0 — VEREDICTO GO)
 */
export async function withHousehold<T>(
  auth: { userId: string; householdId: string },
  fn: (tx: Database) => Promise<T>,
): Promise<T> {
  const pgSql = getDbSql();

  // JSON dos claims construído como string parametrizada — nunca concatenado no SQL.
  const claims = JSON.stringify({
    sub: auth.userId,
    household_id: auth.householdId,
    role: 'authenticated',
  });

  return pgSql.begin(async (pgTx) => {
    // 1. Bater para o role authenticated (SET LOCAL — só esta transação).
    await pgTx.unsafe('set local role authenticated');

    // 2. JWT claims via set_config (is_local = true). Igual ao Supabase Auth Hook.
    await pgTx`select set_config('request.jwt.claims', ${claims}, true)`;

    // 3. GUC app.current_household_id (defense-in-depth — COALESCE em current_household_id()).
    await pgTx`select set_config('app.current_household_id', ${auth.householdId}, true)`;

    // 4. Drizzle scoped à transação — as queries do callback usam o ORM normalmente.
    //    `drizzle()` tipa o cliente como `Sql`; o `pgTx` recebido por `begin()` é
    //    `TransactionSql` (subconjunto sem `END`/`CLOSE`/etc — irrelevantes para o
    //    Drizzle, que só usa a superfície de execução de queries, comum a ambos).
    //    Cast através de `unknown` (nunca `any`) — runtime idêntico, types alinhados.
    const tx = drizzle(pgTx as unknown as Sql, {
      schema,
      logger: process.env.DB_DEBUG === '1',
    });
    return fn(tx);
  }) as Promise<T>;
}

/**
 * Cliente Postgres com `service_role` — IGNORA RLS.
 *
 * Use APENAS para:
 *   - Migrações
 *   - Jobs Inngest controlados (recurrences, GDPR purge, Stripe webhook handlers)
 *   - Scripts de admin
 *
 * NUNCA usar em response handlers de utilizador final.
 */
export function getServiceDb(): Database {
  if (_serviceDb) return _serviceDb;

  const url = process.env.DATABASE_URL_SERVICE_ROLE ?? process.env.SUPABASE_DB_URL;
  if (!url) {
    throw new Error(
      '[db/client] DATABASE_URL_SERVICE_ROLE não definido. Apenas para uso em servidor (Inngest, scripts).',
    );
  }

  const sql = postgres(url, {
    prepare: false,
    max: 5,
    idle_timeout: 20,
  });

  _serviceDb = drizzle(sql, { schema, logger: process.env.DB_DEBUG === '1' });
  return _serviceDb;
}

/**
 * Define o `app.current_household_id` GUC para a transação corrente.
 * Útil em scripts/jobs onde não há JWT mas é preciso simular contexto household.
 */
export async function setHouseholdContext(
  db: Database,
  householdId: string,
): Promise<void> {
  // SEC-1 (AC-J1): query parametrizada via tagged template literal — evita SQL
  // injection da interpolação de string anterior. O driver passa `householdId`
  // como parâmetro bound, nunca concatenado no SQL.
  await db.execute(sql`select set_config('app.current_household_id', ${householdId}, true)`);
}
