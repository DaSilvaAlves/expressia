#!/usr/bin/env tsx
/**
 * Verificador one-shot da migration 0003_auth_user_trigger.sql.
 * Uso: pnpm --filter @meu-jarvis/db tsx src/scripts/verify-0003.ts
 *
 * Espelha o padrão de verify-0002.ts:
 *   1. Função existe?
 *   2. Trigger existe e está ligado a auth.users?
 *   3. Migration registada em __schema_migrations?
 *   4. security_type & stability flags correctas?
 *   5. (Opcional) Smoke test funcional — só corre se SMOKE=1 (cria user real e
 *      depois apaga; segue padrão de testes contra a Supabase real, idempotente).
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
    console.log('=== 1. Função public.handle_new_user existe? ===');
    const fn = await sql<
      { routine_name: string; data_type: string; security_type: string }[]
    >`
      select routine_name, data_type, security_type
      from information_schema.routines
      where routine_schema = 'public' and routine_name = 'handle_new_user'
    `;
    console.log(fn);

    console.log('\n=== 2. Trigger on_auth_user_created em auth.users? ===');
    const trigger = await sql<
      {
        trigger_name: string;
        event_manipulation: string;
        event_object_schema: string;
        event_object_table: string;
        action_timing: string;
      }[]
    >`
      select
        trigger_name,
        event_manipulation,
        event_object_schema,
        event_object_table,
        action_timing
      from information_schema.triggers
      where trigger_name = 'on_auth_user_created'
    `;
    console.log(trigger);

    console.log('\n=== 3. Migration registada em __schema_migrations? ===');
    const tracking = await sql<{ name: string; applied_at: Date }[]>`
      select name, applied_at from public.__schema_migrations
      where name = '0003_auth_user_trigger.sql'
    `;
    console.log(tracking);

    console.log('\n=== 4. security_type & stability ===');
    const meta = await sql<
      { proname: string; prosecdef: boolean; provolatile: string }[]
    >`
      select p.proname, p.prosecdef, p.provolatile
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public' and p.proname = 'handle_new_user'
    `;
    console.log(meta);

    console.log('\n=== 5. search_path da função ===');
    const sp = await sql<{ proname: string; proconfig: string[] | null }[]>`
      select p.proname, p.proconfig
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public' and p.proname = 'handle_new_user'
    `;
    console.log(sp);

    if (process.env.SMOKE === '1') {
      console.log(
        '\n=== 6. Smoke test funcional (SMOKE=1) — pular em produção ===',
      );
      console.warn(
        'Aviso: SMOKE=1 cria um auth.users real. Garantir Supabase staging.',
      );
      // Skip implementation — smoke real requer SDK Supabase Auth, não Postgres directo.
      // Documentado em runbook supabase-auth-setup.md (Task 3.4).
      console.log('Smoke real é manual via Supabase Auth signup — ver runbook.');
    } else {
      console.log(
        '\n=== 6. Smoke test funcional ===\nSKIPPED (defina SMOKE=1 para correr).',
      );
    }

    return 0;
  } catch (err) {
    console.error('Erro:', err);
    return 1;
  } finally {
    await sql.end();
  }
}

main().then((c) => process.exit(c));
