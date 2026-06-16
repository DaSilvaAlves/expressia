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
 *     uma transação via `db.transaction()` (Drizzle), faz `SET LOCAL ROLE authenticated`
 *     + `SET LOCAL request.jwt.claims` (com `sub` + `household_id`), o que ACTIVA as 104
 *     policies sem as alterar. O `SET LOCAL` reverte no COMMIT — seguro em pgbouncer
 *     transaction-mode (2.ª rede, defense-in-depth por baixo do filtro app-enforced,
 *     que NÃO é removido).
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
let _serviceDb: Database | null = null;

/**
 * Cliente Postgres comum — usa role `authenticated` (RLS aplicada via JWT do Supabase).
 *
 * Singleton lazy: cria uma única `postgres()` connection pool por processo.
 * O `withHousehold` reutiliza esta mesma pool via `db.transaction()`.
 */
export function getDb(): Database {
  if (_db) return _db;

  const url = process.env.DATABASE_URL;
  if (!url) {
    throw new Error(
      '[db/client] DATABASE_URL não definido. Configure em Vercel env vars ou .env.local.',
    );
  }

  // pgbouncer transaction-mode: prepared statements desactivadas, max_lifetime baixo
  const pgSql: Sql = postgres(url, {
    prepare: false,
    max: 10,
    idle_timeout: 20,
    max_lifetime: 60 * 10,
  });

  _db = drizzle(pgSql, { schema, logger: process.env.DB_DEBUG === '1' });
  return _db;
}

/**
 * Executa `fn` com as 104 RLS policies ACTIVAS, ligado ao role `authenticated`
 * e com os JWT claims (`sub` + `household_id`) definidos para a transação.
 *
 * Mecânica (provada na Fase 0 do ADR-003 — `diag-adr003-phase0.ts`, caminho 3b;
 * replica `rls-harness.ts:asUser()`):
 *   1. Abre uma transação via `db.transaction()` do Drizzle (sobre a pool de `getDb()`).
 *   2. `SET LOCAL ROLE authenticated` — activa as policies (role sem `rolbypassrls`).
 *   3. `set_config('request.jwt.claims', $claims, true)` PARAMETRIZADO — shape
 *      `{"sub": userId, "household_id": householdId, "role": "authenticated"}`.
 *      `is_local = true` limita à transação (anti-injection: o JSON nunca é
 *      concatenado, vai como parâmetro bound via template `sql`).
 *   4. `set_config('app.current_household_id', $householdId, true)` — defense-in-depth
 *      extra: alimenta o COALESCE em `current_household_id()` para policies/funções
 *      que leiam o GUC. Não substitui o `sub` dos claims.
 *   5. Corre `fn(tx)` com o `Database` Drizzle scoped à transação (o transaction
 *      client que `db.transaction()` injecta — totalmente compatível com
 *      query-builder e `tx.execute`, e com a interface `DbShim`).
 *   6. COMMIT (ou ROLLBACK em erro) — o `SET LOCAL` reverte automaticamente, zero
 *      fuga de contexto entre requests no mesmo pool pgbouncer transaction-mode.
 *
 * REGRESSÃO CORRIGIDA (SEC-8.1, 2026-06-10): a implementação anterior abria a
 * transação com `pgSql.begin()` (postgres-js cru) e depois fazia
 * `drizzle(pgTx as unknown as Sql)`. Esse cliente Drizzle estava PARTIDO em
 * runtime: qualquer query via esse `tx` lançava
 * `TypeError: Cannot read properties of undefined (reading 'parsers')` — o
 * `TransactionSql` que `postgres.begin()` passa ao callback NÃO tem a shape
 * (`.options.parsers`) que `drizzle-orm/postgres-js` espera. Os gates passavam
 * porque os testes usavam mocks/harness Drizzle (`db.transaction`), nunca o
 * `pgSql.begin` real de produção. A correcção usa `db.transaction()` do Drizzle
 * (cliente compatível), provado contra a DB real
 * (`diag-sec8-granular.ts` T2/T3 falham; `diag-sec8-fix.ts` sucede + RLS activa).
 *
 * IMPORTANTE: usa `SET LOCAL` em toda a parte — nunca `SET` simples (que persistiria
 * na connection e vazaria contexto cross-request). NÃO remove o filtro `household_id`
 * app-enforced (SEC-1) das queries do callback — é defense-in-depth, 2.ª rede.
 *
 * @see docs/adr/ADR-003-rls-enforced-runtime-hardening.md §3
 * @see packages/db-test/src/rls-harness.ts (asUser — mecânica de referência)
 * @see packages/db-test/src/tests/executeAtomic.rls.test.ts (AC9 / SEC-8.1 — gate real)
 */
