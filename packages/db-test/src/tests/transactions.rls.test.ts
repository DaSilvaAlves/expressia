/**
 * RLS isolation — `transactions` (FR13, FR16, AC8 alta prioridade — finanças sensíveis).
 *
 * Trace: Story 1.4 AC2, AC8.
 */
import { afterAll, beforeEach, describe, expect, test } from 'vitest';

import { admin, insertAccount, insertTransaction } from '@/helpers/fixtures';
import { asUser, closeRlsHarness, expectRlsBlocks, resetData, seedTwoHouseholds } from '@/rls-harness';

afterAll(async () => {
  await closeRlsHarness();
});

describe('RLS isolation: transactions', () => {
  beforeEach(async () => {
    await resetData();
  });

  test('userA vê transacções do próprio household', async () => {
    const { householdA, userA } = await seedTwoHouseholds();
    const accId = await insertAccount(admin(), householdA.id);
    await insertTransaction(admin(), householdA.id, userA.id, accId);
    await insertTransaction(admin(), householdA.id, userA.id, accId);

    await asUser(userA.id, householdA.id, async (sql) => {
      const rows = await sql<{ n: number }[]>`select count(*)::int as n from public.transactions`;
      expect(rows[0]?.n).toBe(2);
    });
  });

  test('cross-household SELECT bloqueado: userB não vê transacções do householdA', async () => {
    const { householdA, householdB, userA, userB } = await seedTwoHouseholds();
    const accId = await insertAccount(admin(), householdA.id);
    await insertTransaction(admin(), householdA.id, userA.id, accId);

    await asUser(userB.id, householdB.id, async (sql) => {
      const rows = await sql`select id from public.transactions`;
      expect(rows).toHaveLength(0);
    });
  });

  test('cross-household INSERT bloqueado: userB não pode criar transacção com household_id de A', async () => {
    const { householdA, householdB, userB } = await seedTwoHouseholds();
    const accIdA = await insertAccount(admin(), householdA.id);

    const blocked = await expectRlsBlocks(userB.id, householdB.id, async (sql) => {
      await insertTransaction(sql, householdA.id, userB.id, accIdA);
    });
    expect(blocked).toBe(true);
  });

  test('cross-household UPDATE bloqueado: userB não pode editar transacção de A', async () => {
    const { householdA, householdB, userA, userB } = await seedTwoHouseholds();
    const accId = await insertAccount(admin(), householdA.id);
    const txId = await insertTransaction(admin(), householdA.id, userA.id, accId);

    await asUser(userB.id, householdB.id, async (sql) => {
      const result = await sql`update public.transactions set description = 'hijack' where id = ${txId}`;
      expect(result.count).toBe(0);
    });
  });

  test('cross-household DELETE bloqueado: userB não pode eliminar transacção de A', async () => {
    const { householdA, householdB, userA, userB } = await seedTwoHouseholds();
    const accId = await insertAccount(admin(), householdA.id);
    const txId = await insertTransaction(admin(), householdA.id, userA.id, accId);

    await asUser(userB.id, householdB.id, async (sql) => {
      const result = await sql`delete from public.transactions where id = ${txId}`;
      expect(result.count).toBe(0);
    });
  });
});
