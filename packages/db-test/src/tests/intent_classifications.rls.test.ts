/**
 * RLS isolation — `intent_classifications`.
 *
 * Notas (0001_rls_policies.sql):
 *   - DELETE bloqueado para authenticated (audit imutável).
 *
 * Trace: Story 1.4 AC2.
 */
import { afterAll, beforeEach, describe, expect, test } from 'vitest';

import { admin, insertAgentRun, insertIntentClassification } from '@/helpers/fixtures';
import { asUser, closeRlsHarness, expectRlsBlocks, resetData, seedTwoHouseholds } from '@/rls-harness';

afterAll(async () => {
  await closeRlsHarness();
});

describe('RLS isolation: intent_classifications', () => {
  beforeEach(async () => {
    await resetData();
  });

  test('cross-household SELECT bloqueado', async () => {
    const { householdA, householdB, userA, userB } = await seedTwoHouseholds();
    const runId = await insertAgentRun(admin(), householdA.id, userA.id);
    await insertIntentClassification(admin(), householdA.id, runId);

    await asUser(userB.id, householdB.id, async (sql) => {
      const rows = await sql`select id from public.intent_classifications`;
      expect(rows).toHaveLength(0);
    });
  });

  test('cross-household INSERT bloqueado', async () => {
    const { householdA, householdB, userA, userB } = await seedTwoHouseholds();
    const runId = await insertAgentRun(admin(), householdA.id, userA.id);

    const blocked = await expectRlsBlocks(userB.id, householdB.id, async (sql) => {
      await insertIntentClassification(sql, householdA.id, runId);
    });
    expect(blocked).toBe(true);
  });

  test('DELETE bloqueado para authenticated', async () => {
    const { householdA, userA } = await seedTwoHouseholds();
    const runId = await insertAgentRun(admin(), householdA.id, userA.id);
    const intentId = await insertIntentClassification(admin(), householdA.id, runId);

    await asUser(userA.id, householdA.id, async (sql) => {
      const result = await sql`delete from public.intent_classifications where id = ${intentId}`;
      expect(result.count).toBe(0);
    });
  });
});
