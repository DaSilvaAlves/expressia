/**
 * RLS isolation — `accounts` (FR15, AC8 alta prioridade — contas bancárias).
 *
 * Nota: DELETE em accounts requer role `owner` ou `admin` (policy mais restritiva).
 *
 * Trace: Story 1.4 AC2, AC8.
 */
import { afterAll, beforeEach, describe, expect, test } from 'vitest';

import { admin, insertAccount } from '@/helpers/fixtures';
import { asUser, closeRlsHarness, expectRlsBlocks, resetData, seedTwoHouseholds } from '@/rls-harness';

afterAll(async () => {
  await closeRlsHarness();
});

describe('RLS isolation: accounts', () => {
  beforeEach(async () => {
    await resetData();
  });

  test('userA vê apenas as suas contas', async () => {
    const { householdA, householdB, userA } = await seedTwoHouseholds();
    await insertAccount(admin(), householdA.id, { name: 'Conta A1' });
    await insertAccount(admin(), householdB.id, { name: 'Conta B1' });

    await asUser(userA.id, householdA.id, async (sql) => {
      const rows = await sql<{ name: string }[]>`select name from public.accounts`;
      expect(rows.map((r) => r.name)).toEqual(['Conta A1']);
    });
  });

  test('cross-household SELECT bloqueado', async () => {
    const { householdA, householdB, userB } = await seedTwoHouseholds();
    await insertAccount(admin(), householdA.id);

    await asUser(userB.id, householdB.id, async (sql) => {
      const rows = await sql`select id from public.accounts`;
      expect(rows).toHaveLength(0);
    });
  });

  test('cross-household INSERT bloqueado: with check force violation', async () => {
    const { householdA, householdB, userB } = await seedTwoHouseholds();

    const blocked = await expectRlsBlocks(userB.id, householdB.id, async (sql) => {
      await insertAccount(sql, householdA.id, { name: 'INVÁLIDA' });
    });
    expect(blocked).toBe(true);
  });

  test('cross-household UPDATE bloqueado: userB não pode editar conta de A', async () => {
    const { householdA, householdB, userB } = await seedTwoHouseholds();
    const accId = await insertAccount(admin(), householdA.id, { name: 'Conta A' });

    await asUser(userB.id, householdB.id, async (sql) => {
      const result = await sql`update public.accounts set name = 'hijack' where id = ${accId}`;
      expect(result.count).toBe(0);
    });
  });

  // DELETE em accounts usa a variant `accounts_delete_owner_admin`.
  // `seedTwoHouseholds` cria userB como `owner` do householdB — a USING clause
  // da RLS (is_household_owner_or_admin(household_id de A)) filtra primeiro:
  // userB não é membro de A → 0 rows. Exercita RLS, não privilégio insuficiente.
  test('cross-household DELETE bloqueado: userB não pode eliminar conta de A', async () => {
    const { householdA, householdB, userB } = await seedTwoHouseholds();
    const accId = await insertAccount(admin(), householdA.id);

    await asUser(userB.id, householdB.id, async (sql) => {
      const result = await sql`delete from public.accounts where id = ${accId}`;
      expect(result.count).toBe(0);
    });
  });
});
