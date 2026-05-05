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
});
