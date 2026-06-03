/**
 * RLS APPLICATION gate (SEC-2 / ADR-003 Fase 1, AC-C1/C2/C3) — prova de APLICAÇÃO
 * real, não só existência estática de policies (que `check-rls-coverage.ts` já cobre).
 *
 * Este teste é o endurecimento do NFR5: semeia 2 households com dados de domínio
 * (tasks + transactions), liga ao role `authenticated` via a MESMA mecânica que o
 * `withHousehold` de produção implementa (`SET LOCAL ROLE authenticated` + JWT claims
 * dentro de transação — `asUser()` em `rls-harness.ts`) e prova:
 *   - SELECT cross-tenant devolve 0 rows (RLS bloqueia).
 *   - SELECT com filtro `WHERE household_id = <outro>` devolve 0 rows.
 *   - INSERT cross-household é REJEITADO por RLS.
 *   - `service_role` (jobs Inngest/migrations) continua a ver ambos os households
 *     (bypass intacto — AC-E3).
 *
 * Corre no job `rls-gate` do CI (`.github/workflows/ci.yaml:178` — `pnpm --filter
 * @meu-jarvis/db-test test`), apanhado automaticamente pelo glob Vitest do package.
 * Qualquer leak detectado falha com exit code 1 e bloqueia o merge (AC-C3).
 *
 * Trace: SEC-2 AC-C1, AC-C2, AC-C3, AC-E3; ADR-003 §3.
 */
import { randomUUID } from 'node:crypto';

import { afterAll, beforeEach, describe, expect, test } from 'vitest';

import {
  admin,
  insertAccount,
  insertCategory,
  insertKanbanColumn,
  insertTag,
  insertTask,
  insertTaskRecurrence,
  insertTaskTag,
  insertTransaction,
} from '@/helpers/fixtures';
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

describe('RLS application gate (SEC-2 / ADR-003 Fase 1): tasks', () => {
  beforeEach(async () => {
    await resetData();
  });

  test('userA só vê a sua tarefa (1 row), 0 de B (AC-C1)', async () => {
    const { householdA, householdB, userA, userB } = await seedTwoHouseholds();
    await insertTask(admin(), householdA.id, userA.id, { title: 'Tarefa A' });
    await insertTask(admin(), householdB.id, userB.id, { title: 'Tarefa B' });

    await asUser(userA.id, householdA.id, async (sql) => {
      const rows = await sql<{ household_id: string }[]>`select household_id from public.tasks`;
      expect(rows).toHaveLength(1);
      expect(rows.every((r) => r.household_id === householdA.id)).toBe(true);
    });
  });

  test('userB só vê a sua tarefa (1 row), 0 de A (AC-C1)', async () => {
    const { householdA, householdB, userA, userB } = await seedTwoHouseholds();
    await insertTask(admin(), householdA.id, userA.id, { title: 'Tarefa A' });
    await insertTask(admin(), householdB.id, userB.id, { title: 'Tarefa B' });

    await asUser(userB.id, householdB.id, async (sql) => {
      const rows = await sql<{ household_id: string }[]>`select household_id from public.tasks`;
      expect(rows).toHaveLength(1);
      expect(rows.every((r) => r.household_id === householdB.id)).toBe(true);
    });
  });

  test('SELECT com filtro cruzado (userA, WHERE household_id = B) → 0 rows (AC-C1)', async () => {
    const { householdA, householdB, userA, userB } = await seedTwoHouseholds();
    await insertTask(admin(), householdA.id, userA.id, { title: 'Tarefa A' });
    await insertTask(admin(), householdB.id, userB.id, { title: 'Tarefa B' });

    await asUser(userA.id, householdA.id, async (sql) => {
      const rows = await sql`select id from public.tasks where household_id = ${householdB.id}`;
      expect(rows).toHaveLength(0);
    });
  });

  test('INSERT cross-household (userA → household B) é bloqueado por RLS (AC-C1)', async () => {
    const { householdB, userA, householdA } = await seedTwoHouseholds();

    const blocked = await expectRlsBlocks(userA.id, householdA.id, async (sql) => {
      await insertTask(sql, householdB.id, userA.id, { title: 'INVÁLIDA' });
    });
    expect(blocked).toBe(true);

    // Confirma que nada foi inserido (admin vê tudo).
    const rows = await admin()<{ n: number }[]>`select count(*)::int as n from public.tasks`;
    expect(rows[0]?.n).toBe(0);
  });
});

