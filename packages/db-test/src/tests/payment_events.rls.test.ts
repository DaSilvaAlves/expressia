/**
 * RLS isolation — `payment_events`.
 *
 * Notas (0001_rls_policies.sql):
 *   - TODAS as operações (SELECT/INSERT/UPDATE/DELETE) bloqueadas para `authenticated`.
 *   - Apenas `service_role` (Stripe webhook) acede via bypass de RLS.
 *
 * Trace: Story 1.4 AC2.
 */
import { randomUUID } from 'node:crypto';

import { afterAll, beforeEach, describe, expect, test } from 'vitest';

import { admin } from '@/helpers/fixtures';
import { asUser, closeRlsHarness, expectRlsBlocks, resetData, seedTwoHouseholds } from '@/rls-harness';

afterAll(async () => {
  await closeRlsHarness();
});

describe('RLS isolation: payment_events', () => {
  beforeEach(async () => {
    await resetData();
  });

  test('SELECT bloqueado para authenticated mesmo no próprio household', async () => {
    const { householdA, userA } = await seedTwoHouseholds();
    // Admin (service-role-like) consegue inserir.
    await admin()`
      insert into public.payment_events (stripe_event_id, household_id, event_type, payload)
      values (${'evt_' + randomUUID().slice(0, 12)}, ${householdA.id}, 'invoice.paid', '{}'::jsonb)
    `;

    await asUser(userA.id, householdA.id, async (sql) => {
      const rows = await sql`select stripe_event_id from public.payment_events`;
      expect(rows).toHaveLength(0);
    });
  });

  test('INSERT bloqueado para authenticated', async () => {
    const { householdA, userA } = await seedTwoHouseholds();

    const blocked = await expectRlsBlocks(userA.id, householdA.id, async (sql) => {
      await sql`
        insert into public.payment_events (stripe_event_id, household_id, event_type, payload)
        values (${'evt_' + randomUUID().slice(0, 12)}, ${householdA.id}, 'invoice.paid', '{}'::jsonb)
      `;
    });
    expect(blocked).toBe(true);
  });
});
