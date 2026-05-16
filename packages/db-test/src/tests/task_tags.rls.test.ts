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

  // Story 3.1 AC5/AC6 — extension UPDATE+DELETE cross-household.
  // task_tags policies são standard `member` (sem variant owner_admin).
  test('cross-household UPDATE bloqueado: userB não actualiza task_tags do householdA', async () => {
    const { householdA, householdB, userA, userB } = await seedTwoHouseholds();
    const taskId = await insertTask(admin(), householdA.id, userA.id);
    const tagId = await insertTag(admin(), householdA.id);
    await insertTaskTag(admin(), taskId, tagId, householdA.id);

    await asUser(userB.id, householdB.id, async (sql) => {
      // task_tags only has (task_id, tag_id, household_id, created_at). Update created_at é o único campo seguro.
      const result = await sql`
        update public.task_tags set created_at = now() where task_id = ${taskId} and tag_id = ${tagId}
      `;
      expect(result.count).toBe(0);
    });

    const rows = await admin()<{ n: number }[]>`
      select count(*)::int as n from public.task_tags where task_id = ${taskId} and tag_id = ${tagId}
    `;
    expect(rows[0]?.n).toBe(1);
  });

  test('cross-household DELETE bloqueado: userB não apaga task_tags do householdA', async () => {
    const { householdA, householdB, userA, userB } = await seedTwoHouseholds();
    const taskId = await insertTask(admin(), householdA.id, userA.id);
    const tagId = await insertTag(admin(), householdA.id);
    await insertTaskTag(admin(), taskId, tagId, householdA.id);

    await asUser(userB.id, householdB.id, async (sql) => {
      const result = await sql`
        delete from public.task_tags where task_id = ${taskId} and tag_id = ${tagId}
      `;
      expect(result.count).toBe(0);
    });

    const rows = await admin()<{ n: number }[]>`
      select count(*)::int as n from public.task_tags where task_id = ${taskId} and tag_id = ${tagId}
    `;
    expect(rows[0]?.n).toBe(1);
  });
});