describe('RLS application gate (SEC-2 / ADR-003 Fase 1): transactions', () => {
  beforeEach(async () => {
    await resetData();
  });

  test('userA só vê a sua transacção (1 row), 0 de B (AC-C2)', async () => {
    const { householdA, householdB, userA, userB } = await seedTwoHouseholds();
    const accA = await insertAccount(admin(), householdA.id);
    const accB = await insertAccount(admin(), householdB.id);
    await insertTransaction(admin(), householdA.id, userA.id, accA);
    await insertTransaction(admin(), householdB.id, userB.id, accB);

    await asUser(userA.id, householdA.id, async (sql) => {
      const rows = await sql<
        { household_id: string }[]
      >`select household_id from public.transactions`;
      expect(rows).toHaveLength(1);
      expect(rows.every((r) => r.household_id === householdA.id)).toBe(true);
    });
  });

  test('userB só vê a sua transacção (1 row), 0 de A (AC-C2)', async () => {
    const { householdA, householdB, userA, userB } = await seedTwoHouseholds();
    const accA = await insertAccount(admin(), householdA.id);
    const accB = await insertAccount(admin(), householdB.id);
    await insertTransaction(admin(), householdA.id, userA.id, accA);
    await insertTransaction(admin(), householdB.id, userB.id, accB);

    await asUser(userB.id, householdB.id, async (sql) => {
      const rows = await sql<
        { household_id: string }[]
      >`select household_id from public.transactions`;
      expect(rows).toHaveLength(1);
      expect(rows.every((r) => r.household_id === householdB.id)).toBe(true);
    });
  });

  test('SELECT com filtro cruzado (userA, WHERE household_id = B) → 0 rows (AC-C2)', async () => {
    const { householdA, householdB, userA, userB } = await seedTwoHouseholds();
    const accA = await insertAccount(admin(), householdA.id);
    const accB = await insertAccount(admin(), householdB.id);
    await insertTransaction(admin(), householdA.id, userA.id, accA);
    await insertTransaction(admin(), householdB.id, userB.id, accB);

    await asUser(userA.id, householdA.id, async (sql) => {
      const rows = await sql`select id from public.transactions where household_id = ${householdB.id}`;
      expect(rows).toHaveLength(0);
    });
  });

  test('INSERT cross-household (userA → household B) é bloqueado por RLS (AC-C2)', async () => {
    const { householdA, householdB, userA } = await seedTwoHouseholds();
    const accB = await insertAccount(admin(), householdB.id);

    const blocked = await expectRlsBlocks(userA.id, householdA.id, async (sql) => {
      await insertTransaction(sql, householdB.id, userA.id, accB);
    });
    expect(blocked).toBe(true);

    const rows = await admin()<{ n: number }[]>`select count(*)::int as n from public.transactions`;
    expect(rows[0]?.n).toBe(0);
  });
});

