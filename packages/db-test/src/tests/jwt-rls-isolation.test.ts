/**
 * JWT + RLS isolation test — Story 1.5 AC6.
 *
 * Verifica que:
 *   1. Um JWT com `household_id` correcto permite SELECT em `public.tasks`
 *      do household correspondente (utilizador vê os seus dados).
 *   2. Um JWT com `household_id` ERRADO (pertencente a outro household que
 *      o user não é membro) → SELECT devolve 0 rows (RLS bloqueia).
 *   3. Insertar uma task com `household_id` que não é o do JWT é REJEITADO
 *      pelo INSERT policy (RLS).
 *
 * Implementação:
 *   - O harness `asUser(userId, householdId, fn)` simula um JWT via
 *     `set_config('request.jwt.claims', {sub, household_id, role: authenticated}, true)`.
 *   - As policies em `0001_rls_policies.sql` lêem essas claims via
 *     `public.current_household_id()` e `public.is_household_member()`.
 *   - O comportamento do JWT real do Supabase (após custom_access_token_hook
 *     injectar household_id) é equivalente — esta suite cobre o contrato RLS
 *     que o JWT desencadeia, não o pipeline OAuth/JWT em si (validado por
 *     smoke manual do runbook §6).
 *
 * Diferença para os testes em households.rls.test.ts / tasks.rls.test.ts:
 *   - Aqueles testam policies isoladamente (cross-household SELECT/UPDATE/DELETE).
 *   - Este teste foca o ângulo "JWT certo vs JWT errado" — Story 1.5 AC6.
 *
 * Trace: Story 1.5 AC6, Architecture §3.2 (JWT claims), §10.2 (RLS test pattern).
 */
import { afterAll, beforeEach, describe, expect, test } from 'vitest';

import { admin, insertTask } from '@/helpers/fixtures';
import {
  asUser,
  closeRlsHarness,
  expectRlsBlocks,
  resetData,
  seedTwoHouseholds,
} from '@/rls-harness';

afterAll(async () => {
  await closeRlsHarness();
});

describe('JWT + RLS isolation — Story 1.5 AC6', () => {
  beforeEach(async () => {
    await resetData();
  });

  test('JWT com household_id correcto permite SELECT em public.tasks', async () => {
    const { householdA, userA } = await seedTwoHouseholds();

    // Admin insere uma task no householdA (sem RLS).
    const taskAId = await insertTask(admin(), householdA.id, userA.id, {
      title: 'Comprar peixe fresco',
    });

    // userA com JWT contendo o household_id correcto vê a task.
    await asUser(userA.id, householdA.id, async (sql) => {
      const rows = await sql<{ id: string; title: string }[]>`
        select id, title from public.tasks
      `;
      expect(rows).toHaveLength(1);
      expect(rows[0]?.id).toBe(taskAId);
      expect(rows[0]?.title).toBe('Comprar peixe fresco');
    });
  });

  test('JWT com household_id ERRADO devolve 0 rows (RLS bloqueia)', async () => {
    const { householdA, householdB, userA, userB } = await seedTwoHouseholds();

    // Admin insere uma task no householdA.
    await insertTask(admin(), householdA.id, userA.id, { title: 'Privada A' });

    // userB tenta ver com o seu próprio JWT (household_id = B). RLS aplica
    // current_household_id() = B, mas a task está em A → 0 rows.
    await asUser(userB.id, householdB.id, async (sql) => {
      const rows = await sql`select id from public.tasks`;
      expect(rows).toHaveLength(0);
    });
  });

  test('JWT manipulado com household_id errado para o user → SELECT vê 0 rows', async () => {
    // Cenário de ataque: userB obtém um JWT (legitimamente) e tenta forjar
    // um claim household_id = householdA.id (o seu não é). Em produção isto
    // exigiria modificar o JWT antes da assinatura (impossível sem o secret),
    // mas testamos o mecanismo RLS subjacente: mesmo que o claim chegasse
    // adulterado, is_household_member() falharia.
    //
    // Importante: o helper public.is_household_member(household_id) verifica
    // contra household_members table (não contra JWT), logo um household_id
    // forjado no JWT não engana o RLS — userB não está em household_members
    // para householdA.
    const { householdA, userA, userB } = await seedTwoHouseholds();

    await insertTask(admin(), householdA.id, userA.id, { title: 'Top secret A' });

    // userB com claim household_id = A (forjado).
    await asUser(userB.id, householdA.id, async (sql) => {
      // SELECT com current_household_id() = A: pass.
      // Mas as policies usam is_household_member(household_id) que verifica
      // contra household_members.user_id = auth.uid(). userB não é membro
      // de A → 0 rows.
      const rows = await sql`select id from public.tasks`;
      expect(rows).toHaveLength(0);
    });
  });

  test('INSERT em public.tasks com household_id errado é REJEITADO pelo RLS', async () => {
    const { householdA, householdB, userB } = await seedTwoHouseholds();

    // userB tenta inserir uma task no householdA (cross-household). Mesmo
    // que `current_household_id()` esteja a A, o WITH CHECK usando
    // is_household_member(A) falha porque userB não é membro de A.
    //
    // Nota: usamos `expectRlsBlocks` em vez de `expect().rejects.toThrow`
    // dentro de `asUser` porque uma rejection dentro do callback aborta a
    // transacção do harness antes de a assertion conseguir capturar.
    // `expectRlsBlocks` apanha o erro pattern-matching no message.
    const blocked = await expectRlsBlocks(userB.id, householdA.id, async (sql) => {
      await sql`
        insert into public.tasks (household_id, created_by_user_id, title)
        values (${householdA.id}, ${userB.id}, 'Hijack attempt')
      `;
    });
    expect(blocked).toBe(true);

    // Confirmar que nada foi inserido em A.
    const tasksInA = await admin()<{ count: number }[]>`
      select count(*)::int as count from public.tasks where household_id = ${householdA.id}
    `;
    expect(tasksInA[0]?.count).toBe(0);

    // Sanity: householdB ainda não tem tasks (não foi tocado).
    const tasksInB = await admin()<{ count: number }[]>`
      select count(*)::int as count from public.tasks where household_id = ${householdB.id}
    `;
    expect(tasksInB[0]?.count).toBe(0);
  });
});
