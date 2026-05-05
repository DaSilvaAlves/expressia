/**
 * RLS isolation — `household_members` (pivot user × household).
 *
 * Notas (0001_rls_policies.sql):
 *   - SELECT: membros vêem todos os memberships do seu household + os seus próprios.
 *   - INSERT: owner/admin OU self-insert (accept_invite).
 *   - UPDATE: owner/admin do household.
 *   - DELETE: owner/admin OU o próprio user (auto-saída).
 *
 * Trace: Story 1.4 AC2.
 */
import { afterAll, beforeEach, describe, expect, test } from 'vitest';

import { admin } from '@/helpers/fixtures';
import { asUser, closeRlsHarness, resetData, seedTwoHouseholds } from '@/rls-harness';

afterAll(async () => {
  await closeRlsHarness();
});

describe('RLS isolation: household_members', () => {
  beforeEach(async () => {
    await resetData();
  });

  test('userA vê os membros do seu household e o seu próprio membership', async () => {
    const { householdA, userA } = await seedTwoHouseholds();

    await asUser(userA.id, householdA.id, async (sql) => {
      const rows = await sql<{ user_id: string }[]>`
        select user_id from public.household_members where household_id = ${householdA.id}
      `;
      expect(rows.map((r) => r.user_id)).toEqual([userA.id]);
    });
  });

  test('userA NÃO vê membros do householdB', async () => {
    const { householdB, userA, householdA } = await seedTwoHouseholds();

    await asUser(userA.id, householdA.id, async (sql) => {
      const rows = await sql`
        select user_id from public.household_members where household_id = ${householdB.id}
      `;
      expect(rows).toHaveLength(0);
    });
  });

  test('UPDATE de role bloqueado se userB não é owner/admin do householdA', async () => {
    const { householdA, householdB, userA, userB } = await seedTwoHouseholds();

    await asUser(userB.id, householdB.id, async (sql) => {
      const result = await sql`
        update public.household_members set role = 'admin'
        where household_id = ${householdA.id} and user_id = ${userA.id}
      `;
      expect(result.count).toBe(0);
    });
  });
});