describe('RLS application gate (SEC-3 / ADR-003 Fase 2): accounts', () => {
  beforeEach(async () => {
    await resetData();
  });

  test('userA só vê a sua conta (1 row), 0 de B', async () => {
    const { householdA, householdB, userA } = await seedTwoHouseholds();
    await insertAccount(admin(), householdA.id);
    await insertAccount(admin(), householdB.id);

    await asUser(userA.id, householdA.id, async (sql) => {
      const rows = await sql<
        { household_id: string }[]
      >`select household_id from public.accounts`;
      expect(rows).toHaveLength(1);
      expect(rows.every((r) => r.household_id === householdA.id)).toBe(true);
    });
  });

  test('SELECT com filtro cruzado (userA, WHERE household_id = B) → 0 rows', async () => {
    const { householdA, householdB, userA } = await seedTwoHouseholds();
    await insertAccount(admin(), householdA.id);
    await insertAccount(admin(), householdB.id);

    await asUser(userA.id, householdA.id, async (sql) => {
      const rows = await sql`select id from public.accounts where household_id = ${householdB.id}`;
      expect(rows).toHaveLength(0);
    });
  });

  test('INSERT cross-household (userA → household B) é bloqueado por RLS', async () => {
    const { householdA, householdB, userA } = await seedTwoHouseholds();

    const blocked = await expectRlsBlocks(userA.id, householdA.id, async (sql) => {
      await insertAccount(sql, householdB.id);
    });
    expect(blocked).toBe(true);

    const rows = await admin()<{ n: number }[]>`select count(*)::int as n from public.accounts`;
    expect(rows[0]?.n).toBe(0);
  });
});

describe('RLS application gate (SEC-3 / ADR-003 Fase 2): categories (globais + per-household)', () => {
  beforeEach(async () => {
    await resetData();
  });

  // A policy `categories_select_global_or_member` é a ÚNICA que diverge do template
  // padrão (permite `household_id IS NULL`). Estes testes provam que um household NÃO
  // vê categorias *per-household* de outro (só as globais) — fecha o risco de leak de
  // globais identificado na PO-OBS de SEC-3.

  test('userA vê a sua categoria per-household + as globais, NUNCA a per-household de B', async () => {
    const { householdA, householdB, userA } = await seedTwoHouseholds();
    const catA = await insertCategory(admin(), householdA.id, 'Cat A');
    const catB = await insertCategory(admin(), householdB.id, 'Cat B');
    // Categoria GLOBAL (household_id NULL) — visível a todos os households (AC-E1).
    const globalId = randomUUID();
    await admin()`
      insert into public.categories (id, household_id, name, is_default, kind)
      values (${globalId}, ${null}, 'Categoria Global SEC-3', false, 'expense')
    `;

    await asUser(userA.id, householdA.id, async (sql) => {
      const rows = await sql<{ id: string; household_id: string | null }[]>`
        select id, household_id from public.categories
      `;
      const ids = rows.map((r) => r.id);
      // Vê a própria per-household + a global.
      expect(ids).toContain(catA);
      expect(ids).toContain(globalId);
      // NUNCA vê a per-household de B (não-global).
      expect(ids).not.toContain(catB);
      // Toda a row visível é ou do próprio household ou global (NULL).
      expect(
        rows.every((r) => r.household_id === householdA.id || r.household_id === null),
      ).toBe(true);
    });
  });

  test('SELECT explícito da categoria per-household de B (userA) → 0 rows', async () => {
    const { householdA, householdB, userA } = await seedTwoHouseholds();
    const catB = await insertCategory(admin(), householdB.id, 'Cat B');

    await asUser(userA.id, householdA.id, async (sql) => {
      const rows = await sql`select id from public.categories where id = ${catB}`;
      expect(rows).toHaveLength(0);
    });
  });

  test('INSERT cross-household (userA → categoria de household B) é bloqueado por RLS', async () => {
    const { householdA, householdB, userA } = await seedTwoHouseholds();

    const blocked = await expectRlsBlocks(userA.id, householdA.id, async (sql) => {
      await insertCategory(sql, householdB.id, 'INVÁLIDA');
    });
    expect(blocked).toBe(true);

    const rows = await admin()<{ n: number }[]>`select count(*)::int as n from public.categories`;
    expect(rows[0]?.n).toBe(0);
  });
});

