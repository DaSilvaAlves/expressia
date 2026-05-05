/**
 * RLS isolation — `data_export_jobs` (FR28 — GDPR Art. 20).
 *
 * Notas (0001_rls_policies.sql):
 *   - INSERT requer `is_household_member` E `requested_by_user_id = auth.uid()`.
 *   - UPDATE/DELETE bloqueados (job state mudado por service_role).
 *
 * Trace: Story 1.4 AC2.
 */
import { afterAll, beforeEach, describe, expect, test } from 'vitest';

import { admin, insertDataExportJob } from '@/helpers/fixtures';
import { asUser, closeRlsHarness, expectRlsBlocks, resetData, seedTwoHouseholds } from '@/rls-harness';

afterAll(async () => {
  await closeRlsHarness();
});

describe('RLS isolation: data_export_jobs', () => {
  beforeEach(async () => {
    await resetData();
  });

  test('cross-household SELECT bloqueado', async () => {
    const { householdA, householdB, userA, userB } = await seedTwoHouseholds();
    await insertDataExportJob(admin(), householdA.id, userA.id);

    await asUser(userB.id, householdB.id, async (sql) => {
      const rows = await sql`select id from public.data_export_jobs`;
      expect(rows).toHaveLength(0);
    });
  });

  test('cross-household INSERT bloqueado', async () => {
    const { householdA, householdB, userB } = await seedTwoHouseholds();

    const blocked = await expectRlsBlocks(userB.id, householdB.id, async (sql) => {
      await insertDataExportJob(sql, householdA.id, userB.id);
    });
    expect(blocked).toBe(true);
  });

  test('UPDATE bloqueado para authenticated', async () => {
    const { householdA, userA } = await seedTwoHouseholds();
    const jobId = await insertDataExportJob(admin(), householdA.id, userA.id);

    await asUser(userA.id, householdA.id, async (sql) => {
      const result = await sql`update public.data_export_jobs set status = 'ready' where id = ${jobId}`;
      expect(result.count).toBe(0);
    });
  });
});
