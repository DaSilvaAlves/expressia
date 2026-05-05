/**
 * Smoke test do harness — verifica que:
 *   1. O container Postgres 16 subiu e aceita queries.
 *   2. As migrations de produção foram aplicadas (27+ tabelas em public).
 *   3. As 104 RLS policies estão activas.
 *   4. O bootstrap do harness criou role authenticated + funções auth.uid()/auth.jwt().
 *   5. seedTwoHouseholds() consegue inserir e asUser() comuta para role authenticated.
 *
 * Este teste deve ser o primeiro a correr — se falhar, todos os outros falham por
 * cascata. Por ordem alfabética, "harness" vem antes da maioria dos nomes de tabelas.
 *
 * Trace: Story 1.4 AC1, AC3, AC4, AC5.
 */
import { afterAll, beforeEach, describe, expect, test } from 'vitest';

import {
  asUser,
  closeRlsHarness,
  getRlsHarness,
  resetData,
  seedTwoHouseholds,
} from '@/rls-harness';

afterAll(async () => {
  await closeRlsHarness();
});

describe('harness — smoke test do ambiente Postgres + bootstrap + migrations', () => {
  beforeEach(async () => {
    await resetData();
  });

  test('container Postgres 16 está reachable e responde a select 1', async () => {
    const { adminSql } = getRlsHarness();
    const result = await adminSql<{ ok: number }[]>`select 1 as ok`;
    expect(result[0]?.ok).toBe(1);
  });

  test('schema de produção tem >= 26 tabelas em public', async () => {
    const { adminSql } = getRlsHarness();
    const rows = await adminSql<{ n: number }[]>`
      select count(*)::int as n
      from information_schema.tables
      where table_schema = 'public' and table_type = 'BASE TABLE'
    `;
    expect(rows[0]?.n ?? 0).toBeGreaterThanOrEqual(26);
  });

  test('RLS está habilitado nas 22+ tabelas multi-tenant', async () => {
    const { adminSql } = getRlsHarness();
    const rows = await adminSql<{ n: number }[]>`
      select count(*)::int as n
      from pg_class c
      join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public' and c.relrowsecurity = true
    `;
    expect(rows[0]?.n ?? 0).toBeGreaterThanOrEqual(22);
  });

  test('migrations de produção criaram >= 100 RLS policies', async () => {
    const { adminSql } = getRlsHarness();
    const rows = await adminSql<{ n: number }[]>`
      select count(*)::int as n from pg_policies where schemaname = 'public'
    `;
    expect(rows[0]?.n ?? 0).toBeGreaterThanOrEqual(100);
  });

  test('bootstrap criou role authenticated + funções auth.uid()/auth.jwt()', async () => {
    const { adminSql } = getRlsHarness();

    const roles = await adminSql<{ rolname: string }[]>`
      select rolname from pg_roles where rolname in ('authenticated', 'anon', 'service_role')
    `;
    expect(roles.map((r) => r.rolname).sort()).toEqual([
      'anon',
      'authenticated',
      'service_role',
    ]);

    const fns = await adminSql<{ proname: string }[]>`
      select proname from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'auth' and p.proname in ('uid', 'jwt')
    `;
    expect(fns.map((r) => r.proname).sort()).toEqual(['jwt', 'uid']);
  });

  test('seedTwoHouseholds() insere 2 households + 2 users + 2 memberships', async () => {
    const { adminSql } = getRlsHarness();
    const seed = await seedTwoHouseholds();

    expect(seed.householdA.id).toMatch(/^[0-9a-f-]{36}$/i);
    expect(seed.householdB.id).toMatch(/^[0-9a-f-]{36}$/i);
    expect(seed.userA.id).not.toBe(seed.userB.id);

    const counts = await adminSql<{ n: number }[]>`
      select count(*)::int as n from public.households
    `;
    expect(counts[0]?.n).toBe(2);

    const members = await adminSql<{ n: number }[]>`
      select count(*)::int as n from public.household_members
    `;
    expect(members[0]?.n).toBe(2);
  });

  test('asUser() comuta o role para authenticated e injecta JWT claims', async () => {
    const { userA, householdA } = await seedTwoHouseholds();

    await asUser(userA.id, householdA.id, async (sql) => {
      const role = await sql<{ current_user: string }[]>`select current_user`;
      expect(role[0]?.current_user).toBe('authenticated');

      const sub = await sql<{ uid: string | null }[]>`select auth.uid() as uid`;
      expect(sub[0]?.uid).toBe(userA.id);

      const claims = await sql<{ claims: { household_id: string } }[]>`
        select auth.jwt() as claims
      `;
      expect(claims[0]?.claims.household_id).toBe(householdA.id);
    });
  });
});
