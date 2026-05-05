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
});
