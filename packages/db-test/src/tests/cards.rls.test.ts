/**
 * RLS isolation — `cards` (FR15, AC8 alta prioridade — cartões crédito/débito).
 *
 * Trace: Story 1.4 AC2, AC8.
 */
import { afterAll, beforeEach, describe, expect, test } from 'vitest';

import { admin, insertAccount, insertCard } from '@/helpers/fixtures';
import { asUser, closeRlsHarness, expectRlsBlocks, resetData, seedTwoHouseholds } from '@/rls-harness';

afterAll(async () => {
  await closeRlsHarness();
});

describe('RLS isolation: cards', () => {
  beforeEach(async () => {
    await resetData();
  });

  test('userA vê apenas os seus cartões', async () => {
    const { householdA, householdB, userA } = await seedTwoHouseholds();
    const accA = await insertAccount(admin(), householdA.id);
    const accB = await insertAccount(admin(), householdB.id);
    await insertCard(admin(), householdA.id, accA, { name: 'Cartão A' });
    await insertCard(admin(), householdB.id, accB, { name: 'Cartão B' });

    await asUser(userA.id, householdA.id, async (sql) => {
      const rows = await sql<{ name: string }[]>`select name from public.cards`;
      expect(rows.map((r) => r.name)).toEqual(['Cartão A']);
    });
  });

  test('cross-household SELECT bloqueado', async () => {
    const { householdA, householdB, userB } = await seedTwoHouseholds();
    const accA = await insertAccount(admin(), householdA.id);
    await insertCard(admin(), householdA.id, accA);

    await asUser(userB.id, householdB.id, async (sql) => {
      expect(await sql`select id from public.cards`).toHaveLength(0);
    });
  });

  test('cross-household INSERT bloqueado: userB não pode criar cartão com household_id de A', async () => {
    const { householdA, householdB, userB } = await seedTwoHouseholds();
    const accA = await insertAccount(admin(), householdA.id);

    const blocked = await expectRlsBlocks(userB.id, householdB.id, async (sql) => {
      await insertCard(sql, householdA.id, accA);
    });
    expect(blocked).toBe(true);
  });

  test('cross-household UPDATE bloqueado: userB não pode editar cartão de A', async () => {
    const { householdA, householdB, userB } = await seedTwoHouseholds();
    const accA = await insertAccount(admin(), householdA.id);
    const cardId = await insertCard(admin(), householdA.id, accA);

    await asUser(userB.id, householdB.id, async (sql) => {
      const result = await sql`update public.cards set name = 'hijack' where id = ${cardId}`;
      expect(result.count).toBe(0);
    });
  });

  // DELETE em cards usa a variant `cards_delete_owner_admin` — ver nota análoga
  // em accounts.rls.test.ts. userB é owner do householdB; a RLS filtra por A.
  test('cross-household DELETE bloqueado: userB não pode eliminar cartão de A', async () => {
    const { householdA, householdB, userB } = await seedTwoHouseholds();
    const accA = await insertAccount(admin(), householdA.id);
    const cardId = await insertCard(admin(), householdA.id, accA);

    await asUser(userB.id, householdB.id, async (sql) => {
      const result = await sql`delete from public.cards where id = ${cardId}`;
      expect(result.count).toBe(0);
    });
  });
});
