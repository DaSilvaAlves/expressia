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
import { afterAll, beforeEach, describe, expect, test } from 'vitest';

import { admin, insertAccount, insertTask, insertTransaction } from '@/helpers/fixtures';
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