describe('RLS application gate (SEC-5 / ADR-003 Fase 4 Fatia A): tags', () => {
  beforeEach(async () => {
    await resetData();
  });

  test('userA só vê a sua tag (1 row), 0 de B', async () => {
    const { householdA, householdB, userA } = await seedTwoHouseholds();
    await insertTag(admin(), householdA.id, 'Tag A');
    await insertTag(admin(), householdB.id, 'Tag B');

    await asUser(userA.id, householdA.id, async (sql) => {
      const rows = await sql<{ household_id: string }[]>`select household_id from public.tags`;
      expect(rows).toHaveLength(1);
      expect(rows.every((r) => r.household_id === householdA.id)).toBe(true);
    });
  });

  test('SELECT com filtro cruzado (userA, WHERE household_id = B) → 0 rows', async () => {
    const { householdA, householdB, userA } = await seedTwoHouseholds();
    await insertTag(admin(), householdA.id, 'Tag A');
    await insertTag(admin(), householdB.id, 'Tag B');

    await asUser(userA.id, householdA.id, async (sql) => {
      const rows = await sql`select id from public.tags where household_id = ${householdB.id}`;
      expect(rows).toHaveLength(0);
    });
  });

  test('INSERT cross-household (userA → household B) é bloqueado por RLS', async () => {
    const { householdA, householdB, userA } = await seedTwoHouseholds();

    const blocked = await expectRlsBlocks(userA.id, householdA.id, async (sql) => {
      await insertTag(sql, householdB.id, 'INVÁLIDA');
    });
    expect(blocked).toBe(true);

    const rows = await admin()<{ n: number }[]>`select count(*)::int as n from public.tags`;
    expect(rows[0]?.n).toBe(0);
  });
});

describe('RLS application gate (SEC-5 / ADR-003 Fase 4 Fatia A): task_tags', () => {
  beforeEach(async () => {
    await resetData();
  });

  test('userA só vê a sua associação task_tag (1 row), 0 de B', async () => {
    const { householdA, householdB, userA, userB } = await seedTwoHouseholds();
    const taskA = await insertTask(admin(), householdA.id, userA.id, { title: 'Tarefa A' });
    const tagA = await insertTag(admin(), householdA.id, 'Tag A');
    await insertTaskTag(admin(), taskA, tagA, householdA.id);
    const taskB = await insertTask(admin(), householdB.id, userB.id, { title: 'Tarefa B' });
    const tagB = await insertTag(admin(), householdB.id, 'Tag B');
    await insertTaskTag(admin(), taskB, tagB, householdB.id);

    await asUser(userA.id, householdA.id, async (sql) => {
      const rows = await sql<{ household_id: string }[]>`select household_id from public.task_tags`;
      expect(rows).toHaveLength(1);
      expect(rows.every((r) => r.household_id === householdA.id)).toBe(true);
    });
  });

  test('INSERT cross-household (userA → task_tag de household B) é bloqueado por RLS', async () => {
    const { householdA, householdB, userA, userB } = await seedTwoHouseholds();
    const taskB = await insertTask(admin(), householdB.id, userB.id, { title: 'Tarefa B' });
    const tagB = await insertTag(admin(), householdB.id, 'Tag B');

    const blocked = await expectRlsBlocks(userA.id, householdA.id, async (sql) => {
      await insertTaskTag(sql, taskB, tagB, householdB.id);
    });
    expect(blocked).toBe(true);

    const rows = await admin()<{ n: number }[]>`select count(*)::int as n from public.task_tags`;
    expect(rows[0]?.n).toBe(0);
  });
});

