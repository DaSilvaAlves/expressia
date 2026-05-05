/**
 * RLS isolation — `task_tags` (pivot many-to-many task × tag).
 *
 * Trace: Story 1.4 AC2.
 */
import { afterAll, beforeEach, describe, expect, test } from 'vitest';

import { admin, insertTag, insertTask, insertTaskTag } from '@/helpers/fixtures';
import { asUser, closeRlsHarness, expectRlsBlocks, resetData, seedTwoHouseholds } from '@/rls-harness';

afterAll(async () => {
  await closeRlsHarness();
});

describe('RLS isolation: task_tags', () => {
  beforeEach(async () => {
    await resetData();
  });

  test('cross-household SELECT bloqueado', async () => {
    const { householdA, householdB, userA, userB } = await seedTwoHouseholds();
    const taskId = await insertTask(admin(), householdA.id, userA.id);
    const tagId = await insertTag(admin(), householdA.id, 'casa');
    await insertTaskTag(admin(), taskId, tagId, householdA.id);

    await asUser(userB.id, householdB.id, async (sql) => {
      const rows = await sql`select task_id from public.task_tags`;
      expect(rows).toHaveLength(0);
    });
  });

  test('cross-household INSERT bloqueado', async () => {
    const { householdA, householdB, userA, userB } = await seedTwoHouseholds();
    const taskId = await insertTask(admin(), householdA.id, userA.id);
    const tagId = await insertTag(admin(), householdA.id);

    const blocked = await expectRlsBlocks(userB.id, householdB.id, async (sql) => {
      await insertTaskTag(sql, taskId, tagId, householdA.id);
    });
    expect(blocked).toBe(true);
  });
});
