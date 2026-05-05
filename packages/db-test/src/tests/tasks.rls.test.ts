/**
 * RLS isolation — tabela `tasks` (FR7-FR12, AC8 alta prioridade).
 *
 * Padrão de teste RLS multi-tenant (este ficheiro serve de exemplo canónico para os
 * restantes — futuros developers devem replicar esta estrutura ao adicionar testes
 * para novas tabelas com `household_id`):
 *
 *   1. seedTwoHouseholds() cria 2 households + 2 users em hosts diferentes.
 *   2. Usar `admin()` (cliente sem RLS) para preparar dados em ambos os households.
 *   3. Usar `asUser()` (com RLS activo) para verificar:
 *        a) SELECT só vê dados do próprio household.
 *        b) INSERT cross-household é REJEITADO (com_check falha).
 *
 * Trace: Story 1.4 AC2, AC8, AC10. Architecture §10.2 (test pattern).
 */
import { afterAll, beforeEach, describe, expect, test } from 'vitest';

import { admin, insertTask } from '@/helpers/fixtures';
import { asUser, closeRlsHarness, expectRlsBlocks, resetData, seedTwoHouseholds } from '@/rls-harness';

afterAll(async () => {
  await closeRlsHarness();
});

describe('RLS isolation: tasks', () => {
  beforeEach(async () => {
    await resetData();
  });

  test('userA (householdA) vê as suas próprias tarefas', async () => {
    const { householdA, userA } = await seedTwoHouseholds();
    await insertTask(admin(), householdA.id, userA.id, { title: 'Tarefa A1' });
    await insertTask(admin(), householdA.id, userA.id, { title: 'Tarefa A2' });

    await asUser(userA.id, householdA.id, async (sql) => {
      const rows = await sql<{ title: string }[]>`select title from public.tasks order by title`;
      expect(rows.map((r) => r.title)).toEqual(['Tarefa A1', 'Tarefa A2']);
    });
  });

  test('cross-household SELECT bloqueado: userB (householdB) NÃO vê tarefas do householdA', async () => {
    const { householdA, householdB, userA, userB } = await seedTwoHouseholds();
    await insertTask(admin(), householdA.id, userA.id, { title: 'Privada A' });

    await asUser(userB.id, householdB.id, async (sql) => {
      const rows = await sql<{ id: string }[]>`select id from public.tasks`;
      expect(rows).toHaveLength(0);
    });
  });

  test('cross-household INSERT bloqueado: userB não pode inserir task com household_id do householdA', async () => {
    const { householdA, householdB, userB } = await seedTwoHouseholds();

    const blocked = await expectRlsBlocks(userB.id, householdB.id, async (sql) => {
      await insertTask(sql, householdA.id, userB.id, { title: 'INVÁLIDA' });
    });
    expect(blocked).toBe(true);

    // Confirmar que a tarefa NÃO foi inserida na DB (admin vê tudo).
    const rows = await admin()<{ n: number }[]>`select count(*)::int as n from public.tasks`;
    expect(rows[0]?.n).toBe(0);
  });

  test('cross-household UPDATE bloqueado: userB não pode actualizar task do householdA', async () => {
    const { householdA, householdB, userA, userB } = await seedTwoHouseholds();
    const taskId = await insertTask(admin(), householdA.id, userA.id, { title: 'Original' });

    await asUser(userB.id, householdB.id, async (sql) => {
      // Update silenciosamente afecta 0 rows (não throw) porque o RLS USING filtra antes.
      const result = await sql`
        update public.tasks set title = 'Hijacked' where id = ${taskId}
      `;
      expect(result.count).toBe(0);
    });

    // Confirmar que o título não mudou.
    const rows = await admin()<{ title: string }[]>`
      select title from public.tasks where id = ${taskId}
    `;
    expect(rows[0]?.title).toBe('Original');
  });

  test('cross-household DELETE bloqueado: userB não pode apagar task do householdA', async () => {
    const { householdA, householdB, userA, userB } = await seedTwoHouseholds();
    const taskId = await insertTask(admin(), householdA.id, userA.id);

    await asUser(userB.id, householdB.id, async (sql) => {
      const result = await sql`delete from public.tasks where id = ${taskId}`;
      expect(result.count).toBe(0);
    });

    const rows = await admin()<{ n: number }[]>`
      select count(*)::int as n from public.tasks where id = ${taskId}
    `;
    expect(rows[0]?.n).toBe(1);
  });
});
