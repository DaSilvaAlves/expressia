/**
 * RLS isolation — tabela `jarvis_memories` (Story M-1 AC9).
 *
 * Prova REAL de isolamento cross-household contra Postgres via Testcontainers.
 * Dados de memória são conteúdo pessoal sensível (risco R2 do brief da epic v2)
 * — merecem prova de isolamento, não só o gate estático `check:rls`. Este é
 * também o primeiro teste RLS dedicado a uma tabela criada DEPOIS da 0001
 * (telegram_link/daily_briefing_cache/jarvis_facts/google_oauth_tokens nunca
 * tiveram) — valida indirectamente o PO-FIX-1: as 4 policies são aplicadas
 * REALMENTE pela migration 0034 (mesmo ficheiro que o CREATE TABLE), pelo que a
 * RLS está viva quando este teste corre (se estivessem só na 0001, o guard
 * `if exists` teria avaliado FALSE e a tabela ficaria sem policies).
 *
 * Padrão canónico espelhado de `tasks.rls.test.ts`:
 *   1. seedTwoHouseholds() cria 2 households + 2 users em auth.users (N2 do @po:
 *      o user tem de existir ANTES da memória — FK created_by_user_id é
 *      `on delete restrict`).
 *   2. admin() (sem RLS) prepara dados em ambos os households.
 *   3. asUser() (RLS activo) verifica isolamento SELECT/UPDATE/DELETE + INSERT
 *      WITH CHECK.
 *
 * Trace: Story M-1 AC9. Architecture §10.2 (test pattern).
 */
import { randomUUID } from 'node:crypto';

import { afterAll, beforeEach, describe, expect, test } from 'vitest';

import { admin } from '@/helpers/fixtures';
import {
  asUser,
  closeRlsHarness,
  expectRlsBlocks,
  resetData,
  seedTwoHouseholds,
  type QuerySql,
} from '@/rls-harness';

/** Insere uma memória via a connection fornecida (admin ou asUser). */
async function insertMemory(
  sql: QuerySql,
  householdId: string,
  createdByUserId: string,
  content = 'odeio reuniões antes das 10h',
): Promise<string> {
  const id = randomUUID();
  await sql`
    insert into public.jarvis_memories (id, household_id, created_by_user_id, content)
    values (${id}, ${householdId}, ${createdByUserId}, ${content})
  `;
  return id;
}

afterAll(async () => {
  await closeRlsHarness();
});

describe('RLS isolation: jarvis_memories', () => {
  beforeEach(async () => {
    await resetData();
  });

  test('userA (householdA) vê as suas próprias memórias', async () => {
    const { householdA, userA } = await seedTwoHouseholds();
    await insertMemory(admin(), householdA.id, userA.id, 'prefiro café sem açúcar');
    await insertMemory(admin(), householdA.id, userA.id, 'a minha mãe faz anos a 3 de março');

    await asUser(userA.id, householdA.id, async (sql) => {
      const rows = await sql<{ content: string }[]>`
        select content from public.jarvis_memories order by content
      `;
      expect(rows.map((r) => r.content)).toEqual([
        'a minha mãe faz anos a 3 de março',
        'prefiro café sem açúcar',
      ]);
    });
  });

  test('cross-household SELECT bloqueado: userB NÃO vê memórias do householdA', async () => {
    const { householdA, householdB, userA, userB } = await seedTwoHouseholds();
    await insertMemory(admin(), householdA.id, userA.id, 'preferência privada de A');

    await asUser(userB.id, householdB.id, async (sql) => {
      const rows = await sql<{ id: string }[]>`select id from public.jarvis_memories`;
      expect(rows).toHaveLength(0);
    });
  });

  test('cross-household INSERT bloqueado: userB não pode inserir memória com household_id do householdA', async () => {
    const { householdA, householdB, userB } = await seedTwoHouseholds();

    const blocked = await expectRlsBlocks(userB.id, householdB.id, async (sql) => {
      await insertMemory(sql, householdA.id, userB.id, 'INVÁLIDA');
    });
    expect(blocked).toBe(true);

    const rows = await admin()<{ n: number }[]>`
      select count(*)::int as n from public.jarvis_memories
    `;
    expect(rows[0]?.n).toBe(0);
  });

  test('cross-household UPDATE bloqueado: userB não pode actualizar memória do householdA', async () => {
    const { householdA, householdB, userA, userB } = await seedTwoHouseholds();
    const memoryId = await insertMemory(admin(), householdA.id, userA.id, 'Original');

    await asUser(userB.id, householdB.id, async (sql) => {
      // RLS USING filtra antes → 0 rows afectadas (não throw).
      const result = await sql`
        update public.jarvis_memories set content = 'Hijacked' where id = ${memoryId}
      `;
      expect(result.count).toBe(0);
    });

    const rows = await admin()<{ content: string }[]>`
      select content from public.jarvis_memories where id = ${memoryId}
    `;
    expect(rows[0]?.content).toBe('Original');
  });

  test('cross-household DELETE bloqueado: userB não pode apagar memória do householdA', async () => {
    const { householdA, householdB, userA, userB } = await seedTwoHouseholds();
    const memoryId = await insertMemory(admin(), householdA.id, userA.id);

    await asUser(userB.id, householdB.id, async (sql) => {
      const result = await sql`delete from public.jarvis_memories where id = ${memoryId}`;
      expect(result.count).toBe(0);
    });

    const rows = await admin()<{ n: number }[]>`
      select count(*)::int as n from public.jarvis_memories where id = ${memoryId}
    `;
    expect(rows[0]?.n).toBe(1);
  });
});
