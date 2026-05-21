/**
 * RLS isolation — `recurrences` (FR14 — finanças recorrentes).
 *
 * Trace: Story 1.4 AC2.
 */
import { afterAll, beforeEach, describe, expect, test } from 'vitest';

import { admin, insertAccount, insertRecurrence } from '@/helpers/fixtures';
import { asUser, closeRlsHarness, expectRlsBlocks, resetData, seedTwoHouseholds } from '@/rls-harness';

afterAll(async () => {
  await closeRlsHarness();
});

describe('RLS isolation: recurrences', () => {
  beforeEach(async () => {
    await resetData();
  });

  test('cross-household SELECT bloqueado', async () => {
    const { householdA, householdB, userA, userB } = await seedTwoHouseholds();
    const accId = await insertAccount(admin(), householdA.id);
    await insertRecurrence(admin(), householdA.id, userA.id, accId);

    await asUser(userB.id, householdB.id, async (sql) => {
      const rows = await sql`select id from public.recurrences`;
      expect(rows).toHaveLength(0);
    });
  });

  test('cross-household INSERT bloqueado', async () => {
    const { householdA, householdB, userB } = await seedTwoHouseholds();
    const accId = await insertAccount(admin(), householdA.id);

    const blocked = await expectRlsBlocks(userB.id, householdB.id, async (sql) => {
      await insertRecurrence(sql, householdA.id, userB.id, accId);
    });
    expect(blocked).toBe(true);
  });

  test('cross-household UPDATE bloqueado: userB não pode editar recorrência de A', async () => {
    const { householdA, householdB, userA, userB } = await seedTwoHouseholds();
    const accId = await insertAccount(admin(), householdA.id);
    const recId = await insertRecurrence(admin(), householdA.id, userA.id, accId);

    await asUser(userB.id, householdB.id, async (sql) => {
      const result = await sql`update public.recurrences set description = 'hijack' where id = ${recId}`;
      expect(result.count).toBe(0);
    });
  });

  test('cross-household DELETE bloqueado: userB não pode eliminar recorrência de A', async () => {
    const { householdA, householdB, userA, userB } = await seedTwoHouseholds();
    const accId = await insertAccount(admin(), householdA.id);
    const recId = await insertRecurrence(admin(), householdA.id, userA.id, accId);

    await asUser(userB.id, householdB.id, async (sql) => {
      const result = await sql`delete from public.recurrences where id = ${recId}`;
      expect(result.count).toBe(0);
    });
  });
});
