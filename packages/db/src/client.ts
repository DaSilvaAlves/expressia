/**
 * Cliente Drizzle + Postgres para o meu-jarvis (Expressia).
 *
 * Padrões:
 *   - Em rotas Next.js (RSC, Route Handlers, Server Actions) usar `getDb()`
 *     com utilizador autenticado: a connection string usa pgbouncer transaction-mode
 *     do Supabase Pooler (porta 6543).
 *   - Para acesso `service_role` (jobs Inngest, migrations, scripts) usar `getServiceDb()`.
 *
 * RLS:
 *   - Connections como `authenticated` herdam `auth.uid()` do JWT (Supabase Auth Hook
 *     injecta `request.jwt.claims` com `household_id`). As policies em §3.2 do
 *     architecture.md usam `current_household_id()` e `is_household_member()`.
 *   - Connections `service_role` IGNORAM RLS — usar APENAS em código de servidor controlado.
 *
 * Ver `architecture.md` §3.2, §5.1, §11.2.
 */
import { sql } from 'drizzle-orm';
import { drizzle, type PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';

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
  const sql = postgres(url, {
    prepare: false,
    max: 10,
    idle_timeout: 20,
    max_lifetime: 60 * 10,
  });

  _db = drizzle(sql, { schema, logger: process.env.DB_DEBUG === '1' });
  return _db;
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
