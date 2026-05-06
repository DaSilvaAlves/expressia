#!/usr/bin/env tsx
/**
 * Verificador one-shot da migration 0002_auth_hook.sql.
 * Uso: pnpm --filter @meu-jarvis/db tsx src/scripts/verify-0002.ts
 *
 * Não é parte do schema/CI — script ad-hoc para validação manual após apply.
 */
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { config as loadEnv } from 'dotenv';
import postgres from 'postgres';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const PKG_ROOT = resolve(__dirname, '..', '..');
loadEnv({ path: join(PKG_ROOT, '.env.local') });

async function main(): Promise<number> {
  const url = process.env.DIRECT_URL;
  if (!url) {
    console.error('DIRECT_URL não definido.');
    return 1;
  }

  const sql = postgres(url, { max: 1, prepare: false });

  try {
    console.log('=== 1. Função existe? ===');
    const fn = await sql<
      { routine_name: string; data_type: string; security_type: string }[]
    >`
      select routine_name, data_type, security_type
      from information_schema.routines
      where routine_schema = 'public' and routine_name = 'custom_access_token_hook'
    `;
    console.log(fn);

    console.log('\n=== 2. Grants da função ===');
    const grants = await sql<{ grantee: string; privilege_type: string }[]>`
      select grantee, privilege_type
      from information_schema.routine_privileges
      where routine_schema = 'public' and routine_name = 'custom_access_token_hook'
      order by grantee
    `;
    console.log(grants);

    console.log('\n=== 3. Migration registada em __schema_migrations? ===');
    const tracking = await sql<{ name: string; applied_at: Date }[]>`
      select name, applied_at from public.__schema_migrations
      where name = '0002_auth_hook.sql'
    `;
    console.log(tracking);

    console.log('\n=== 4. Grant SELECT em household_members para supabase_auth_admin? ===');
    const tableGrants = await sql<{ grantee: string; privilege_type: string }[]>`
      select grantee, privilege_type
      from information_schema.role_table_grants
      where table_schema = 'public'
        and table_name = 'household_members'
        and grantee = 'supabase_auth_admin'
      order by privilege_type
    `;
    console.log(tableGrants);

    console.log('\n=== 5. Smoke test funcional ===');
    const smoke = await sql<{ result: unknown }[]>`
      select public.custom_access_token_hook(
        '{"user_id": "00000000-0000-0000-0000-000000000000", "claims": {"sub": "test"}}'::jsonb
      ) as result
    `;
    console.log(JSON.stringify(smoke[0]?.result, null, 2));

    console.log('\n=== 6. security_type & stability ===');
    const meta = await sql<
      { proname: string; prosecdef: boolean; provolatile: string }[]
    >`
      select p.proname, p.prosecdef, p.provolatile
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public' and p.proname = 'custom_access_token_hook'
    `;
    console.log(meta);

    return 0;
  } catch (err) {
    console.error('Erro:', err);
    return 1;
  } finally {
    await sql.end();
  }
}

main().then((c) => process.exit(c));
