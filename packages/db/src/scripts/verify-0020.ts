#!/usr/bin/env tsx
/**
 * Verificador one-shot da migration 0020_accept_invite_function.sql.
 * Uso: pnpm --filter @meu-jarvis/db tsx src/scripts/verify-0020.ts
 *
 * Espelha o padrão de verify-0003.ts. Confirma em prod (DIRECT_URL):
 *   1. Função public.accept_invite(text) existe?
 *   2. SECURITY DEFINER + search_path fixo?
 *   3. GRANT EXECUTE a `authenticated`? (sem ele → "permission denied")
 *   4. Migration registada em __schema_migrations?
 *
 * Não é parte do schema/CI — script ad-hoc para validação manual (SMOKE-6.7).
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
    console.log('=== 1. Função public.accept_invite existe? (proname/secdef/volatile) ===');
    const meta = await sql<
      { proname: string; prosecdef: boolean; provolatile: string; args: string }[]
    >`
      select p.proname, p.prosecdef, p.provolatile,
             pg_get_function_identity_arguments(p.oid) as args
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public' and p.proname = 'accept_invite'
    `;
    console.log(meta);

    console.log('\n=== 2. search_path (proconfig) ===');
    const sp = await sql<{ proname: string; proconfig: string[] | null }[]>`
      select p.proname, p.proconfig
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public' and p.proname = 'accept_invite'
    `;
    console.log(sp);

    console.log('\n=== 3. GRANT EXECUTE a authenticated? ===');
    const grant = await sql<{ has_execute: boolean }[]>`
      select has_function_privilege('authenticated', p.oid, 'EXECUTE') as has_execute
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public' and p.proname = 'accept_invite'
    `;
    console.log(grant);

    console.log('\n=== 4. Migration registada em __schema_migrations? ===');
    const tracking = await sql<{ name: string; applied_at: Date }[]>`
      select name, applied_at from public.__schema_migrations
      where name = '0020_accept_invite_function.sql'
    `;
    console.log(tracking);

    const ok =
      meta.length === 1 &&
      meta[0]!.prosecdef === true &&
      grant.length === 1 &&
      grant[0]!.has_execute === true &&
      tracking.length === 1;
    console.log(`\n=== VEREDICTO: ${ok ? 'PASS ✅' : 'FAIL ❌'} ===`);
    return ok ? 0 : 1;
  } catch (err) {
    console.error('Erro:', err);
    return 1;
  } finally {
    await sql.end();
  }
}

main().then((c) => process.exit(c));
