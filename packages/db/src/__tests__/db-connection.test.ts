/**
 * Smoke test de conexão DB — meu-jarvis (Expressia).
 *
 * Verifica que:
 *   1. O cliente Drizzle inicializa contra `DATABASE_URL` (pooler 6543).
 *   2. A tabela `categories` existe.
 *   3. O seed default PT-PT foi aplicado (>= 18 categorias com `is_default = true`).
 *
 * Estes testes só correm se `DATABASE_URL` (ou `DIRECT_URL`) estiver definido.
 * Em CI sem credenciais o teste é skipped via `it.skipIf`.
 *
 * Trace: Story 1.3 AC3, AC6, AC7.
 */
import { sql as drizzleSql } from 'drizzle-orm';
import { drizzle, type PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import * as schema from '@/schema';

// Carrega .env.local apenas em local dev — em CI as vars vêm do environment.
// (vitest-environment-node não carrega automaticamente, mas dotenv é leve.)
import { config as loadEnv } from 'dotenv';
loadEnv({ path: '.env.local' });

const DB_URL = process.env.DATABASE_URL ?? process.env.DIRECT_URL;
const HAS_DB = Boolean(DB_URL);

describe('@meu-jarvis/db DB connection smoke test', () => {
  let pgClient: ReturnType<typeof postgres> | null = null;
  let db: PostgresJsDatabase<typeof schema> | null = null;

  beforeAll(() => {
    if (!HAS_DB) return;
    pgClient = postgres(DB_URL!, {
      prepare: false, // compat pgbouncer transaction-mode (porta 6543)
      max: 2,
      idle_timeout: 5,
    });
    db = drizzle(pgClient, { schema });
  });

  afterAll(async () => {
    if (pgClient) {
      await pgClient.end();
    }
  });

  it.skipIf(!HAS_DB)('connects and runs a basic SELECT 1', async () => {
    const result = await db!.execute(drizzleSql`select 1 as ok`);
    expect(result).toBeDefined();
  });

  it.skipIf(!HAS_DB)('finds the categories table with default PT-PT seed (>= 18 rows)', async () => {
    const result = await db!.execute(
      drizzleSql`select count(*)::int as n from public.categories where is_default = true`,
    );
    // postgres.js retorna array-like com objectos; primeiro elemento é a row
    const rows = result as unknown as Array<{ n: number }>;
    expect(rows[0]).toBeDefined();
    expect(rows[0]!.n).toBeGreaterThanOrEqual(18);
  });

  it.skipIf(!HAS_DB)('has the 3 RLS helper functions', async () => {
    const result = await db!.execute(drizzleSql`
      select proname from pg_proc
      where proname in ('current_household_id', 'is_household_member', 'is_household_owner_or_admin')
    `);
    const rows = result as unknown as Array<{ proname: string }>;
    const names = rows.map((r) => r.proname).sort();
    expect(names).toEqual([
      'current_household_id',
      'is_household_member',
      'is_household_owner_or_admin',
    ]);
  });

  it.skipIf(!HAS_DB)('has at least 26 tables in public schema', async () => {
    const result = await db!.execute(drizzleSql`
      select count(*)::int as n
      from information_schema.tables
      where table_schema = 'public' and table_type = 'BASE TABLE'
    `);
    const rows = result as unknown as Array<{ n: number }>;
    // 26 tabelas de domínio + __schema_migrations (criada pelo runner) = 27+
    expect(rows[0]!.n).toBeGreaterThanOrEqual(26);
  });

  it.skipIf(!HAS_DB)('has at least 104 RLS policies', async () => {
    const result = await db!.execute(drizzleSql`
      select count(*)::int as n from pg_policies where schemaname = 'public'
    `);
    const rows = result as unknown as Array<{ n: number }>;
    expect(rows[0]!.n).toBeGreaterThanOrEqual(104);
  });
});
