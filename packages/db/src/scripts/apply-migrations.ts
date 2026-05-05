#!/usr/bin/env tsx
/**
 * Migration runner — meu-jarvis (Expressia)
 *
 * Aplica os ficheiros SQL handwritten em `packages/db/migrations/*.sql` em ordem
 * lexicográfica, dentro de uma transação por ficheiro.
 *
 * Usa `DIRECT_URL` (Supabase session pooler 5432) — migrations precisam de DDL
 * session-scoped que o transaction-mode pooler 6543 não suporta.
 *
 * Idempotência: cada ficheiro deve ser idempotente (ver `0000_initial_schema.sql`
 * e `0001_rls_policies.sql` — usam `create … if not exists` / `create or replace`).
 *
 * Tracking: registamos cada ficheiro aplicado em `public.__schema_migrations`
 * (criada na primeira corrida). Re-aplicar uma migration já registada é skip.
 *
 * Uso:
 *   pnpm db:migrate                       (lê DIRECT_URL de .env.local)
 *   DIRECT_URL=… tsx apply-migrations.ts  (manual)
 *
 * Trace: Story 1.3 AC3, AC4. Architecture §11.2, §11.4.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { config as loadEnv } from 'dotenv';
import postgres from 'postgres';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// packages/db/src/scripts/apply-migrations.ts → packages/db/
const PKG_ROOT = resolve(__dirname, '..', '..');
const MIGRATIONS_DIR = join(PKG_ROOT, 'migrations');

// Carregar .env.local antes de ler env vars
loadEnv({ path: join(PKG_ROOT, '.env.local') });

const TRACKING_TABLE = '__schema_migrations';

interface MigrationFile {
  name: string;
  path: string;
  sql: string;
}

function listMigrations(): MigrationFile[] {
  return readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith('.sql'))
    .filter((f) => !f.startsWith('_')) // ignora _journal etc.
    .sort()
    .map((name) => {
      const path = join(MIGRATIONS_DIR, name);
      return {
        name,
        path,
        sql: readFileSync(path, 'utf8'),
      };
    });
}

async function ensureTrackingTable(sql: postgres.Sql): Promise<void> {
  await sql.unsafe(`
    create table if not exists public.${TRACKING_TABLE} (
      name text primary key,
      applied_at timestamptz not null default now(),
      sha256 text
    );
    comment on table public.${TRACKING_TABLE} is
      'Registo de migrations aplicadas pelo runner custom (apply-migrations.ts).';
  `);
}

async function isApplied(sql: postgres.Sql, name: string): Promise<boolean> {
  const rows = await sql<{ name: string }[]>`
    select name from public.${sql(TRACKING_TABLE)} where name = ${name}
  `;
  return rows.length > 0;
}

async function markApplied(sql: postgres.Sql, name: string): Promise<void> {
  await sql`
    insert into public.${sql(TRACKING_TABLE)} (name) values (${name})
    on conflict (name) do nothing
  `;
}

async function applyMigration(sql: postgres.Sql, file: MigrationFile): Promise<void> {
  // Cada migration corre numa transação. Se falhar, rollback completo do ficheiro.
  // `check_function_bodies = off` permite criar funções `language sql` que referenciam
  // tabelas criadas mais à frente na mesma migration (forward references).
  await sql.begin(async (tx) => {
    await tx.unsafe('set local check_function_bodies = off;');
    await tx.unsafe(file.sql);
    await tx`
      insert into public.${tx(TRACKING_TABLE)} (name) values (${file.name})
      on conflict (name) do nothing
    `;
  });
}

async function main(): Promise<number> {
  const url = process.env.DIRECT_URL ?? process.env.DATABASE_URL_DIRECT;

  if (!url) {
    console.error(
      '[db:migrate] ERRO: DIRECT_URL não definido. Configure em packages/db/.env.local ' +
        'ou exporte na shell antes de correr.',
    );
    return 1;
  }

  // Para migrations queremos session-mode (porta 5432) — prepare statements OK.
  // Mas postgres.js detecta automaticamente pgbouncer; força `prepare: false` pelo sim
  // pelo não, garante compatibilidade tanto com pooler 5432 (session) como direct.
  const sql = postgres(url, {
    max: 1,
    prepare: false,
    onnotice: () => {
      // Suprimir NOTICEs ruidosos (ex: "extension already exists")
    },
  });

  const migrations = listMigrations();

  if (migrations.length === 0) {
    console.warn('[db:migrate] Nenhum ficheiro .sql em migrations/.');
    await sql.end();
    return 0;
  }

  console.log(`[db:migrate] ${migrations.length} migration(s) detectada(s):`);
  for (const m of migrations) {
    console.log(`  - ${m.name}`);
  }
  console.log('');

  try {
    await ensureTrackingTable(sql);

    for (const file of migrations) {
      const already = await isApplied(sql, file.name);
      if (already) {
        console.log(`[skip] ${file.name} (já registada em ${TRACKING_TABLE})`);
        continue;
      }

      const start = Date.now();
      console.log(`[apply] ${file.name} …`);
      try {
        await applyMigration(sql, file);
        const ms = Date.now() - start;
        console.log(`[done]  ${file.name} em ${ms}ms`);
      } catch (err) {
        console.error(`[fail]  ${file.name}: ${(err as Error).message}`);
        throw err;
      }
    }

    console.log('\n✅ Todas as migrations aplicadas com sucesso.');
    return 0;
  } catch (err) {
    console.error('\n❌ Migration falhou:', err);
    return 1;
  } finally {
    await sql.end();
  }
}

main()
  .then((code) => process.exit(code))
  .catch((err) => {
    console.error('[db:migrate] Erro inesperado:', err);
    process.exit(1);
  });
