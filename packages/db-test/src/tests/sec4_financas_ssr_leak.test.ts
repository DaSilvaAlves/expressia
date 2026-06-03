/**
 * SEC-4 — Prova empírica do leak cross-tenant nas SSR pages de Finanças.
 *
 * Contexto (CROSS-TENANT-AUDIT-20260602 + ADR-003 §1.1): o `getDb()` de runtime
 * liga como role `postgres` (rolbypassrls=TRUE) → as RLS policies NÃO são
 * avaliadas em runtime. Os helpers em `apps/web/src/lib/finance/*` executam
 * queries de domínio SEM qualquer filtro `where household_id` — confiam apenas
 * em "RLS via getDb() authenticated", que é INERTE no role de runtime.
 *
 * Este teste replica as QUERY-SHAPES EXACTAS dos helpers de Finanças (copiadas
 * verbatim de account-balances.ts, month-summary.ts, list-card-statements.ts,
 * list-variable-transactions.ts, list-recurrences.ts) e prova, com o role
 * bypassrls (= role de runtime de getDb()), que:
 *
 *   1. A query-shape SEM filtro household_id vê rows de AMBOS os households
 *      (replica o leak live em prod hoje).
 *   2. A mesma query-shape COM `and household_id = $A` vê só os rows de A
 *      (o filtro app-enforced isolaria — é o fix que SEC-4 propõe).
 *
 * Trace: Story SEC-4 (draft); CROSS-TENANT-AUDIT-20260602; ADR-003 §1.1.
 */
import { afterAll, beforeEach, describe, expect, test } from 'vitest';

import {
  admin,
  insertAccount,
  insertCard,
  insertRecurrence,
  insertTransaction,
} from '@/helpers/fixtures';
import { closeRlsHarness, resetData, seedTwoHouseholds } from '@/rls-harness';

afterAll(async () => {
  await closeRlsHarness();
});

