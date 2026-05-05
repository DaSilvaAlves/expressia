/**
 * RLS isolation — `households` (raiz multi-tenant).
 *
 * Notas (0001_rls_policies.sql):
 *   - SELECT: membros vêem o próprio household.
 *   - INSERT: utilizador autenticado pode criar household onde é o próprio owner.
 *   - UPDATE: apenas owner/admin do household.
 *   - DELETE: apenas role 'owner'.
 *
 * Trace: Story 1.4 AC2.
 */
import { randomUUID } from 'node:crypto';

import { afterAll, beforeEach, describe, expect, test } from 'vitest';

import { admin } from '@/helpers/fixtures';
import { asUser, closeRlsHarness, resetData, seedTwoHouseholds } from '@/rls-harness';

afterAll(async () => {
  await closeRlsHarness();
});

describe('RLS isolation: households', () => {
  beforeEach(async () => {
    await resetData();
  });

  test('userA vê o próprio household e NÃO vê o de B', async () => {
    const { householdA, householdB, userA } = await seedTwoHouseholds();

    await asUser(userA.id, householdA.id, async (sql) => {
      const rows = await sql<{ id: string }[]>`select id from public.households`;
      expect(rows).toHaveLength(1);
      expect(rows[0]?.id).toBe(householdA.id);
      expect(rows[0]?.id).not.toBe(householdB.id);
    });
  });

  test('cross-household UPDATE bloqueado: userB não pode renomear householdA', async () => {
    const { householdA, householdB, userB } = await seedTwoHouseholds();

    await asUser(userB.id, householdB.id, async (sql) => {
      const result = await sql`
        update public.households set name = 'Hijacked' where id = ${householdA.id}
      `;
      expect(result.count).toBe(0);
    });

    const rows = await admin()<{ name: string }[]>`
      select name from public.households where id = ${householdA.id}
    `;
    expect(rows[0]?.name).toBe('Casa A');
  });

  test('INSERT permitido apenas se owner_user_id = auth.uid()', async () => {
    const { userA } = await seedTwoHouseholds();
    const newHouseholdId = randomUUID();

    // Bater contra o próprio user — permitido.
    await asUser(userA.id, '00000000-0000-0000-0000-000000000000', async (sql) => {
      await sql`
        insert into public.households (id, name, owner_user_id)
        values (${newHouseholdId}, 'Casa Nova', ${userA.id})
      `;
    });

    const rows = await admin()<{ n: number }[]>`
      select count(*)::int as n from public.households where id = ${newHouseholdId}
    `;
    expect(rows[0]?.n).toBe(1);
  });
});
