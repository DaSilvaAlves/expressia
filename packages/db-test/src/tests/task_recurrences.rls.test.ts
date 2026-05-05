/**
 * RLS isolation — `task_recurrences` (FR8).
 *
 * Trace: Story 1.4 AC2.
 */
import { afterAll, beforeEach, describe, expect, test } from 'vitest';

import { admin, insertTask, insertTaskRecurrence } from '@/helpers/fixtures';
import { asUser, closeRlsHarness, expectRlsBlocks, resetData, seedTwoHouseholds } from '@/rls-harness';

afterAll(async () => {
  await closeRlsHarness();
});

describe('RLS isolation: task_recurrences', () => {
  beforeEach(async () => {
    await resetData();
  });

  test('cross-household SELECT bloqueado', async () => {
    const { householdA, householdB, userA, userB } = await seedTwoHouseholds();
    const taskId = await insertTask(admin(), householdA.id, userA.id);
    await insertTaskRecurrence(admin(), householdA.id, taskId);

    await asUser(userB.id, householdB.id, async (sql) => {
      const rows = await sql`select id from public.task_recurrences`;
      expect(rows).toHaveLength(0);
    });
  });

  test('cross-household INSERT bloqueado', async () => {
    const { householdA, householdB, userA, userB } = await seedTwoHouseholds();
    const taskId = await insertTask(admin(), householdA.id, userA.id);

    const blocked = await expectRlsBlocks(userB.id, householdB.id, async (sql) => {
      await insertTaskRecurrence(sql, householdA.id, taskId);
    });
    expect(blocked).toBe(true);
  });
});
