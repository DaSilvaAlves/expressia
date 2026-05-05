/**
 * RLS isolation — `invoices`.
 *
 * Notas (0001_rls_policies.sql):
 *   - SELECT: APENAS owner/admin (NIF é PII).
 *   - INSERT/UPDATE/DELETE bloqueados para authenticated (Stripe via service_role).
 *
 * Trace: Story 1.4 AC2.
 */
import { afterAll, beforeEach, describe, expect, test } from 'vitest';

import { admin, insertInvoice } from '@/helpers/fixtures';
import { asUser, closeRlsHarness, expectRlsBlocks, resetData, seedTwoHouseholds } from '@/rls-harness';

afterAll(async () => {
  await closeRlsHarness();
});

describe('RLS isolation: invoices', () => {
  beforeEach(async () => {
    await resetData();
  });

  test('cross-household SELECT bloqueado', async () => {
    const { householdA, householdB, userB } = await seedTwoHouseholds();
    await insertInvoice(admin(), householdA.id);

    await asUser(userB.id, householdB.id, async (sql) => {
      const rows = await sql`select id from public.invoices`;
      expect(rows).toHaveLength(0);
    });
  });

  test('owner vê facturas do próprio household (NIF é PII restrita)', async () => {
    const { householdA, userA } = await seedTwoHouseholds();
    await insertInvoice(admin(), householdA.id);

    await asUser(userA.id, householdA.id, async (sql) => {
      const rows = await sql`select id from public.invoices`;
      expect(rows).toHaveLength(1);
    });
  });

  test('INSERT bloqueado para authenticated', async () => {
    const { householdA, userA } = await seedTwoHouseholds();

    const blocked = await expectRlsBlocks(userA.id, householdA.id, async (sql) => {
      await insertInvoice(sql, householdA.id);
    });
    expect(blocked).toBe(true);
  });
});
