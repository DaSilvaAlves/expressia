/**
 * RLS isolation — `agent_quotas`.
 *
 * Notas (0001_rls_policies.sql):
 *   - SELECT permitido a membros (transparência NFR20).
 *   - INSERT/UPDATE/DELETE bloqueados (apenas service_role gere counters).
 *
 * Trace: Story 1.4 AC2.
 */
import { afterAll, beforeEach, describe, expect, test } from 'vitest';

import { admin, insertAgentQuota } from '@/helpers/fixtures';
import { asUser, closeRlsHarness, expectRlsBlocks, resetData, seedTwoHouseholds } from '@/rls-harness';

afterAll(async () => {
  await closeRlsHarness();
});

describe('RLS isolation: agent_quotas', () => {
  beforeEach(async () => {
    await resetData();
  });

  test('cross-household SELECT bloqueado', async () => {
    const { householdA, householdB, userB } = await seedTwoHouseholds();
    await insertAgentQuota(admin(), householdA.id);

    await asUser(userB.id, householdB.id, async (sql) => {
      const rows = await sql`select household_id from public.agent_quotas`;
      expect(rows).toHaveLength(0);
    });
  });

  test('membros vêem quota do próprio household', async () => {
    const { householdA, userA } = await seedTwoHouseholds();
    await insertAgentQuota(admin(), householdA.id);

    await asUser(userA.id, householdA.id, async (sql) => {
      const rows = await sql<{ household_id: string }[]>`select household_id from public.agent_quotas`;
      expect(rows[0]?.household_id).toBe(householdA.id);
    });
  });

  test('INSERT bloqueado para authenticated (apenas service_role)', async () => {
    const { householdA, userA } = await seedTwoHouseholds();

    const blocked = await expectRlsBlocks(userA.id, householdA.id, async (sql) => {
      await insertAgentQuota(sql, householdA.id);
    });
    expect(blocked).toBe(true);
  });
});
