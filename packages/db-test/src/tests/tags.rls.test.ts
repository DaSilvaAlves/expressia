/**
 * RLS isolation — `tags` (FR12).
 *
 * Notas (0001_rls_policies.sql):
 *   - DELETE requer owner/admin (mais restritivo).
 *
 * Trace: Story 1.4 AC2.
 */
import { afterAll, beforeEach, describe, expect, test } from 'vitest';

import { admin, insertTag } from '@/helpers/fixtures';
import { asUser, closeRlsHarness, expectRlsBlocks, resetData, seedTwoHouseholds } from '@/rls-harness';

afterAll(async () => {
  await closeRlsHarness();
});

describe('RLS isolation: tags', () => {
  beforeEach(async () => {
    await resetData();
  });

  test('cross-household SELECT bloqueado', async () => {
    const { householdA, householdB, userB } = await seedTwoHouseholds();
    await insertTag(admin(), householdA.id, 'urgente-A');

    await asUser(userB.id, householdB.id, async (sql) => {
      const rows = await sql`select id from public.tags`;
      expect(rows).toHaveLength(0);
    });
  });

  test('cross-household INSERT bloqueado', async () => {
    const { householdA, householdB, userB } = await seedTwoHouseholds();

    const blocked = await expectRlsBlocks(userB.id, householdB.id, async (sql) => {
      await insertTag(sql, householdA.id, 'tag-invalida');
    });
    expect(blocked).toBe(true);
  });

  test('membro vê as suas tags', async () => {
    const { householdA, userA } = await seedTwoHouseholds();
    await insertTag(admin(), householdA.id, 'casa');

    await asUser(userA.id, householdA.id, async (sql) => {
      const rows = await sql<{ name: string }[]>`select name from public.tags`;
      expect(rows.map((r) => r.name)).toEqual(['casa']);
    });
  });

  // Story 3.1 AC5/AC6 — extension UPDATE+DELETE cross-household.
  // Nota PO_FIX F1: tags DELETE usa policy `tags_delete_owner_admin` (0001:416-418).
  // userA/userB são `role: 'owner'` dos seus households (seedTwoHouseholds), logo
  // o RLS USING filtra antes do role check — userB obtém 0 rows affected (não permission denied).
  test('cross-household UPDATE bloqueado: userB não actualiza tag do householdA', async () => {
    const { householdA, householdB, userB } = await seedTwoHouseholds();
    const tagId = await insertTag(admin(), householdA.id, 'original');

    await asUser(userB.id, householdB.id, async (sql) => {
      const result = await sql`update public.tags set name = 'hijacked' where id = ${tagId}`;
      expect(result.count).toBe(0);
    });

    const rows = await admin()<{ name: string }[]>`select name from public.tags where id = ${tagId}`;
    expect(rows[0]?.name).toBe('original');
  });

  test('cross-household DELETE bloqueado: userB não apaga tag do householdA (variant owner_admin)', async () => {
    const { householdA, householdB, userB } = await seedTwoHouseholds();
    const tagId = await insertTag(admin(), householdA.id, 'a-apagar');

    await asUser(userB.id, householdB.id, async (sql) => {
      const result = await sql`delete from public.tags where id = ${tagId}`;
      // RLS USING filtra (userB não é owner/admin do householdA) → 0 rows affected.
      expect(result.count).toBe(0);
    });

    const rows = await admin()<{ n: number }[]>`select count(*)::int as n from public.tags where id = ${tagId}`;
    expect(rows[0]?.n).toBe(1);
  });
});
