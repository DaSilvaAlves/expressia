#!/usr/bin/env tsx
/**
 * Diagnóstico READ-ONLY (ACHADO-2 — RLS inerte em runtime?).
 *
 * Confirma/refuta empiricamente se a RLS multi-tenant está ATIVA em runtime
 * ou se o role da connection (owner) a bypassa por ausência de FORCE RLS.
 *
 * NÃO altera schema. Só faz SELECT sobre catálogos do Postgres.
 *
 * Uso: pnpm --filter @meu-jarvis/db exec tsx src/scripts/diag-rls-runtime.ts
 */
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { config as loadEnv } from 'dotenv';
import postgres from 'postgres';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const PKG_ROOT = resolve(__dirname, '..', '..');
loadEnv({ path: join(PKG_ROOT, '.env.local') });

async function probeConnection(label: string, url: string | undefined): Promise<void> {
  if (!url) {
    console.log(`\n### ${label}: NÃO definido`);
    return;
  }
  const sql = postgres(url, { prepare: false, max: 1 });
  try {
    const r = await sql<
      {
        current_user: string;
        session_user: string;
        is_superuser: string;
        rolbypassrls: boolean | null;
        auth_uid: string | null;
        jwt_claims: string | null;
        current_household: string | null;
      }[]
    >`
      select
        current_user,
        session_user,
        current_setting('is_superuser') as is_superuser,
        (select rolbypassrls from pg_roles where rolname = current_user) as rolbypassrls,
        auth.uid()::text as auth_uid,
        current_setting('request.jwt.claims', true) as jwt_claims,
        public.current_household_id()::text as current_household
    `;
    console.log(`\n### ${label}`);
    console.log(r[0]);
  } catch (err) {
    console.log(`\n### ${label}: ERRO`);
    console.error(err instanceof Error ? err.message : err);
  } finally {
    await sql.end();
  }
}

async function main(): Promise<number> {
  const direct = process.env.DIRECT_URL ?? process.env.DATABASE_URL_DIRECT;
  const runtime = process.env.DATABASE_URL;

  console.log('============================================================');
  console.log(' ACHADO-2 — Diagnóstico RLS runtime (READ-ONLY)');
  console.log('============================================================');

  // Q2 — role/identidade de cada connection
  await probeConnection('Q2a — DATABASE_URL (runtime, pgbouncer 6543)', runtime);
  await probeConnection('Q2b — DIRECT_URL (session 5432)', direct);

  // Usar DIRECT_URL para as queries de catálogo (session-mode, mais estável)
  const catUrl = direct ?? runtime;
  if (!catUrl) {
    console.error('Sem URL para queries de catálogo.');
    return 1;
  }
  const sql = postgres(catUrl, { prepare: false, max: 1 });
  try {
    // Q1 — FORCE RLS por tabela com household_id
    console.log('\n### Q1 — RLS state por tabela com coluna household_id');
    const rls = await sql<
      {
        tablename: string;
        rowsecurity: boolean;
        forcerowsecurity: boolean;
        tableowner: string;
        policy_count: number;
      }[]
    >`
      with dom as (
        select distinct c.relname as tablename
        from pg_attribute a
        join pg_class c on c.oid = a.attrelid
        join pg_namespace n on n.oid = c.relnamespace
        where a.attname = 'household_id'
          and a.attnum > 0
          and not a.attisdropped
          and c.relkind = 'r'
          and n.nspname = 'public'
      )
      select
        c.relname as tablename,
        c.relrowsecurity as rowsecurity,
        c.relforcerowsecurity as forcerowsecurity,
        pg_get_userbyid(c.relowner) as tableowner,
        (select count(*) from pg_policy p where p.polrelid = c.oid)::int as policy_count
      from pg_class c
      join pg_namespace n on n.oid = c.relnamespace
      join dom on dom.tablename = c.relname
      where n.nspname = 'public'
      order by c.relname
    `;
    console.table(rls);

    const total = rls.length;
    const rlsEnabled = rls.filter((t) => t.rowsecurity).length;
    const forced = rls.filter((t) => t.forcerowsecurity).length;
    console.log(
      `\nResumo: ${total} tabelas com household_id | rowsecurity=true em ${rlsEnabled} | forcerowsecurity=true em ${forced}`,
    );

    // Q3 — quem é o owner das tabelas (distinct)
    console.log('\n### Q3 — Owners distintos das tabelas de domínio');
    const owners = [...new Set(rls.map((t) => t.tableowner))];
    console.log(owners);

    // Q4 — comportamento dos helpers quando auth.uid() é NULL (sem claims)
    console.log('\n### Q4 — Helpers SQL sem claims (auth.uid() = NULL)');
    const helpers = await sql<
      {
        auth_uid: string | null;
        current_household: string | null;
        is_member_random: boolean | null;
      }[]
    >`
      select
        auth.uid()::text as auth_uid,
        public.current_household_id()::text as current_household,
        public.is_household_member('00000000-0000-0000-0000-000000000000'::uuid) as is_member_random
    `;
    console.log(helpers[0]);

    // Bónus — confirmar que rolbypassrls do owner explica o bypass
    console.log('\n### Bónus — rolbypassrls dos roles relevantes');
    const roles = await sql<{ rolname: string; rolsuper: boolean; rolbypassrls: boolean }[]>`
      select rolname, rolsuper, rolbypassrls
      from pg_roles
      where rolname in ('postgres', 'authenticated', 'anon', 'service_role', 'supabase_admin')
      order by rolname
    `;
    console.table(roles);

    return 0;
  } catch (err) {
    console.error('Erro nas queries de catálogo:', err);
    return 1;
  } finally {
    await sql.end();
  }
}

main().then((c) => process.exit(c));
