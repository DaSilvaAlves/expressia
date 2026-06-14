/**
 * Guarda de FK cross-tenant em finanças — prova da migração 0023.
 *
 * Causa-raiz (ver handoff mj-handoff-smoke-pass-next-account-id-validation-20260614
 * + memória cross_tenant_legacy_transactions): a RLS valida o household_id DA
 * PRÓPRIA ROW, mas o FK `transactions.account_id -> accounts.id` aceitava QUALQUER
 * conta existente, mesmo de outro household. Foi a origem das 3 tx cross-tenant
 * apagadas no B2.
 *
 * A migração 0023 instala triggers BEFORE INSERT/UPDATE que garantem que
 * account_id/card_id referenciados pertencem ao MESMO household da row. Em
 * violação levantam SQLSTATE custom '23P51'.
 *
 * Estes testes correm via `admin()` (superuser do container) de PROPÓSITO: os
 * triggers NÃO são ignorados por superuser nem por service_role, logo provam que
 * a guarda é independente do caller (app, agente AI, job ou script). Provar a
 * rejeição via admin é o caso mais forte — se o admin não consegue furar, ninguém
 * consegue.
 *
 * Trace: NFR5 (defesa em profundidade, camada DB). Fase 0 opção B.
 */
import { afterAll, beforeEach, describe, expect, test } from 'vitest';

import { admin, insertAccount, insertCard } from '@/helpers/fixtures';
import { closeRlsHarness, resetData, seedTwoHouseholds } from '@/rls-harness';

afterAll(async () => {
  await closeRlsHarness();
});

/** SQLSTATE custom levantado pelos triggers da 0023 em violação cross-tenant. */
const CROSS_TENANT_ERRCODE = '23P51';

/**
 * Extrai o SQLSTATE de um erro postgres.js (`err.code`). Devolve '' se ausente.
 */
function pgErrCode(err: unknown): string {
  if (err && typeof err === 'object' && 'code' in err) {
    return String((err as { code: unknown }).code ?? '');
  }
  return '';
}

describe('Guarda FK cross-tenant: transactions', () => {
  beforeEach(async () => {
    await resetData();
  });

  test('INSERT com account_id de OUTRO household é REJEITADO (23P51)', async () => {
    const { householdA, householdB, userA } = await seedTwoHouseholds();
    // Conta pertence ao household B.
    const accB = await insertAccount(admin(), householdB.id);

    let caught: unknown;
    try {
      // Row diz household A, mas aponta para conta de B → trigger rejeita.
      await admin()`
        insert into public.transactions (
          household_id, created_by_user_id, account_id,
          amount_cents, kind, description, transaction_date, payment_method
        )
        values (
          ${householdA.id}, ${userA.id}, ${accB},
          8870, 'expense', 'Cross-tenant ilegal', '2026-05-01'::date, 'card'
        )
      `;
    } catch (err) {
      caught = err;
    }

    expect(caught).toBeDefined();
    expect(pgErrCode(caught)).toBe(CROSS_TENANT_ERRCODE);
  });

  test('INSERT com account_id do PRÓPRIO household PASSA (sem regressão)', async () => {
    const { householdA, userA } = await seedTwoHouseholds();
    const accA = await insertAccount(admin(), householdA.id);

    // Não deve lançar.
    await admin()`
      insert into public.transactions (
        household_id, created_by_user_id, account_id,
        amount_cents, kind, description, transaction_date, payment_method
      )
      values (
        ${householdA.id}, ${userA.id}, ${accA},
        8870, 'expense', 'Mesma família — válida', '2026-05-01'::date, 'card'
      )
    `;

    const rows = await admin()<{ n: number }[]>`
      select count(*)::int as n from public.transactions where household_id = ${householdA.id}
    `;
    expect(rows[0]?.n).toBe(1);
  });

  test('INSERT com card_id de OUTRO household é REJEITADO (23P51)', async () => {
    const { householdA, householdB, userA } = await seedTwoHouseholds();
    const accB = await insertAccount(admin(), householdB.id);
    const cardB = await insertCard(admin(), householdB.id, accB);

    let caught: unknown;
    try {
      await admin()`
        insert into public.transactions (
          household_id, created_by_user_id, card_id,
          amount_cents, kind, description, transaction_date, payment_method
        )
        values (
          ${householdA.id}, ${userA.id}, ${cardB},
          8870, 'expense', 'Cross-tenant cartão', '2026-05-01'::date, 'card'
        )
      `;
    } catch (err) {
      caught = err;
    }

    expect(caught).toBeDefined();
    expect(pgErrCode(caught)).toBe(CROSS_TENANT_ERRCODE);
  });

  test('INSERT com card_id do PRÓPRIO household PASSA (sem regressão)', async () => {
    const { householdA, userA } = await seedTwoHouseholds();
    const accA = await insertAccount(admin(), householdA.id);
    const cardA = await insertCard(admin(), householdA.id, accA);

    await admin()`
      insert into public.transactions (
        household_id, created_by_user_id, card_id,
        amount_cents, kind, description, transaction_date, payment_method
      )
      values (
        ${householdA.id}, ${userA.id}, ${cardA},
        8870, 'expense', 'Cartão da família — válida', '2026-05-01'::date, 'card'
      )
    `;

    const rows = await admin()<{ n: number }[]>`
      select count(*)::int as n from public.transactions where household_id = ${householdA.id}
    `;
    expect(rows[0]?.n).toBe(1);
  });

  test('UPDATE que aponta account_id para OUTRO household é REJEITADO (23P51)', async () => {
    const { householdA, householdB, userA } = await seedTwoHouseholds();
    const accA = await insertAccount(admin(), householdA.id);
    const accB = await insertAccount(admin(), householdB.id);

    // INSERT legítimo (conta de A).
    const inserted = await admin()<{ id: string }[]>`
      insert into public.transactions (
        household_id, created_by_user_id, account_id,
        amount_cents, kind, description, transaction_date, payment_method
      )
      values (
        ${householdA.id}, ${userA.id}, ${accA},
        8870, 'expense', 'Válida', '2026-05-01'::date, 'card'
      )
      returning id
    `;
    const txId = inserted[0]!.id;

    // UPDATE tenta repontar para a conta de B → trigger rejeita.
    let caught: unknown;
    try {
      await admin()`
        update public.transactions set account_id = ${accB} where id = ${txId}
      `;
    } catch (err) {
      caught = err;
    }

    expect(caught).toBeDefined();
    expect(pgErrCode(caught)).toBe(CROSS_TENANT_ERRCODE);
  });
});

