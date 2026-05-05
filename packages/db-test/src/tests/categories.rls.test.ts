/**
 * RLS isolation — `categories`.
 *
 * Caso especial (0001_rls_policies.sql + comment):
 *   - Categorias defaults têm `household_id IS NULL` e `is_default = true`.
 *     SELECT permitido a TODOS os utilizadores autenticados (templates globais).
 *   - Categorias per-household têm `household_id NOT NULL` e `is_default = false`.
 *     SELECT só para membros do household.
 *   - INSERT só permite `household_id NOT NULL` + `is_default = false` (não pode
 *     criar templates globais via UI — só seed).
 *
 * Trace: Story 1.4 AC2 + Dev Notes (caso especial defaults).
 */
import { randomUUID } from 'node:crypto';

import { afterAll, beforeEach, describe, expect, test } from 'vitest';

import { admin, insertCategory } from '@/helpers/fixtures';
import { asUser, closeRlsHarness, expectRlsBlocks, resetData, seedTwoHouseholds } from '@/rls-harness';

afterAll(async () => {
  await closeRlsHarness();
});

describe('RLS isolation: categories', () => {
  beforeEach(async () => {
    await resetData();
    // Apaga TUDO em categories (defaults inclusive) para o teste defaults começar limpo.
    await admin()`delete from public.categories`;
  });

  test('cross-household SELECT bloqueado para categorias per-household', async () => {
    const { householdA, householdB, userB } = await seedTwoHouseholds();
    await insertCategory(admin(), householdA.id, 'Restaurantes-A');

    await asUser(userB.id, householdB.id, async (sql) => {
      const rows = await sql<{ id: string }[]>`
        select id from public.categories where household_id is not null
      `;
      expect(rows).toHaveLength(0);
    });
  });

  test('membro vê as suas categorias per-household', async () => {
    const { householdA, userA } = await seedTwoHouseholds();
    await insertCategory(admin(), householdA.id, 'Mercearia');

    await asUser(userA.id, householdA.id, async (sql) => {
      const rows = await sql<{ name: string }[]>`select name from public.categories`;
      expect(rows.map((r) => r.name)).toEqual(['Mercearia']);
    });
  });

  test('CASO ESPECIAL: defaults globais (household_id IS NULL) visíveis a todos os utilizadores', async () => {
    const { userA, householdA, userB, householdB } = await seedTwoHouseholds();

    // Insere uma categoria default global directamente via admin (a UI não permite).
    const defaultId = randomUUID();
    await admin()`
      insert into public.categories (id, household_id, name, is_default, kind)
      values (${defaultId}, null, 'Alimentação', true, 'expense')
    `;

    // userA vê a default
    await asUser(userA.id, householdA.id, async (sql) => {
      const rows = await sql<{ id: string }[]>`
        select id from public.categories where is_default = true and household_id is null
      `;
      expect(rows).toHaveLength(1);
      expect(rows[0]?.id).toBe(defaultId);
    });

    // userB também vê a default (a policy é "household_id IS NULL OR is_household_member(...)").
    await asUser(userB.id, householdB.id, async (sql) => {
      const rows = await sql<{ id: string }[]>`
        select id from public.categories where is_default = true and household_id is null
      `;
      expect(rows).toHaveLength(1);
      expect(rows[0]?.id).toBe(defaultId);
    });
  });

  test('INSERT de categoria global (is_default=true, household_id null) BLOQUEADO via authenticated', async () => {
    const { userA, householdA } = await seedTwoHouseholds();

    const blocked = await expectRlsBlocks(userA.id, householdA.id, async (sql) => {
      await sql`
        insert into public.categories (household_id, name, is_default, kind)
        values (null, 'Tentativa global', true, 'expense')
      `;
    });
    expect(blocked).toBe(true);
  });

  test('cross-household INSERT bloqueado: userB não pode criar categoria com household_id de A', async () => {
    const { householdA, householdB, userB } = await seedTwoHouseholds();

    const blocked = await expectRlsBlocks(userB.id, householdB.id, async (sql) => {
      await insertCategory(sql, householdA.id, 'Hijack');
    });
    expect(blocked).toBe(true);
  });
});
