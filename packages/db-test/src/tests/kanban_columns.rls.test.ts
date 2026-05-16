/**
 * RLS isolation — `kanban_columns` (FR9).
 *
 * Trace: Story 1.4 AC2.
 */
import { afterAll, beforeEach, describe, expect, test } from 'vitest';

import { admin, insertKanbanColumn } from '@/helpers/fixtures';
import { asUser, closeRlsHarness, expectRlsBlocks, resetData, seedTwoHouseholds } from '@/rls-harness';

afterAll(async () => {
  await closeRlsHarness();
});

describe('RLS isolation: kanban_columns', () => {
  beforeEach(async () => {
    await resetData();
  });

  test('cross-household SELECT bloqueado', async () => {
    const { householdA, householdB, userB } = await seedTwoHouseholds();
    await insertKanbanColumn(admin(), householdA.id);

    await asUser(userB.id, householdB.id, async (sql) => {
      const rows = await sql`select id from public.kanban_columns`;
      expect(rows).toHaveLength(0);
    });
  });

  test('cross-household INSERT bloqueado', async () => {
    const { householdA, householdB, userB } = await seedTwoHouseholds();

    const blocked = await expectRlsBlocks(userB.id, householdB.id, async (sql) => {
      await insertKanbanColumn(sql, householdA.id);
    });
    expect(blocked).toBe(true);
  });

  test('membro do householdA vê as suas colunas', async () => {
    const { householdA, userA } = await seedTwoHouseholds();
    await insertKanbanColumn(admin(), householdA.id, { name: 'A Fazer', sortOrder: 0 });

    await asUser(userA.id, householdA.id, async (sql) => {
      const rows = await sql<{ name: string }[]>`select name from public.kanban_columns`;
      expect(rows.map((r) => r.name)).toEqual(['A Fazer']);
    });
  });

  // Story 3.1 AC5/AC6 — extension UPDATE+DELETE cross-household.
  // Nota PO_FIX F1: kanban_columns DELETE usa policy `kanban_columns_delete_owner_admin` (0001:166-168).
  // userA/userB são `role: 'owner'` dos seus households (seedTwoHouseholds), logo o RLS USING
  // filtra antes do role check — userB obtém 0 rows affected (não permission denied).
  test('cross-household UPDATE bloqueado: userB não actualiza coluna do householdA', async () => {
    const { householdA, householdB, userB } = await seedTwoHouseholds();
    const colId = await insertKanbanColumn(admin(), householdA.id, { name: 'Original', sortOrder: 50 });

    await asUser(userB.id, householdB.id, async (sql) => {
      const result = await sql`update public.kanban_columns set name = 'Hijacked' where id = ${colId}`;
      expect(result.count).toBe(0);
    });

    const rows = await admin()<{ name: string }[]>`select name from public.kanban_columns where id = ${colId}`;
    expect(rows[0]?.name).toBe('Original');
  });

  test('cross-household DELETE bloqueado: userB não apaga coluna do householdA (variant owner_admin)', async () => {
    const { householdA, householdB, userB } = await seedTwoHouseholds();
    const colId = await insertKanbanColumn(admin(), householdA.id, { name: 'A apagar', sortOrder: 51 });

    await asUser(userB.id, householdB.id, async (sql) => {
      const result = await sql`delete from public.kanban_columns where id = ${colId}`;
      // RLS USING filtra (userB não é owner/admin do householdA) → 0 rows affected.
      expect(result.count).toBe(0);
    });

    const rows = await admin()<{ n: number }[]>`
      select count(*)::int as n from public.kanban_columns where id = ${colId}
    `;
    expect(rows[0]?.n).toBe(1);
  });
});
