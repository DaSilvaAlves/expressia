#!/usr/bin/env tsx
/**
 * Verification script — Story 3.4 T10 migration 0011 cross-confirms.
 *
 * One-shot script used by @data-engineer (Dara) para validar pós-aplicação:
 *   - enum audit_action tem +4 valores kanban_column.*
 *   - kanban_columns.is_done_column é boolean (era text)
 *   - partial unique kanban_columns_done_unique existe
 *   - trigger kanban_columns_max_check existe
 *   - __schema_migrations tem entry 0011
 *   - RLS policies kanban_columns mantém 4 (NFR5 preservada)
 *
 * Pode ser eliminado após validação concluída (housekeeping NIT @dev sucessor).
 */
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { config as loadEnv } from 'dotenv';
import postgres from 'postgres';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const PKG_ROOT = resolve(__dirname, '..', '..');
loadEnv({ path: join(PKG_ROOT, '.env.local') });

const url = process.env.DIRECT_URL ?? process.env.DATABASE_URL_DIRECT;
if (!url) {
  console.error('ERRO: DIRECT_URL não definido.');
  process.exit(1);
}

const sql = postgres(url, { max: 1, prepare: false, onnotice: () => {} });

async function main(): Promise<number> {
  let exitCode = 0;
  try {
    // CHECK 1 — audit_action novos valores
    const enums = await sql<{ enumlabel: string }[]>`
      select enumlabel
        from pg_enum
       where enumtypid = 'public.audit_action'::regtype
         and enumlabel like 'kanban_column.%'
       order by enumsortorder
    `;
    console.log('CHECK 1 — audit_action kanban_column.* values:');
    enums.forEach((r) => console.log(`  - ${r.enumlabel}`));
    console.log(`  Total: ${enums.length} (esperado 4)`);
    if (enums.length !== 4) exitCode = 1;

    // CHECK 2 — total enum count
    const total = await sql<{ n: number }[]>`
      select count(*)::int as n
        from pg_enum
       where enumtypid = 'public.audit_action'::regtype
    `;
    console.log(`\nCHECK 2 — audit_action total count: ${total[0]?.n} (esperado 38 = 34 + 4)`);
    if (total[0]?.n !== 38) exitCode = 1;

    // CHECK 3 — column type
    const col = await sql<
      { column_name: string; data_type: string; column_default: string | null; is_nullable: string }[]
    >`
      select column_name, data_type, column_default, is_nullable
        from information_schema.columns
       where table_schema = 'public'
         and table_name = 'kanban_columns'
         and column_name = 'is_done_column'
    `;
    console.log('\nCHECK 3 — kanban_columns.is_done_column:');
    console.log(`  data_type: ${col[0]?.data_type} (esperado boolean)`);
    console.log(`  column_default: ${col[0]?.column_default}`);
    console.log(`  is_nullable: ${col[0]?.is_nullable} (esperado NO)`);
    if (col[0]?.data_type !== 'boolean') exitCode = 1;
    if (col[0]?.is_nullable !== 'NO') exitCode = 1;

    // CHECK 4 — partial unique index
    const idx = await sql<{ indexname: string; indexdef: string }[]>`
      select indexname, indexdef
        from pg_indexes
       where schemaname = 'public'
         and indexname = 'kanban_columns_done_unique'
    `;
    console.log('\nCHECK 4 — partial unique index kanban_columns_done_unique:');
    if (idx.length === 0) {
      console.log('  MISSING');
      exitCode = 1;
    } else {
      idx.forEach((r) => console.log(`  - ${r.indexname}\n    ${r.indexdef}`));
    }

    // CHECK 5 — trigger
    const trg = await sql<{ tgname: string; tgenabled: string }[]>`
      select tgname, tgenabled
        from pg_trigger
       where tgrelid = 'public.kanban_columns'::regclass
         and tgname = 'kanban_columns_max_check'
    `;
    console.log('\nCHECK 5 — trigger kanban_columns_max_check:');
    if (trg.length === 0) {
      console.log('  MISSING');
      exitCode = 1;
    } else {
      trg.forEach((r) => console.log(`  - ${r.tgname} | enabled: ${r.tgenabled}`));
    }

    // CHECK 6 — migration tracking
    const mig = await sql<{ name: string; applied_at: Date }[]>`
      select name, applied_at
        from public.__schema_migrations
       where name = '0011_kanban_columns_schema_and_audit_enum.sql'
    `;
    console.log('\nCHECK 6 — __schema_migrations entry:');
    if (mig.length === 0) {
      console.log('  MISSING');
      exitCode = 1;
    } else {
      mig.forEach((r) => console.log(`  - ${r.name} | applied_at: ${r.applied_at.toISOString()}`));
    }

    // CHECK 7 — RLS policies count
    const pol = await sql<{ policyname: string; cmd: string }[]>`
      select policyname, cmd
        from pg_policies
       where schemaname = 'public'
         and tablename = 'kanban_columns'
       order by policyname
    `;
    console.log('\nCHECK 7 — kanban_columns RLS policies:');
    console.log(`  Total: ${pol.length} (esperado 4 — NFR5)`);
    pol.forEach((p) => console.log(`  - ${p.policyname} | cmd: ${p.cmd}`));
    if (pol.length !== 4) exitCode = 1;

    console.log(`\n=== VERIFICATION ${exitCode === 0 ? 'PASS' : 'FAIL'} ===`);
    return exitCode;
  } finally {
    await sql.end();
  }
}

main()
  .then((c) => process.exit(c))
  .catch((e) => {
    console.error('Erro inesperado:', e);
    process.exit(1);
  });
