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

  // Story 3.1 AC5/AC6 — extension UPDATE+DELETE cross-household.
  test('cross-household UPDATE bloqueado: userB não actualiza recurrence do householdA', async () => {
    const { householdA, householdB, userA, userB } = await seedTwoHouseholds();
    const taskId = await insertTask(admin(), householdA.id, userA.id);
    const recurrenceId = await insertTaskRecurrence(admin(), householdA.id, taskId);

    await asUser(userB.id, householdB.id, async (sql) => {
      const result = await sql`
        update public.task_recurrences set frequency = 'daily' where id = ${recurrenceId}
      `;
      expect(result.count).toBe(0);
    });

    const rows = await admin()<{ frequency: string }[]>`
      select frequency from public.task_recurrences where id = ${recurrenceId}
    `;
    expect(rows[0]?.frequency).toBe('weekly');
  });

  test('cross-household DELETE bloqueado: userB não apaga recurrence do householdA', async () => {
    const { householdA, householdB, userA, userB } = await seedTwoHouseholds();
    const taskId = await insertTask(admin(), householdA.id, userA.id);
    const recurrenceId = await insertTaskRecurrence(admin(), householdA.id, taskId);

    await asUser(userB.id, householdB.id, async (sql) => {
      const result = await sql`delete from public.task_recurrences where id = ${recurrenceId}`;
      expect(result.count).toBe(0);
    });

    const rows = await admin()<{ n: number }[]>`
      select count(*)::int as n from public.task_recurrences where id = ${recurrenceId}
    `;
    expect(rows[0]?.n).toBe(1);
  });
});
