/**
 * RLS isolation — `agent_reverse_ops` (FR6 — undo 30s).
 *
 * Trace: Story 1.4 AC2.
 */
import { afterAll, beforeEach, describe, expect, test } from 'vitest';

import { admin, insertAgentRun, insertAgentReverseOp } from '@/helpers/fixtures';
import { asUser, closeRlsHarness, expectRlsBlocks, resetData, seedTwoHouseholds } from '@/rls-harness';

afterAll(async () => {
  await closeRlsHarness();
});

describe('RLS isolation: agent_reverse_ops', () => {
  beforeEach(async () => {
    await resetData();
  });

  test('cross-household SELECT bloqueado', async () => {
    const { householdA, householdB, userA, userB } = await seedTwoHouseholds();
    const runId = await insertAgentRun(admin(), householdA.id, userA.id);
    await insertAgentReverseOp(admin(), householdA.id, runId);

    await asUser(userB.id, householdB.id, async (sql) => {
      const rows = await sql`select id from public.agent_reverse_ops`;
      expect(rows).toHaveLength(0);
    });
  });

  test('cross-household INSERT bloqueado', async () => {
    const { householdA, householdB, userA, userB } = await seedTwoHouseholds();
    const runId = await insertAgentRun(admin(), householdA.id, userA.id);

    const blocked = await expectRlsBlocks(userB.id, householdB.id, async (sql) => {
      await insertAgentReverseOp(sql, householdA.id, runId);
    });
    expect(blocked).toBe(true);
  });
});