describe('RLS application gate (SEC-5 / ADR-003 Fase 4 Fatia A): kanban_columns', () => {
  beforeEach(async () => {
    await resetData();
  });

  test('userA só vê a sua coluna (1 row), 0 de B', async () => {
    const { householdA, householdB, userA } = await seedTwoHouseholds();
    await insertKanbanColumn(admin(), householdA.id, { name: 'Coluna A' });
    await insertKanbanColumn(admin(), householdB.id, { name: 'Coluna B' });

    await asUser(userA.id, householdA.id, async (sql) => {
      const rows = await sql<
        { household_id: string }[]
      >`select household_id from public.kanban_columns`;
      expect(rows).toHaveLength(1);
      expect(rows.every((r) => r.household_id === householdA.id)).toBe(true);
    });
  });

  test('SELECT com filtro cruzado (userA, WHERE household_id = B) → 0 rows', async () => {
    const { householdA, householdB, userA } = await seedTwoHouseholds();
    await insertKanbanColumn(admin(), householdA.id, { name: 'Coluna A' });
    await insertKanbanColumn(admin(), householdB.id, { name: 'Coluna B' });

    await asUser(userA.id, householdA.id, async (sql) => {
      const rows = await sql`select id from public.kanban_columns where household_id = ${householdB.id}`;
      expect(rows).toHaveLength(0);
    });
  });

  test('INSERT cross-household (userA → coluna de household B) é bloqueado por RLS', async () => {
    const { householdA, householdB, userA } = await seedTwoHouseholds();

    const blocked = await expectRlsBlocks(userA.id, householdA.id, async (sql) => {
      await insertKanbanColumn(sql, householdB.id, { name: 'INVÁLIDA' });
    });
    expect(blocked).toBe(true);

    const rows = await admin()<{ n: number }[]>`select count(*)::int as n from public.kanban_columns`;
    expect(rows[0]?.n).toBe(0);
  });
});

describe('RLS application gate (SEC-5 / ADR-003 Fase 4 Fatia A): task_recurrences', () => {
  beforeEach(async () => {
    await resetData();
  });

  test('userA só vê a sua recorrência (1 row), 0 de B', async () => {
    const { householdA, householdB, userA, userB } = await seedTwoHouseholds();
    const tmplA = await insertTask(admin(), householdA.id, userA.id, { title: 'Template A' });
    await insertTaskRecurrence(admin(), householdA.id, tmplA);
    const tmplB = await insertTask(admin(), householdB.id, userB.id, { title: 'Template B' });
    await insertTaskRecurrence(admin(), householdB.id, tmplB);

    await asUser(userA.id, householdA.id, async (sql) => {
      const rows = await sql<
        { household_id: string }[]
      >`select household_id from public.task_recurrences`;
      expect(rows).toHaveLength(1);
      expect(rows.every((r) => r.household_id === householdA.id)).toBe(true);
    });
  });

  test('INSERT cross-household (userA → recorrência de household B) é bloqueado por RLS', async () => {
    const { householdA, householdB, userA, userB } = await seedTwoHouseholds();
    const tmplB = await insertTask(admin(), householdB.id, userB.id, { title: 'Template B' });

    const blocked = await expectRlsBlocks(userA.id, householdA.id, async (sql) => {
      await insertTaskRecurrence(sql, householdB.id, tmplB);
    });
    expect(blocked).toBe(true);

    const rows = await admin()<
      { n: number }[]
    >`select count(*)::int as n from public.task_recurrences`;
    expect(rows[0]?.n).toBe(0);
  });
});

describe('RLS application gate: service_role bypass intacto (AC-E3)', () => {
  beforeEach(async () => {
    await resetData();
  });

  test('service_role vê ambos os households (jobs Inngest/migrations não-afectados)', async () => {
    const { householdA, householdB, userA, userB } = await seedTwoHouseholds();
    await insertTask(admin(), householdA.id, userA.id, { title: 'Tarefa A' });
    await insertTask(admin(), householdB.id, userB.id, { title: 'Tarefa B' });

    // O caminho service_role (getServiceDb()) bypassa RLS por design. Simulamos
    // a sua semântica abrindo uma transação como `service_role` e confirmando que
    // vê as tarefas de AMBOS os households.
    await admin().begin(async (sql) => {
      await sql.unsafe('set local role service_role');
      const rows = await sql<{ n: number }[]>`select count(*)::int as n from public.tasks`;
      expect(rows[0]?.n).toBe(2);
    });
  });
});
