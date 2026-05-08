/**
 * RLS isolation + TTL — `agent_reverse_ops` (FR6 — undo 30s).
 *
 * Trace: Story 1.4 AC2 + Story 2.1 AC8 (DEFAULT expires_at via 0005).
 */
import { randomUUID } from 'node:crypto';

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

  // ───────────────────────────────────────────────────────────────────
  // Story 2.1 AC8 — DEFAULT expires_at = now() + 30s (FR6 safety net)
  // ───────────────────────────────────────────────────────────────────

  test('INSERT sem expires_at usa DEFAULT now() + 30s (migration 0005)', async () => {
    const { householdA, userA } = await seedTwoHouseholds();
    const runId = await insertAgentRun(admin(), householdA.id, userA.id);

    // INSERT explicitamente OMITINDO `expires_at` — deve usar DEFAULT da migration 0005.
    const id = randomUUID();
    await admin()`
      insert into public.agent_reverse_ops (
        id, agent_run_id, household_id, reverse_op
      )
      values (
        ${id}, ${runId}, ${householdA.id},
        '{"kind":"delete_row","table":"tasks","id":"00000000-0000-0000-0000-000000000000"}'::jsonb
      )
    `;

    // expires_at deve estar definido e ~30s no futuro (margem de tolerância: 25s-35s).
    const rows = await admin()<{
      expires_at: Date;
      seconds_diff: number;
    }[]>`
      select
        expires_at,
        extract(epoch from (expires_at - now()))::int as seconds_diff
      from public.agent_reverse_ops
      where id = ${id}
    `;
    expect(rows[0]?.expires_at).toBeDefined();
    // Tolerância larga (25-35s) para acomodar latência de query e clock skew em CI.
    expect(rows[0]?.seconds_diff).toBeGreaterThanOrEqual(25);
    expect(rows[0]?.seconds_diff).toBeLessThanOrEqual(35);
  });

  test('reverse_op com expires_at futuro é detectável via query expires_at > now()', async () => {
    const { householdA, userA } = await seedTwoHouseholds();
    const runId = await insertAgentRun(admin(), householdA.id, userA.id);
    const reverseId = await insertAgentReverseOp(admin(), householdA.id, runId);

    // Query típica do undo flow: "operações ainda dentro da janela 30s".
    const rows = await admin()<{ id: string }[]>`
      select id from public.agent_reverse_ops
      where id = ${reverseId} and expires_at > now()
    `;
    expect(rows).toHaveLength(1);
  });

  test('expires_at é NOT NULL — INSERT explicitamente null falha', async () => {
    const { householdA, userA } = await seedTwoHouseholds();
    const runId = await insertAgentRun(admin(), householdA.id, userA.id);

    // Tentar inserir explicitamente expires_at = null → constraint NOT NULL viola.
    let raised = false;
    try {
      await admin()`
        insert into public.agent_reverse_ops (
          id, agent_run_id, household_id, reverse_op, expires_at
        )
        values (
          ${randomUUID()}, ${runId}, ${householdA.id},
          '{"kind":"delete_row","table":"tasks","id":"00000000-0000-0000-0000-000000000000"}'::jsonb,
          null
        )
      `;
    } catch (err) {
      raised = err instanceof Error && /not[-_ ]null|null value in column "expires_at"/i.test(err.message);
    }
    expect(raised).toBe(true);
  });
});
