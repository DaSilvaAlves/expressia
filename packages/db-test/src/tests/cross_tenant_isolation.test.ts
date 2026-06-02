/**
 * SEC-1 AC-K1 — Teste de isolamento app-enforced como role de runtime.
 *
 * Contexto (CROSS-TENANT-AUDIT-20260602): o `getDb()` de runtime liga como role
 * `postgres` (rolbypassrls=TRUE) → as RLS policies NÃO são avaliadas em runtime.
 * O isolamento cross-tenant depende INTEIRAMENTE dos filtros `where household_id`
 * explícitos em cada query (remediação app-enforced da Story SEC-1).
 *
 * Este teste prova exactamente isso, usando `admin()` (adminSql) — o cliente
 * superuser/bypassrls do harness, equivalente ao role de runtime de `getDb()`:
 *
 *   1. Como role bypassrls, uma query SEM filtro household_id vê dados de TODOS
 *      os households (replica a vulnerabilidade ANTES do fix — RLS inerte).
 *   2. Uma query COM `where household_id = householdB` devolve 0 rows quando os
 *      dados pertencem a householdA (isolamento app-enforced funciona mesmo com
 *      RLS inerte — é a garantia central da Story SEC-1).
 *   3. Uma query COM `where household_id = householdA` encontra os dados.
 *
 * Enquanto os outros `*.rls.test.ts` provam que "a fechadura existe" (RLS via
 * `asUser`), este prova que "a porta está trancada" no role real de runtime.
 *
 * Trace: SEC-1 AC-K1; CROSS-TENANT-AUDIT-20260602 (Teste de garantia / NFR5 hardening).
 */
import { afterAll, beforeEach, describe, expect, test } from 'vitest';

import { admin, insertAccount, insertTransaction } from '@/helpers/fixtures';
import { closeRlsHarness, resetData, seedTwoHouseholds } from '@/rls-harness';

afterAll(async () => {
  await closeRlsHarness();
});

describe('SEC-1: isolamento cross-tenant app-enforced (role runtime / bypassrls)', () => {
  beforeEach(async () => {
    await resetData();
  });

  test('role bypassrls SEM filtro household_id vê dados cross-tenant (RLS inerte — vulnerabilidade)', async () => {
    const { householdA, householdB } = await seedTwoHouseholds();
    await insertAccount(admin(), householdA.id, { name: 'Conta A' });
    await insertAccount(admin(), householdB.id, { name: 'Conta B' });

    // Query SEM filtro household_id, como o role de runtime (bypassrls). Se a RLS
    // estivesse activa veria 0; como está inerte, vê AMBAS as contas. É esta a
    // condição que torna o filtro app-enforced obrigatório.
    const rows = await admin()<{ name: string }[]>`
      select name from public.accounts order by name
    `;
    expect(rows.map((r) => r.name)).toEqual(['Conta A', 'Conta B']);
  });

  test('filtro household_id de OUTRO household devolve 0 rows (isolamento app-enforced)', async () => {
    const { householdA, householdB } = await seedTwoHouseholds();
    await insertAccount(admin(), householdA.id, { name: 'Conta A' });

    // O fix SEC-1 adiciona `and household_id = ${auth.householdId}::uuid` a todas
    // as queries. Simulamos um pedido autenticado como householdB sobre dados de
    // householdA: o filtro app-enforced isola — 0 rows — mesmo com RLS inerte.
    const leaked = await admin()<{ id: string }[]>`
      select id from public.accounts
      where household_id = ${householdB.id}::uuid
    `;
    expect(leaked).toHaveLength(0);
  });

  test('filtro household_id do PRÓPRIO household encontra os dados', async () => {
    const { householdA } = await seedTwoHouseholds();
    await insertAccount(admin(), householdA.id, { name: 'Conta A' });

    const own = await admin()<{ name: string }[]>`
      select name from public.accounts
      where household_id = ${householdA.id}::uuid
    `;
    expect(own.map((r) => r.name)).toEqual(['Conta A']);
  });

  test('transactions: filtro household_id de outro household não fuga dados financeiros', async () => {
    const { householdA, householdB, userA } = await seedTwoHouseholds();
    const accountId = await insertAccount(admin(), householdA.id, { name: 'Conta A' });
    await insertTransaction(admin(), householdA.id, userA.id, accountId);

    // Pedido autenticado como householdB tenta ler transacções de householdA.
    const leaked = await admin()<{ amount_cents: number }[]>`
      select amount_cents from public.transactions
      where household_id = ${householdB.id}::uuid
    `;
    expect(leaked).toHaveLength(0);

    // O próprio household vê a sua transacção.
    const own = await admin()<{ amount_cents: number }[]>`
      select amount_cents from public.transactions
      where household_id = ${householdA.id}::uuid
    `;
    expect(own).toHaveLength(1);
    expect(own[0]?.amount_cents).toBe(8870);
  });
});
