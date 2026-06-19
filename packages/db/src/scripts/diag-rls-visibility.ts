#!/usr/bin/env tsx
/**
 * Diagnóstico READ-ONLY (ACHADO-2 — teste de visibilidade decisivo).
 *
 * FORCE RLS + rolbypassrls=true criam um conflito de precedência. Este teste
 * mede empiricamente o que GANHA: o role postgres VÊ todas as linhas (bypass)
 * ou as policies aplicam-se mesmo ao owner (FORCE)?
 *
 * Comparamos:
 *   - count(*) total via informação de catálogo independente de RLS (estimativa)
 *   - count(*) que a connection runtime (postgres) realmente VÊ via SELECT normal
 * Se a connection vê linhas com current_household_id() = NULL, RLS está inerte.
 *
 * NÃO altera schema nem dados. Só SELECT.
 *
 * Uso: pnpm --filter @meu-jarvis/db exec tsx src/scripts/diag-rls-visibility.ts
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
  const runtime = process.env.DATABASE_URL;
  if (!runtime) {
    console.error('DATABASE_URL não definido.');
    return 1;
  }
  const sql = postgres(runtime, { prepare: false, max: 1 });
  try {
    console.log('=== Teste de visibilidade: role postgres + FORCE RLS, sem claims ===\n');

    // Identidade
    const who = await sql<{ current_user: string; rolbypassrls: boolean }[]>`
      select current_user, (select rolbypassrls from pg_roles where rolname = current_user) as rolbypassrls
    `;
    console.log('Identidade:', who[0]);

    // Para cada tabela com dados, quantas linhas a connection runtime VÊ?
    // households não tem household_id mas é a raiz — testamos algumas tabelas-chave.
    const tables = ['households', 'household_members', 'tasks', 'transactions', 'accounts', 'categories'];
    console.log('\nLinhas VISÍVEIS via SELECT normal (sujeito a RLS se aplicada):');
    for (const t of tables) {
      try {
        const c = await sql.unsafe(`select count(*)::int as n from public.${t}`);
        console.log(`  ${t.padEnd(20)} → ${c[0]?.n}`);
      } catch (err) {
        console.log(`  ${t.padEnd(20)} → ERRO: ${err instanceof Error ? err.message : err}`);
      }
    }

    // Decisivo: contagem real ignorando RLS via função SECURITY DEFINER ad-hoc?
    // Não criamos objetos. Em vez disso usamos pg_class.reltuples (estimativa do planner)
    // que NÃO passa por RLS — dá-nos o "ground truth" aproximado para comparar.
    console.log('\nEstimativa de linhas TOTAIS (pg_class.reltuples, ignora RLS):');
    const est = await sql<{ relname: string; reltuples: number }[]>`
      select c.relname, c.reltuples::int
      from pg_class c join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public' and c.relname = any(${tables})
      order by c.relname
    `;
    console.table(est);

    console.log(
      '\nInterpretação:\n' +
        '  - Se "visíveis" ≈ "estimativa total" e current_household_id()=NULL → RLS INERTE (bypass ganha).\n' +
        '  - Se "visíveis" = 0 (ou erro) apesar de existirem linhas → RLS APLICADA mesmo ao owner (FORCE ganha).',
    );

    return 0;
  } catch (err) {
    console.error('Erro:', err);
    return 1;
  } finally {
    await sql.end();
  }
}

main().then((c) => process.exit(c));