describe('Guarda FK cross-tenant: recurrences', () => {
  beforeEach(async () => {
    await resetData();
  });

  test('INSERT recurrence com account_id de OUTRO household é REJEITADO (23P51)', async () => {
    const { householdA, householdB, userA } = await seedTwoHouseholds();
    const accB = await insertAccount(admin(), householdB.id);

    let caught: unknown;
    try {
      await admin()`
        insert into public.recurrences (
          household_id, created_by_user_id, description, kind, amount_cents,
          account_id, payment_method, frequency, starts_on
        )
        values (
          ${householdA.id}, ${userA.id}, 'Renda ilegal', 'expense', 1500,
          ${accB}, 'transfer', 'monthly', '2026-01-01'::date
        )
      `;
    } catch (err) {
      caught = err;
    }

    expect(caught).toBeDefined();
    expect(pgErrCode(caught)).toBe(CROSS_TENANT_ERRCODE);
  });

  test('INSERT recurrence com account_id do PRÓPRIO household PASSA', async () => {
    const { householdA, userA } = await seedTwoHouseholds();
    const accA = await insertAccount(admin(), householdA.id);

    await admin()`
      insert into public.recurrences (
        household_id, created_by_user_id, description, kind, amount_cents,
        account_id, payment_method, frequency, starts_on
      )
      values (
        ${householdA.id}, ${userA.id}, 'Renda válida', 'expense', 1500,
        ${accA}, 'transfer', 'monthly', '2026-01-01'::date
      )
    `;

    const rows = await admin()<{ n: number }[]>`
      select count(*)::int as n from public.recurrences where household_id = ${householdA.id}
    `;
    expect(rows[0]?.n).toBe(1);
  });
});

describe('Guarda FK cross-tenant: cards e installments', () => {
  beforeEach(async () => {
    await resetData();
  });

  test('INSERT card com account_id de OUTRO household é REJEITADO (23P51)', async () => {
    const { householdA, householdB } = await seedTwoHouseholds();
    const accB = await insertAccount(admin(), householdB.id);

    let caught: unknown;
    try {
      // Cartão diz household A, conta de B.
      await admin()`
        insert into public.cards (
          household_id, account_id, name, card_type, credit_limit_cents
        )
        values (
          ${householdA.id}, ${accB}, 'Cartão ilegal', 'credit', 500000
        )
      `;
    } catch (err) {
      caught = err;
    }

    expect(caught).toBeDefined();
    expect(pgErrCode(caught)).toBe(CROSS_TENANT_ERRCODE);
  });

  test('INSERT card com account_id do PRÓPRIO household PASSA', async () => {
    const { householdA } = await seedTwoHouseholds();
    const accA = await insertAccount(admin(), householdA.id);
    const cardId = await insertCard(admin(), householdA.id, accA);
    expect(cardId).toBeTruthy();
  });

  test('INSERT installment com card_id de OUTRO household é REJEITADO (23P51)', async () => {
    const { householdA, householdB, userA } = await seedTwoHouseholds();
    const accB = await insertAccount(admin(), householdB.id);
    const cardB = await insertCard(admin(), householdB.id, accB);

    let caught: unknown;
    try {
      await admin()`
        insert into public.installments (
          household_id, created_by_user_id, card_id, description,
          total_amount_cents, num_installments, per_installment_cents,
          purchased_on, first_installment_on
        )
        values (
          ${householdA.id}, ${userA.id}, ${cardB}, 'Parcela ilegal',
          120000, 12, 10000,
          '2026-01-15'::date, '2026-02-15'::date
        )
      `;
    } catch (err) {
      caught = err;
    }

    expect(caught).toBeDefined();
    expect(pgErrCode(caught)).toBe(CROSS_TENANT_ERRCODE);
  });

  test('INSERT installment com card_id do PRÓPRIO household PASSA', async () => {
    const { householdA, userA } = await seedTwoHouseholds();
    const accA = await insertAccount(admin(), householdA.id);
    const cardA = await insertCard(admin(), householdA.id, accA);

    await admin()`
      insert into public.installments (
        household_id, created_by_user_id, card_id, description,
        total_amount_cents, num_installments, per_installment_cents,
        purchased_on, first_installment_on
      )
      values (
        ${householdA.id}, ${userA.id}, ${cardA}, 'Parcela válida',
        120000, 12, 10000,
        '2026-01-15'::date, '2026-02-15'::date
      )
    `;

    const rows = await admin()<{ n: number }[]>`
      select count(*)::int as n from public.installments where household_id = ${householdA.id}
    `;
    expect(rows[0]?.n).toBe(1);
  });
});
