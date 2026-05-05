/**
 * RLS isolation — `subscriptions`.
 *
 * Notas (0001_rls_policies.sql):
 *   - SELECT permitido a membros do household.
 *   - INSERT/UPDATE/DELETE BLOQUEADOS para `authenticated` (Stripe webhook usa service_role).
 *
 * Trace: Story 1.4 AC2.
 */
import { afterAll, beforeEach, describe, expect, test } from 'vitest';

import { admin, insertSubscription } from '@/helpers/fixtures';
import { asUser, closeRlsHarness, expectRlsBlocks, resetData, seedTwoHouseholds } from '@/rls-harness';

afterAll(async () => {
  await closeRlsHarness();
});

describe('RLS isolation: subscriptions', () => {
  beforeEach(async () => {
    await resetData();
  });

  test('cross-household SELECT bloqueado', async () => {
    const { householdA, householdB, userB } = await seedTwoHouseholds();
    await insertSubscription(admin(), householdA.id);

    await asUser(userB.id, householdB.id, async (sql) => {
      const rows = await sql`select id from public.subscriptions`;
      expect(rows).toHaveLength(0);
    });
  });

  test('membros vêem subscrição do próprio household', async () => {
    const { householdA, userA } = await seedTwoHouseholds();
    await insertSubscription(admin(), householdA.id);

    await asUser(userA.id, householdA.id, async (sql) => {
      const rows = await sql`select id from public.subscriptions`;
      expect(rows).toHaveLength(1);
    });
  });

  test('INSERT bloqueado para authenticated (apenas service_role via webhook Stripe)', async () => {
    const { householdA, userA } = await seedTwoHouseholds();

    const blocked = await expectRlsBlocks(userA.id, householdA.id, async (sql) => {
      await insertSubscription(sql, householdA.id);
    });
    expect(blocked).toBe(true);
  });
});
