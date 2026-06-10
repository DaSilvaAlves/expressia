/**
 * SEC-8.1 — gate de REGRESSÃO do `withHousehold` REAL de produção.
 *
 * AO CONTRÁRIO de `executeAtomic.rls.test.ts` (AC9), que montava um `txRunner`
 * caseiro que REPLICAVA a mecânica do `withHousehold`, este teste importa e
 * exercita o `withHousehold` GENUÍNO de `@meu-jarvis/db/client` (o código de
 * produção, mesmíssima função que os 109 call-sites SEC-2→8 invocam). Foi essa
 * réplica que mascarou a regressão: a implementação real abria a transacção com
 * `pgSql.begin()` + `drizzle(pgTx)` e esse cliente Drizzle estava PARTIDO em
 * runtime — qualquer query lançava
 * `TypeError: Cannot read properties of undefined (reading 'parsers')`.
 *
 * Para correr o código de produção contra o Postgres real do Testcontainer,
 * apontamos `DATABASE_URL` (lido por `getDb()`) à connection do container ANTES
 * de qualquer import/uso do módulo. O role `authenticated` e as funções
 * `auth.uid()`/`auth.jwt()` foram criados pelo bootstrap do globalSetup, pelo que
 * o `SET LOCAL ROLE authenticated` + claims activam as 104 policies — RLS viva.
 *
 * Prova:
 *   (a) REGRESSÃO DIRECTA: uma escrita simples via `withHousehold` real SUCEDE.
 *       Com o código antigo (`drizzle(pgTx)`) este `tx.execute(...)` lançaria o
 *       `TypeError ...parsers` e o teste falharia.
 *   (b) RLS ACTIVA: dentro da tx, `auth.uid()` é o `sub` dos claims (não-NULL) e
 *       `current_household_id()` é o household correcto.
 *   (c) CROSS-HOUSEHOLD REJEITADO: um INSERT em `tasks` com `household_id` de B,
 *       sob claims de A, é bloqueado pelo Postgres (RLS), não pela app — preserva
 *       a garantia do AC9 original.
 *
 * Trace: SEC-8.1 (regressão withHousehold); ADR-003 §3, §12.8.
 */
import { randomUUID } from 'node:crypto';

import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'vitest';

import { admin } from '@/helpers/fixtures';
import {
  closeRlsHarness,
  getRlsHarness,
  resetData,
  seedTwoHouseholds,
} from '@/rls-harness';

// ─────────────────────────────────────────────────────────────────────────────
// Wiring: apontar o `getDb()` de produção ao Postgres do Testcontainer
// ─────────────────────────────────────────────────────────────────────────────

// Import dinâmico DEPOIS de `DATABASE_URL` estar definido (em beforeAll). O
// módulo de produção lê `process.env.DATABASE_URL` lazy dentro de `getDb()`, mas
// importamos via dynamic import para garantir ordem determinística e evitar que
// qualquer avaliação top-level capture a env errada.
type DbClientModule = typeof import('@meu-jarvis/db/client');
let withHousehold: DbClientModule['withHousehold'];

beforeAll(async () => {
  const { url } = getRlsHarness();
  // O `getDb()` de produção liga via `DATABASE_URL` com `prepare: false`
  // (pgbouncer-safe) — compatível com o container vanilla. O role `authenticated`
  // existe (bootstrap), logo `SET LOCAL ROLE authenticated` activa a RLS.
  process.env.DATABASE_URL = url;
  const mod = await import('@meu-jarvis/db/client');
  withHousehold = mod.withHousehold;
});

afterAll(async () => {
  await closeRlsHarness();
});

async function countTasks(): Promise<number> {
  const rows = await admin()<{ n: number }[]>`select count(*)::int as n from public.tasks`;
  return rows[0]?.n ?? -1;
}

function isRlsRejection(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err);
  return /row-level security|violates row-level|new row violates/i.test(msg);
}

describe('SEC-8.1 — withHousehold REAL de produção (regressão TypeError + RLS viva)', () => {
  beforeEach(async () => {
    await resetData();
  });

  test('(a) REGRESSÃO: escrita simples via withHousehold real SUCEDE (falharia com o código antigo)', async () => {
    const { householdA, userA } = await seedTwoHouseholds();
    const taskId = randomUUID();

    // Esta chamada percorre EXACTAMENTE o caminho de produção: db.transaction →
    // SET LOCAL ROLE authenticated → set_config(claims) → fn(tx) → tx.execute.
    // Com o código antigo (drizzle(pgTx)) este `tx.execute` lançaria
    // `TypeError: Cannot read properties of undefined (reading 'parsers')`.
    await withHousehold({ userId: userA.id, householdId: householdA.id }, async (tx) => {
      await tx.execute(sql`
        insert into public.tasks (id, household_id, created_by_user_id, title)
        values (${taskId}, ${householdA.id}, ${userA.id}, 'SEC-8.1 regressão')
      `);
    });

    // Commit genuíno — admin (bypass RLS) confirma persistência.
    expect(await countTasks()).toBe(1);
  });

  test('(b) RLS ACTIVA: dentro da tx, auth.uid() = sub dos claims e current_household_id() = household correcto', async () => {
    const { householdA, userA } = await seedTwoHouseholds();

    const ctx = await withHousehold(
      { userId: userA.id, householdId: householdA.id },
      async (tx) => {
        const rows = (await tx.execute(sql`
          select auth.uid()::text as uid, public.current_household_id()::text as hh
        `)) as unknown as Array<{ uid: string | null; hh: string | null }>;
        return rows[0];
      },
    );

    // Se a RLS estivesse inerte (getDb()/rolbypassrls sem SET ROLE), uid seria NULL.
    expect(ctx?.uid).toBe(userA.id);
    expect(ctx?.hh).toBe(householdA.id);
  });

  test('(c) CROSS-HOUSEHOLD: INSERT em tasks(B) sob claims A é REJEITADO pelo Postgres (RLS), rollback total', async () => {
    const { householdA, householdB, userA } = await seedTwoHouseholds();
    const taskId = randomUUID();

    let threw = false;
    let caught: unknown;
    try {
      await withHousehold({ userId: userA.id, householdId: householdA.id }, async (tx) => {
        // Vector de ataque: escrever household_id = B sob sessão scoped a A.
        await tx.execute(sql`
          insert into public.tasks (id, household_id, created_by_user_id, title)
          values (${taskId}, ${householdB.id}, ${userA.id}, 'cross-household')
        `);
      });
    } catch (err) {
      threw = true;
      caught = err;
    }

    expect(threw).toBe(true);
    // A rejeição vem do Postgres (RLS), não do filtro app.
    expect(isRlsRejection(caught)).toBe(true);
    // Rollback total — nada persistiu (se a RLS estivesse inerte, seria 1).
    expect(await countTasks()).toBe(0);
  });
});
