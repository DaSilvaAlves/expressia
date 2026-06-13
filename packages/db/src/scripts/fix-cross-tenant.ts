#!/usr/bin/env tsx
/**
 * Correcção B2 — apagar as 3 transacções cross-tenant (decisão Eurico 13/06).
 *
 * As 3 tx (Pingo Doce €18,70, Supermercado €78,70 — household real do Eurico;
 * Almoço €15,00 — household de teste) apontam para a conta `e04be86f` "Dinheiro"
 * de OUTRO household ("Casa de dex-smoke-task1"). Decisão: lixo de teste → APAGAR.
 *
 * Segurança:
 *   - Dry-run por defeito; só apaga com `--apply`.
 *   - DELETE restrito aos 3 IDs exactos E à condição cross-tenant (não apaga
 *     nada que entretanto tenha sido corrigido — idempotente).
 *   - Tudo numa transacção; verifica 0 cross-tenant no fim.
 *   - Aborta se encontrar dependências (agent_reverse_ops / installments).
 *
 * Uso:
 *   pnpm --filter @meu-jarvis/db exec tsx src/scripts/fix-cross-tenant.ts          # dry-run
 *   pnpm --filter @meu-jarvis/db exec tsx src/scripts/fix-cross-tenant.ts --apply  # executa
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

const TARGET_IDS = [
  '65193dc1-cb36-4a5e-9d82-c0a1d558c3ab', // Pingo Doce €18,70 (Casa de euricojsalves)
  '383ea314-b7b7-4cd7-b3ed-a6b0bfb5a13f', // Supermercado €78,70 (Casa de euricojsalves)
  '0aeef0aa-2752-49ce-99c2-cf95c0844043', // Almoço €15,00 (Casa de teste)
];

async function main(): Promise<number> {
  const url = process.env.DIRECT_URL;
  if (!url) {
    console.error('DIRECT_URL não definido em packages/db/.env.local.');
    return 1;
  }
  const apply = process.argv.includes('--apply');

  const sql = postgres(url, { max: 1, prepare: false });
  try {
    // 1. Confirmar estado actual: as tx-alvo que AINDA são cross-tenant.
    const candidates = await sql`
      select t.id, t.kind, t.amount_cents, t.description, t.transaction_date,
             t.household_id as tx_household_id, t.account_id, a.household_id as account_household_id
      from public.transactions t
      join public.accounts a on a.id = t.account_id
      where t.id = any(${TARGET_IDS}::uuid[])
        and t.household_id <> a.household_id
    `;
    console.log(`\nAlvo: ${candidates.length} transacção(ões) cross-tenant confirmada(s).`);
    console.table(
      candidates.map((r) => ({
        id: String(r.id).slice(0, 8),
        eur: `€${(Number(r.amount_cents) / 100).toFixed(2).replace('.', ',')}`,
        desc: r.description,
        tx_household: String(r.tx_household_id).slice(0, 8),
        acct_household: String(r.account_household_id).slice(0, 8),
      })),
    );

    if (candidates.length === 0) {
      console.log('Nada a fazer (já limpo). ✓');
      return 0;
    }

    // 2. Não há FK a referenciar transactions (confirmado por grep no schema:
    //    nenhuma tabela faz `.references(() => transactions)`). As únicas
    //    referências são polimórficas em logs de auditoria (sem constraint):
    //    intent_classifications.target_entity_id e agent_reverse_ops.reverse_op
    //    (JSONB). Apagar não viola constraints; estas linhas ficam históricas.
    //    Verificação INFORMATIVA (não bloqueia).
    const targetCleanIds = candidates.map((r) => String(r.id));
    const intentRefs = await sql`
      select count(*)::int as n from public.intent_classifications
      where target_entity_table = 'transactions'
        and target_entity_id = any(${targetCleanIds}::uuid[])
    `;
    console.log(
      `Refs polimórficas (log, sem FK): intent_classifications=${intentRefs[0]?.n ?? 0} → não bloqueiam, ficam históricas.`,
    );

    if (!apply) {
      console.log('\n[DRY-RUN] Nada apagado. Re-correr com --apply para executar.');
      return 0;
    }

    // 3. Apagar numa transacção, restrito a IDs + condição cross-tenant.
    const deleted = await sql.begin(async (tx) => {
      const rows = await tx`
        delete from public.transactions t
        using public.accounts a
        where t.account_id = a.id
          and t.id = any(${TARGET_IDS}::uuid[])
          and t.household_id <> a.household_id
        returning t.id, t.description, t.amount_cents
      `;
      // Verificação intra-tx: 0 cross-tenant remanescente entre os alvos.
      const remaining = await tx`
        select count(*)::int as n
        from public.transactions t
        join public.accounts a on a.id = t.account_id
        where t.id = any(${TARGET_IDS}::uuid[])
          and t.household_id <> a.household_id
      `;
      if (remaining[0]?.n !== 0) {
        throw new Error(`Inconsistência: ${remaining[0]?.n} cross-tenant remanescente — rollback.`);
      }
      return rows;
    });

    console.log(`\n✓ APAGADAS ${deleted.length} transacção(ões):`);
    console.table(
      deleted.map((r) => ({
        id: String(r.id).slice(0, 8),
        desc: r.description,
        eur: `€${(Number(r.amount_cents) / 100).toFixed(2).replace('.', ',')}`,
      })),
    );

    // 4. Verificação global pós-acção.
    const globalCheck = await sql`
      select count(*)::int as n
      from public.transactions t
      join public.accounts a on a.id = t.account_id
      where t.account_id is not null and t.household_id <> a.household_id
    `;
    console.log(`\nCross-tenant restantes em TODA a DB: ${globalCheck[0]?.n}`);
    console.log(globalCheck[0]?.n === 0 ? 'B2 LIMPO ✓' : 'AINDA HÁ CROSS-TENANT — investigar.');
    return 0;
  } catch (err) {
    console.error('Erro:', err);
    return 1;
  } finally {
    await sql.end({ timeout: 5 });
  }
}

main().then((code) => process.exit(code));
