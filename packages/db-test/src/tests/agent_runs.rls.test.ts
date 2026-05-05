/**
 * RLS isolation — `agent_runs` (FR3, NFR9 audit imutável, AC8 alta prioridade).
 *
 * Notas críticas (architecture §3.2 + 0001_rls_policies.sql):
 *   - INSERT requer `user_id = auth.uid()` E `is_household_member(household_id)`.
 *   - DELETE bloqueado para `authenticated` (audit imutável — NFR9).
 *
 * Trace: Story 1.4 AC2, AC8.
 */
import { afterAll, beforeEach, describe, expect, test } from 'vitest';

import { admin, insertAgentRun } from '@/helpers/fixtures';
import { asUser, closeRlsHarness, expectRlsBlocks, resetData, seedTwoHouseholds } from '@/rls-harness';

afterAll(async () => {
  await closeRlsHarness();
});

describe('RLS isolation: agent_runs', () => {
  beforeEach(async () => {
    await resetData();
  });

  test('userA vê os seus agent_runs e NÃO vê os de B', async () => {
    const { householdA, householdB, userA, userB } = await seedTwoHouseholds();
    await insertAgentRun(admin(), householdA.id, userA.id);
    await insertAgentRun(admin(), householdB.id, userB.id);

    await asUser(userA.id, householdA.id, async (sql) => {
      const rows = await sql<{ user_id: string }[]>`select user_id from public.agent_runs`;
      expect(rows).toHaveLength(1);
      expect(rows[0]?.user_id).toBe(userA.id);
    });
  });

  test('cross-household INSERT bloqueado: userB não pode inserir run com household_id de A', async () => {
    const { householdA, householdB, userB } = await seedTwoHouseholds();

    const blocked = await expectRlsBlocks(userB.id, householdB.id, async (sql) => {
      await insertAgentRun(sql, householdA.id, userB.id);
    });
    expect(blocked).toBe(true);
  });

  test('INSERT com user_id ≠ auth.uid() bloqueado (policy: user_id = auth.uid())', async () => {
    const { householdA, userA, userB } = await seedTwoHouseholds();

    // userA está autenticado mas tenta inserir run em nome do userB no householdA.
    // Como userB não é membro de householdA, e a policy exige user_id = auth.uid(),
    // qualquer combinação que viole isto deve falhar.
    const blocked = await expectRlsBlocks(userA.id, householdA.id, async (sql) => {
      await insertAgentRun(sql, householdA.id, userB.id);
    });
    expect(blocked).toBe(true);
  });

  test('DELETE bloqueado para authenticated (audit imutável NFR9)', async () => {
    const { householdA, userA } = await seedTwoHouseholds();
    const runId = await insertAgentRun(admin(), householdA.id, userA.id);

    await asUser(userA.id, householdA.id, async (sql) => {
      const result = await sql`delete from public.agent_runs where id = ${runId}`;
      expect(result.count).toBe(0);
    });

    const rows = await admin()<{ n: number }[]>`
      select count(*)::int as n from public.agent_runs where id = ${runId}
    `;
    expect(rows[0]?.n).toBe(1);
  });
});
