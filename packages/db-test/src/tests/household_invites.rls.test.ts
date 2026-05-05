/**
 * RLS isolation — `household_invites`.
 *
 * Trace: Story 1.4 AC2.
 */
import { afterAll, beforeEach, describe, expect, test } from 'vitest';

import { admin, insertHouseholdInvite } from '@/helpers/fixtures';
import { asUser, closeRlsHarness, expectRlsBlocks, resetData, seedTwoHouseholds } from '@/rls-harness';

afterAll(async () => {
  await closeRlsHarness();
});

describe('RLS isolation: household_invites', () => {
  beforeEach(async () => {
    await resetData();
  });

  test('cross-household SELECT bloqueado: userB não vê convites do householdA', async () => {
    const { householdA, householdB, userA, userB } = await seedTwoHouseholds();
    await insertHouseholdInvite(admin(), householdA.id, userA.id);

    await asUser(userB.id, householdB.id, async (sql) => {
      const rows = await sql`select id from public.household_invites`;
      expect(rows).toHaveLength(0);
    });
  });

  test('cross-household INSERT bloqueado: userB não pode enviar convites em nome de householdA', async () => {
    const { householdA, householdB, userB } = await seedTwoHouseholds();

    const blocked = await expectRlsBlocks(userB.id, householdB.id, async (sql) => {
      await insertHouseholdInvite(sql, householdA.id, userB.id);
    });
    expect(blocked).toBe(true);
  });

  test('owner do householdA vê os seus convites', async () => {
    const { householdA, userA } = await seedTwoHouseholds();
    await insertHouseholdInvite(admin(), householdA.id, userA.id);

    await asUser(userA.id, householdA.id, async (sql) => {
      const rows = await sql`select id from public.household_invites`;
      expect(rows).toHaveLength(1);
    });
  });
});