describe('SEC-4: leak cross-tenant nas query-shapes dos helpers lib/finance/* (role runtime bypassrls)', () => {
  beforeEach(async () => {
    await resetData();
  });

  // ───────────────────────────────────────────────────────────────────────────
  // account-balances.ts → vista /financas/patrimonio
  // Query verbatim: `from public.accounts where archived_at is null`
  // ───────────────────────────────────────────────────────────────────────────
  test('account-balances.ts: `accounts where archived_at is null` SEM filtro vê AS 2 households; COM filtro vê só A', async () => {
    const { householdA, householdB } = await seedTwoHouseholds();
    await insertAccount(admin(), householdA.id, { name: 'Conta A' });
    await insertAccount(admin(), householdB.id, { name: 'Conta B' });

    // Query-shape EXACTA do helper (account-balances.ts L91-101), sem filtro.
    const leaked = await admin()<{ name: string }[]>`
      select id, name, account_type, bank_name, iban_last4,
             initial_balance_cents::int as initial_balance_cents
      from public.accounts
      where archived_at is null
      order by name
    `;
    // LEAK: o role de runtime vê as contas de A E de B.
    expect(leaked.map((r) => r.name)).toEqual(['Conta A', 'Conta B']);

    // O fix SEC-4 acrescentaria `and household_id = $A` → isola.
    const scoped = await admin()<{ name: string }[]>`
      select name from public.accounts
      where archived_at is null and household_id = ${householdA.id}::uuid
      order by name
    `;
    expect(scoped.map((r) => r.name)).toEqual(['Conta A']);
  });

  // ───────────────────────────────────────────────────────────────────────────
  // month-summary.ts → vista /financas/este-mes
  // Query verbatim: `from public.transactions where transaction_date between ... and is_projected = false`
  // ───────────────────────────────────────────────────────────────────────────
  test('month-summary.ts: totais do mês SEM filtro somam transacções das 2 households; COM filtro só A', async () => {
    const { householdA, householdB, userA, userB } = await seedTwoHouseholds();
    const accA = await insertAccount(admin(), householdA.id, { name: 'Conta A' });
    const accB = await insertAccount(admin(), householdB.id, { name: 'Conta B' });
    // insertTransaction grava amount_cents=8870, kind='expense', date '2026-05-01'.
    await insertTransaction(admin(), householdA.id, userA.id, accA);
    await insertTransaction(admin(), householdB.id, userB.id, accB);

    const monthStart = '2026-05-01';
    const monthEnd = '2026-05-31';

    // Query-shape EXACTA do helper (month-summary.ts L85-93), sem filtro.
    const leaked = await admin()<{ total_expense_cents: number }[]>`
      select
        coalesce(sum(amount_cents) filter (where kind = 'income'), 0)::int  as total_income_cents,
        coalesce(sum(amount_cents) filter (where kind = 'expense'), 0)::int as total_expense_cents
      from public.transactions
      where transaction_date >= ${monthStart}::date
        and transaction_date <= ${monthEnd}::date
        and is_projected = false
    `;
    // LEAK: soma 8870 (A) + 8870 (B) = 17740 — mistura households.
    expect(leaked[0]?.total_expense_cents).toBe(17740);

    const scoped = await admin()<{ total_expense_cents: number }[]>`
      select coalesce(sum(amount_cents) filter (where kind = 'expense'), 0)::int as total_expense_cents
      from public.transactions
      where transaction_date >= ${monthStart}::date
        and transaction_date <= ${monthEnd}::date
        and is_projected = false
        and household_id = ${householdA.id}::uuid
    `;
    // Fix: só 8870 (A).
    expect(scoped[0]?.total_expense_cents).toBe(8870);
  });

  // ───────────────────────────────────────────────────────────────────────────
  // list-card-statements.ts → vista /financas/cartoes
  // Query verbatim: `from public.cards c left join accounts a ... where c.archived_at is null`
  // ───────────────────────────────────────────────────────────────────────────
  test('list-card-statements.ts: `cards where archived_at is null` SEM filtro vê cartões das 2 households; COM filtro só A', async () => {
    const { householdA, householdB } = await seedTwoHouseholds();
    const accA = await insertAccount(admin(), householdA.id, { name: 'Conta A' });
    const accB = await insertAccount(admin(), householdB.id, { name: 'Conta B' });
    await insertCard(admin(), householdA.id, accA, { name: 'Cartão A' });
    await insertCard(admin(), householdB.id, accB, { name: 'Cartão B' });

    // Query-shape EXACTA do helper (list-card-statements.ts L116-124), sem filtro.
    const leaked = await admin()<{ name: string }[]>`
      select
        c.id, c.name, c.last4, c.card_type, c.closing_day, c.due_day,
        coalesce(a.name, '—') as account_name
      from public.cards c
      left join public.accounts a on a.id = c.account_id
      where c.archived_at is null
      order by c.name asc
    `;
    expect(leaked.map((r) => r.name)).toEqual(['Cartão A', 'Cartão B']);

    const scoped = await admin()<{ name: string }[]>`
      select c.name from public.cards c
      where c.archived_at is null and c.household_id = ${householdA.id}::uuid
      order by c.name asc
    `;
    expect(scoped.map((r) => r.name)).toEqual(['Cartão A']);
  });

  // ───────────────────────────────────────────────────────────────────────────
  // list-recurrences.ts → vista /financas/recorrentes
  // ───────────────────────────────────────────────────────────────────────────
  test('list-recurrences.ts: `recurrences` SEM filtro vê recorrências das 2 households; COM filtro só A', async () => {
    const { householdA, householdB, userA, userB } = await seedTwoHouseholds();
    const accA = await insertAccount(admin(), householdA.id, { name: 'Conta A' });
    const accB = await insertAccount(admin(), householdB.id, { name: 'Conta B' });
    await insertRecurrence(admin(), householdA.id, userA.id, accA);
    await insertRecurrence(admin(), householdB.id, userB.id, accB);

    // Recorrências sem filtro — leak.
    const leaked = await admin()<{ household_id: string }[]>`
      select household_id::text from public.recurrences
    `;
    const seesBoth =
      leaked.some((r) => r.household_id === householdA.id) &&
      leaked.some((r) => r.household_id === householdB.id);
    expect(seesBoth).toBe(true);

    const scoped = await admin()<{ n: number }[]>`
      select count(*)::int as n from public.recurrences
      where household_id = ${householdA.id}::uuid
    `;
    expect(scoped[0]?.n).toBe(1);
  });

  // ───────────────────────────────────────────────────────────────────────────
  // list-variable-transactions.ts → vista /financas/variaveis
  // ───────────────────────────────────────────────────────────────────────────
  test('list-variable-transactions.ts: `transactions` SEM filtro vê transacções das 2 households; COM filtro só A', async () => {
    const { householdA, householdB, userA, userB } = await seedTwoHouseholds();
    const accA = await insertAccount(admin(), householdA.id, { name: 'Conta A' });
    const accB = await insertAccount(admin(), householdB.id, { name: 'Conta B' });
    await insertTransaction(admin(), householdA.id, userA.id, accA);
    await insertTransaction(admin(), householdB.id, userB.id, accB);

    const leaked = await admin()<{ household_id: string }[]>`
      select household_id::text from public.transactions
      where is_projected = false
    `;
    const seesBoth =
      leaked.some((r) => r.household_id === householdA.id) &&
      leaked.some((r) => r.household_id === householdB.id);
    expect(seesBoth).toBe(true);

    const scoped = await admin()<{ n: number }[]>`
      select count(*)::int as n from public.transactions
      where is_projected = false and household_id = ${householdA.id}::uuid
    `;
    expect(scoped[0]?.n).toBe(1);
  });
});