export async function withHousehold<T>(
  auth: { userId: string; householdId: string },
  fn: (tx: Database) => Promise<T>,
): Promise<T> {
  const db = getDb();

  // JSON dos claims construído como string parametrizada — nunca concatenado no SQL.
  const claims = JSON.stringify({
    sub: auth.userId,
    household_id: auth.householdId,
    role: 'authenticated',
  });

  return db.transaction(async (tx) => {
    // 1. Bater para o role authenticated (SET LOCAL — só esta transação).
    await tx.execute(sql`set local role authenticated`);

    // 2. JWT claims via set_config (is_local = true). Igual ao Supabase Auth Hook.
    //    Parametrizado via template `sql` — o JSON vai como parâmetro bound.
    await tx.execute(sql`select set_config('request.jwt.claims', ${claims}, true)`);

    // 3. GUC app.current_household_id (defense-in-depth — COALESCE em current_household_id()).
    await tx.execute(
      sql`select set_config('app.current_household_id', ${auth.householdId}, true)`,
    );

    // 4. O `tx` injectado por `db.transaction()` é o transaction client do Drizzle,
    //    scoped à transacção — as queries do callback usam o ORM normalmente.
    return fn(tx);
  });
}

/**
 * Cliente Postgres com `service_role` — IGNORA RLS (`rolbypassrls = TRUE`).
 *
 * ⚠️ GUARD DE SEGURANÇA (SEC-10): este cliente contorna por completo as 104 RLS
 * policies do schema. **NUNCA usar em response handlers de utilizador final**
 * (Route Handlers, RSC, Server Actions com JWT de utilizador no contexto). Em
 * caminhos de utilizador usar SEMPRE `getDb()` (role `authenticated`, filtro
 * `household_id` app-enforced — 1.ª rede SEC-1) ou `withHousehold()` (RLS
 * activa — 2.ª rede SEC-2). Pesquisar por "NUNCA usar em response handlers de
 * utilizador final" para auditar usos.
 *
 * As ÚNICAS três categorias de uso legítimo (excepções permanentes, auditadas e
 * verificadas em SEC-10 — zero usos suspeitos no código de produção):
 *
 *   1. Migrações e scripts de admin (sem JWT de utilizador no contexto).
 *   2. Jobs Inngest controlados, disparados por cron (sem JWT de utilizador):
 *      `generate-recurring-tasks`, `generate-finance-recurrences`,
 *      `cleanup-expired-reverse-ops` (e futuros GDPR purge / Stripe webhooks).
 *   3. Excepções pontuais documentadas onde a RLS bloqueia legitimamente o role
 *      `authenticated` e o acesso é estritamente scoped pela aplicação:
 *        - `incrementQuota` (audit-log.ts) — D50: RLS bloqueia INSERT/UPDATE em
 *          `agent_quotas` a `authenticated` (0001_rls_policies.sql:342-362).
 *        - `undo/route.ts` — D-12C: trigger de imutabilidade bloqueia a transição
 *          terminal `success→reverted` em `authenticated`; pertença ao household
 *          é verificada app-enforced antes (cross-household → 404).
 *
 * @see CLAUDE.md §Multi-tenancy via Postgres RLS — regra canónica getServiceDb vs getDb
 * @see docs/adr/ADR-003-rls-enforced-runtime-hardening.md §D6, §12.3, §12.5 — justificações
 * @see docs/stories/active/SEC-10.audit-service-db-auth-rate-limiting.story.md — auditoria
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
