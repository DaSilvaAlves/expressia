/**
 * RLS isolation — `payment_methods`.
 *
 * Notas: SELECT APENAS owner/admin; INSERT/UPDATE/DELETE bloqueados (Stripe via service_role).
 *
 * Trace: Story 1.4 AC2.
 */
import { afterAll, beforeEach, describe, expect, test } from 'vitest';

import { admin, insertPaymentMethod } from '@/helpers/fixtures';
import { asUser, closeRlsHarness, expectRlsBlocks, resetData, seedTwoHouseholds } from '@/rls-harness';

afterAll(async () => {
  await closeRlsHarness();
});

describe('RLS isolation: payment_methods', () => {
  beforeEach(async () => {
    await resetData();
  });

  test('cross-household SELECT bloqueado', async () => {
    const { householdA, householdB, userB } = await seedTwoHouseholds();
    await insertPaymentMethod(admin(), householdA.id);

    await asUser(userB.id, householdB.id, async (sql) => {
      const rows = await sql`select id from public.payment_methods`;
      expect(rows).toHaveLength(0);
    });
  });

  test('INSERT bloqueado para authenticated', async () => {
    const { householdA, userA } = await seedTwoHouseholds();

    const blocked = await expectRlsBlocks(userA.id, householdA.id, async (sql) => {
      await insertPaymentMethod(sql, householdA.id);
    });
    expect(blocked).toBe(true);
  });
});
