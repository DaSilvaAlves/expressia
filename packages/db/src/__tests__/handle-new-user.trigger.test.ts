/**
 * Verificação estrutural do bootstrap de household no signup — Story 6.1 AC5/AC6.
 *
 * A Story 6.1 NÃO recria o trigger `handle_new_user` (entregue na Story 1.5,
 * migration 0003) — apenas o verifica+testa. Este teste promove o script
 * ad-hoc `src/scripts/verify-0003.ts` a regressão automatizada: confirma, de
 * forma read-only (sem criar `auth.users`), que o mecanismo continua presente
 * e bem-formado:
 *   - função `handle_new_user` existe e é SECURITY DEFINER (`prosecdef`);
 *   - trigger `on_auth_user_created` em `auth.users`, AFTER INSERT;
 *   - constraint `subscriptions_one_per_household` (suporta idempotência — AC5);
 *   - enum `subscription_status` inclui `trialing`; `plan_tier` inclui `familia`;
 *   - Auth Hook `custom_access_token_hook` existe (claim `household_id` — AC6).
 *
 * Só corre se `DATABASE_URL`/`DIRECT_URL` estiver definido (padrão
 * `it.skipIf(!HAS_DB)` da Story 1.3). O smoke FUNCIONAL (criar user → 3 linhas
 * + idempotência) exige o SDK Supabase Auth, não Postgres directo — fica
 * documentado como smoke manual em `docs/runbooks/supabase-auth-setup.md §6`
 * (dependente da infra E2E / suite Testcontainers da Story 1.4).
 *
 * Trace: Story 6.1 AC5/AC6/AC10; migrations 0002/0003; billing.ts:100.
 */
import { sql as drizzleSql } from 'drizzle-orm';
import { drizzle, type PostgresJsDatabase } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import * as schema from '@/schema';

import { config as loadEnv } from 'dotenv';
loadEnv({ path: '.env.local' });

const DB_URL = process.env.DATABASE_URL ?? process.env.DIRECT_URL;
const HAS_DB = Boolean(DB_URL);

describe('handle_new_user bootstrap (Story 6.1 AC5/AC6 — verificação estrutural)', () => {
  let pgClient: ReturnType<typeof postgres> | null = null;
  let db: PostgresJsDatabase<typeof schema> | null = null;

  beforeAll(() => {
    if (!HAS_DB) return;
    pgClient = postgres(DB_URL!, { prepare: false, max: 2, idle_timeout: 5 });
    db = drizzle(pgClient, { schema });
  });

  afterAll(async () => {
    if (pgClient) await pgClient.end();
  });

  it.skipIf(!HAS_DB)('handle_new_user existe e é SECURITY DEFINER', async () => {
    const result = await db!.execute(drizzleSql`
      select p.proname, p.prosecdef
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public' and p.proname = 'handle_new_user'
    `);
    const rows = result as unknown as Array<{ proname: string; prosecdef: boolean }>;
    expect(rows[0]).toBeDefined();
    expect(rows[0]!.prosecdef).toBe(true);
  });

  it.skipIf(!HAS_DB)('trigger on_auth_user_created está em auth.users AFTER INSERT', async () => {
    const result = await db!.execute(drizzleSql`
      select event_manipulation, action_timing, event_object_schema, event_object_table
      from information_schema.triggers
      where trigger_name = 'on_auth_user_created'
    `);
    const rows = result as unknown as Array<{
      event_manipulation: string;
      action_timing: string;
      event_object_schema: string;
      event_object_table: string;
    }>;
    expect(rows[0]).toBeDefined();
    expect(rows[0]!.event_manipulation).toBe('INSERT');
    expect(rows[0]!.action_timing).toBe('AFTER');
    expect(rows[0]!.event_object_schema).toBe('auth');
    expect(rows[0]!.event_object_table).toBe('users');
  });

  it.skipIf(!HAS_DB)(
    'constraint subscriptions_one_per_household existe (idempotência — AC5)',
    async () => {
      const result = await db!.execute(drizzleSql`
        select conname, contype from pg_constraint
        where conname = 'subscriptions_one_per_household'
      `);
      const rows = result as unknown as Array<{ conname: string; contype: string }>;
      expect(rows[0]).toBeDefined();
      expect(rows[0]!.contype).toBe('u'); // unique
    },
  );

  it.skipIf(!HAS_DB)('enums suportam trial família (trialing + familia)', async () => {
    const result = await db!.execute(drizzleSql`
      select t.typname, e.enumlabel
      from pg_type t
      join pg_enum e on e.enumtypid = t.oid
      where t.typname in ('subscription_status', 'plan_tier')
    `);
    const rows = result as unknown as Array<{ typname: string; enumlabel: string }>;
    const statusLabels = rows.filter((r) => r.typname === 'subscription_status').map((r) => r.enumlabel);
    const planLabels = rows.filter((r) => r.typname === 'plan_tier').map((r) => r.enumlabel);
    expect(statusLabels).toContain('trialing');
    expect(planLabels).toContain('familia');
  });

  it.skipIf(!HAS_DB)(
    'custom_access_token_hook existe (claim household_id no JWT — AC6)',
    async () => {
      const result = await db!.execute(drizzleSql`
        select p.proname, p.prosecdef
        from pg_proc p
        join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'public' and p.proname = 'custom_access_token_hook'
      `);
      const rows = result as unknown as Array<{ proname: string; prosecdef: boolean }>;
      expect(rows[0]).toBeDefined();
      expect(rows[0]!.prosecdef).toBe(true);
    },
  );
});
