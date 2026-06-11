#!/usr/bin/env tsx
/**
 * Helper de smoke E2E (read-only) — dump do estado real de um household.
 *
 * Contexto (make-it-work, pós SEC-8.1): exercitar E2E pela UI directa as áreas
 * nunca testadas em runtime (os 109 call-sites SEC-2→8). Este script imprime o
 * ground-truth da DB para um household, para cruzar com o que a UI mostra e
 * apanhar bugs latentes data-driven. Read-only — nunca escreve. NÃO usar em prod
 * para nada além de leitura de diagnóstico.
 *
 * Uso:
 *   pnpm --filter @meu-jarvis/db exec tsx src/scripts/smoke-baseline.ts --household=2dedb1ec-dc6f-4445-a5b4-b5f942755655
 *
 * Trace: handoff mj-handoff-session-sec8.1-shipped-continue-make-it-work-20260610.
 */
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { config as loadEnv } from 'dotenv';
import postgres from 'postgres';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const PKG_ROOT = resolve(__dirname, '..', '..');
loadEnv({ path: join(PKG_ROOT, '.env.local') });

function parseArg(name: string): string | undefined {
  const prefix = `--${name}=`;
  const arg = process.argv.find((a) => a.startsWith(prefix));
  return arg ? arg.slice(prefix.length) : undefined;
}

async function main(): Promise<number> {
  const url = process.env.DIRECT_URL;
  if (!url) {
    console.error('DIRECT_URL não definido em packages/db/.env.local.');
    return 1;
  }
  const householdId = parseArg('household');
  if (!householdId) {
    console.error('Indica --household=<uuid>');
    return 1;
  }

  const sql = postgres(url, { max: 1, prepare: false });
  try {
    console.log(`\n════════ BASELINE household ${householdId} ════════`);

    console.log('\n── Membros ──');
    console.log(
      await sql`
        select user_id, role, display_name
        from public.household_members
        where household_id = ${householdId}::uuid
        order by joined_at
      `,
    );

    console.log('\n── Contas (accounts) ──');
    console.log(
      await sql`
        select id, name, account_type, balance_cents, initial_balance_cents, currency,
               archived_at is not null as archived
        from public.accounts
        where household_id = ${householdId}::uuid
        order by created_at
      `,
    );

    // Saldo computado on-read por conta — replica EXACTAMENTE a fórmula de
    // apps/web/src/lib/finance/account-balances.ts (getAccountBalances):
    //   balance_cents = initial_balance_cents + SUM(income) − SUM(expense)
    //   filtrando is_projected = false, excluindo transfer (account_id is not null
    //   já filtra; transfer não tem account_id único modelado).
    // Objectivo: provar o gap entre `balance_cents` stored (dead column, sempre €0)
    // e o saldo real. Confirma o diagnóstico W1 antes de tocar na API (Opção A).
    console.log('\n── Saldo computado on-read vs stored (por conta) ──');
    console.log(
      await sql`
        select
          a.id,
          a.name,
          a.balance_cents as stored_cents,
          a.initial_balance_cents,
          coalesce(s.income_cents, 0) as income_cents,
          coalesce(s.expense_cents, 0) as expense_cents,
          a.initial_balance_cents + coalesce(s.income_cents, 0) - coalesce(s.expense_cents, 0)
            as computed_cents
        from public.accounts a
        left join (
          select
            account_id,
            coalesce(sum(amount_cents) filter (where kind = 'income'), 0)::int as income_cents,
            coalesce(sum(amount_cents) filter (where kind = 'expense'), 0)::int as expense_cents
          from public.transactions
          where account_id is not null
            and is_projected = false
            and household_id = ${householdId}::uuid
          group by account_id
        ) s on s.account_id = a.id
        where a.household_id = ${householdId}::uuid
          and a.archived_at is null
        order by a.created_at
      `,
    );

    console.log('\n── Cartões (cards) ──');
    console.log(
      await sql`
        select id, name, last4, credit_limit_cents, closing_day, due_day
        from public.cards
        where household_id = ${householdId}::uuid
        order by created_at
      `,
    );

    console.log('\n── Transacções (últimas 15) ──');
    console.log(
      await sql`
        select id, kind, amount_cents, account_id, is_projected, description,
               transaction_date, category_id
        from public.transactions
        where household_id = ${householdId}::uuid
        order by transaction_date desc, created_at desc
        limit 15
      `,
    );

    console.log('\n── Totais do mês corrente (por kind) ──');
    console.log(
      await sql`
        select
          count(*) as tx_count,
          coalesce(sum(amount_cents) filter (where kind = 'income'), 0) as income_cents,
          coalesce(sum(amount_cents) filter (where kind = 'expense'), 0) as expense_cents
        from public.transactions
        where household_id = ${householdId}::uuid
          and date_trunc('month', transaction_date) = date_trunc('month', now())
      `,
    );

    console.log('\n── Recorrências ──');
    console.log(
      await sql`
        select id, description, amount_cents, kind, frequency, next_run_on, active
        from public.recurrences
        where household_id = ${householdId}::uuid
        order by next_run_on
      `,
    );

    console.log('\n── Tarefas (últimas 20) ──');
    console.log(
      await sql`
        select id, title, status, priority, due_date, due_time, completed_at
        from public.tasks
        where household_id = ${householdId}::uuid
        order by created_at desc
        limit 20
      `,
    );

    console.log('\n════════ FIM BASELINE ════════\n');
    return 0;
  } catch (err) {
    console.error('Erro a ler baseline:', err);
    return 1;
  } finally {
    await sql.end({ timeout: 5 });
  }
}

main().then((code) => process.exit(code));
