#!/usr/bin/env tsx
/**
 * Diagnóstico read-only — transacções cross-tenant (B2).
 *
 * Contexto: descoberto 11/06 durante o fix W1. Existem transacções cujo
 * `account_id` aponta para uma conta de OUTRO household (tx.household_id ≠
 * account.household_id). RLS protegeu (saldo on-read junta por account_id),
 * mas o dado está sujo. Este script identifica-as com precisão para decidir
 * apagar vs reassociar. NUNCA escreve — só lê.
 *
 * Uso:
 *   pnpm --filter @meu-jarvis/db exec tsx src/scripts/diag-cross-tenant.ts
 *
 * Trace: memory cross-tenant-legacy-transactions; handoff B2.
 */
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { config as loadEnv } from 'dotenv';
import postgres from 'postgres';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const PKG_ROOT = resolve(__dirname, '..', '..');
loadEnv({ path: join(PKG_ROOT, '.env.local') });

async function main(): Promise<number> {
  const url = process.env.DIRECT_URL;
  if (!url) {
    console.error('DIRECT_URL não definido em packages/db/.env.local.');
    return 1;
  }

  const sql = postgres(url, { max: 1, prepare: false });
  try {
    console.log('\n════════ TRANSACÇÕES CROSS-TENANT (tx.household_id ≠ account.household_id) ════════');
    const crossTenant = await sql`
      select
        t.id              as tx_id,
        t.kind,
        t.amount_cents,
        t.description,
        t.transaction_date,
        t.is_projected,
        t.household_id    as tx_household_id,
        t.account_id,
        a.household_id    as account_household_id,
        a.name            as account_name,
        a.archived_at is not null as account_archived
      from public.transactions t
      join public.accounts a on a.id = t.account_id
      where t.account_id is not null
        and t.household_id <> a.household_id
      order by t.transaction_date desc
    `;
    console.log(`\nEncontradas: ${crossTenant.length}`);
    console.table(
      crossTenant.map((r) => ({
        tx_id: String(r.tx_id).slice(0, 8),
        kind: r.kind,
        eur: `€${(Number(r.amount_cents) / 100).toFixed(2).replace('.', ',')}`,
        desc: r.description,
        date: String(r.transaction_date),
        tx_household: String(r.tx_household_id).slice(0, 8),
        acct_household: String(r.account_household_id).slice(0, 8),
        account: r.account_name,
        acct_archived: r.account_archived,
      })),
    );

    console.log('\n── IDs completos (para acção) ──');
    for (const r of crossTenant) {
      console.log(
        `tx=${r.tx_id} | tx_household=${r.tx_household_id} | account_id=${r.account_id} | account_household=${r.account_household_id}`,
      );
    }

    // Para a opção "reassociar": que contas existem no household da transacção?
    const txHouseholds = [...new Set(crossTenant.map((r) => String(r.tx_household_id)))];
    for (const hh of txHouseholds) {
      console.log(`\n── Contas disponíveis no household da tx (${hh}) — alvos p/ reassociar ──`);
      console.table(
        (
          await sql`
            select id, name, account_type, archived_at is not null as archived
            from public.accounts
            where household_id = ${hh}::uuid
            order by created_at
          `
        ).map((a) => ({
          id: String(a.id).slice(0, 8),
          id_full: a.id,
          name: a.name,
          type: a.account_type,
          archived: a.archived,
        })),
      );
    }

    // Identificar os households envolvidos (membros + display_name) para
    // distinguir dados de teste de dados reais antes de decidir.
    const involved = [
      ...new Set([
        ...crossTenant.map((r) => String(r.tx_household_id)),
        ...crossTenant.map((r) => String(r.account_household_id)),
      ]),
    ];
    console.log('\n── Households envolvidos (membros) ──');
    for (const hh of involved) {
      const members = await sql`
        select user_id, role, display_name, joined_at
        from public.household_members
        where household_id = ${hh}::uuid
        order by joined_at
      `;
      const hhRow = await sql`select name, created_at from public.households where id = ${hh}::uuid`;
      console.log(
        `\nhousehold ${hh} | name=${hhRow[0]?.name ?? '?'} | created=${hhRow[0]?.created_at ?? '?'}`,
      );
      console.table(
        members.map((m) => ({
          user_id: String(m.user_id).slice(0, 8),
          role: m.role,
          display_name: m.display_name,
        })),
      );
    }

    console.log('\n════════ FIM ════════\n');
    return 0;
  } catch (err) {
    console.error('Erro:', err);
    return 1;
  } finally {
    await sql.end({ timeout: 5 });
  }
}

main().then((code) => process.exit(code));
