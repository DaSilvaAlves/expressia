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
});
