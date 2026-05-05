/**
 * RLS isolation — `feature_flags`.
 *
 * Notas (0001_rls_policies.sql):
 *   - SELECT: globais (household_id NULL) ou membros do household.
 *   - INSERT/UPDATE/DELETE bloqueados (apenas service_role gere flags).
 *
 * Trace: Story 1.4 AC2.
 */
import { afterAll, beforeEach, describe, expect, test } from 'vitest';

import { admin, insertFeatureFlag } from '@/helpers/fixtures';
import { asUser, closeRlsHarness, expectRlsBlocks, resetData, seedTwoHouseholds } from '@/rls-harness';

afterAll(async () => {
  await closeRlsHarness();
});

describe('RLS isolation: feature_flags', () => {
  beforeEach(async () => {
    await resetData();
    await admin()`delete from public.feature_flags`;
  });

  test('cross-household SELECT bloqueado para flags per-household', async () => {
    const { householdA, householdB, userB } = await seedTwoHouseholds();
    await insertFeatureFlag(admin(), householdA.id, 'flag-A');

    await asUser(userB.id, householdB.id, async (sql) => {
      const rows = await sql`
        select id from public.feature_flags where household_id = ${householdA.id}
      `;
      expect(rows).toHaveLength(0);
    });
  });

  test('CASO ESPECIAL: flags globais (household_id NULL) visíveis a todos os utilizadores', async () => {
    const { userA, userB, householdA, householdB } = await seedTwoHouseholds();
    await insertFeatureFlag(admin(), null, 'beta-feature');

    await asUser(userA.id, householdA.id, async (sql) => {
      const rows = await sql<{ flag_key: string }[]>`
        select flag_key from public.feature_flags where household_id is null
      `;
      expect(rows.map((r) => r.flag_key)).toEqual(['beta-feature']);
    });

    await asUser(userB.id, householdB.id, async (sql) => {
      const rows = await sql<{ flag_key: string }[]>`
        select flag_key from public.feature_flags where household_id is null
      `;
      expect(rows.map((r) => r.flag_key)).toEqual(['beta-feature']);
    });
  });

  test('INSERT bloqueado para authenticated', async () => {
    const { householdA, userA } = await seedTwoHouseholds();

    const blocked = await expectRlsBlocks(userA.id, householdA.id, async (sql) => {
      await insertFeatureFlag(sql, householdA.id, 'tentativa');
    });
    expect(blocked).toBe(true);
  });
});
