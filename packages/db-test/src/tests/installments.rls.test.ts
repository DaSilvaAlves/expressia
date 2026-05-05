/**
 * RLS isolation — `installments` (FR16).
 *
 * Trace: Story 1.4 AC2.
 */
import { afterAll, beforeEach, describe, expect, test } from 'vitest';

import { admin, insertAccount, insertCard, insertInstallment } from '@/helpers/fixtures';
import { asUser, closeRlsHarness, expectRlsBlocks, resetData, seedTwoHouseholds } from '@/rls-harness';

afterAll(async () => {
  await closeRlsHarness();
});

describe('RLS isolation: installments', () => {
  beforeEach(async () => {
    await resetData();
  });

  test('cross-household SELECT bloqueado', async () => {
    const { householdA, householdB, userA, userB } = await seedTwoHouseholds();
    const accId = await insertAccount(admin(), householdA.id);
    const cardId = await insertCard(admin(), householdA.id, accId);
    await insertInstallment(admin(), householdA.id, userA.id, cardId);

    await asUser(userB.id, householdB.id, async (sql) => {
      const rows = await sql`select id from public.installments`;
      expect(rows).toHaveLength(0);
    });
  });

  test('cross-household INSERT bloqueado', async () => {
    const { householdA, householdB, userB } = await seedTwoHouseholds();
    const accId = await insertAccount(admin(), householdA.id);
    const cardId = await insertCard(admin(), householdA.id, accId);

    const blocked = await expectRlsBlocks(userB.id, householdB.id, async (sql) => {
      await insertInstallment(sql, householdA.id, userB.id, cardId);
    });
    expect(blocked).toBe(true);
  });
});
