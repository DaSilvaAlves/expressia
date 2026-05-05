/**
 * RLS isolation — `account_deletion_jobs` (FR29 — GDPR Art. 17).
 *
 * Notas (0001_rls_policies.sql):
 *   - SELECT/INSERT/UPDATE: APENAS role 'owner' do household (operação destrutiva).
 *   - DELETE bloqueado.
 *
 * Trace: Story 1.4 AC2.
 */
import { afterAll, beforeEach, describe, expect, test } from 'vitest';

import { admin, insertAccountDeletionJob } from '@/helpers/fixtures';
import { asUser, closeRlsHarness, expectRlsBlocks, resetData, seedTwoHouseholds } from '@/rls-harness';

afterAll(async () => {
  await closeRlsHarness();
});

describe('RLS isolation: account_deletion_jobs', () => {
  beforeEach(async () => {
    await resetData();
  });

  test('cross-household SELECT bloqueado', async () => {
    const { householdA, householdB, userA, userB } = await seedTwoHouseholds();
    await insertAccountDeletionJob(admin(), householdA.id, userA.id);

    await asUser(userB.id, householdB.id, async (sql) => {
      const rows = await sql`select id from public.account_deletion_jobs`;
      expect(rows).toHaveLength(0);
    });
  });

  test('cross-household INSERT bloqueado', async () => {
    const { householdA, householdB, userB } = await seedTwoHouseholds();

    const blocked = await expectRlsBlocks(userB.id, householdB.id, async (sql) => {
      await insertAccountDeletionJob(sql, householdA.id, userB.id);
    });
    expect(blocked).toBe(true);
  });

  test('owner do householdA vê o seu job de eliminação', async () => {
    const { householdA, userA } = await seedTwoHouseholds();
    await insertAccountDeletionJob(admin(), householdA.id, userA.id);

    await asUser(userA.id, householdA.id, async (sql) => {
      const rows = await sql`select id from public.account_deletion_jobs`;
      expect(rows).toHaveLength(1);
    });
  });
});
