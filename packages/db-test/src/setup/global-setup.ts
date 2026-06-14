/**
 * Vitest globalSetup — sobe um único container Postgres 16 para toda a suite RLS.
 *
 * Justificação (Story 1.4 AC7):
 *   - Subir um container por ficheiro de teste resultaria em ~22 × 5s = 110s de overhead.
 *   - Container partilhado mantém a suite < 60s em máquina CI (target: < 30s típico).
 *
 * O container, depois de criado:
 *   1. Aplica `0000_initial_schema.sql` + `0001_rls_policies.sql` da migration de produção.
 *   2. Aplica bootstrap SQL específico do harness (cria role `authenticated` e funções
 *      `auth.uid()` / `auth.jwt()` que existem em Supabase mas não em Postgres vanilla).
 *
 * A connection string e o handle do container são partilhados com os testes via env vars.
 *
 * Trace: Architecture §10.1, §10.2 (RLS testing strategy), Story 1.4 AC1, AC5, AC7.
 */
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';

import { applyMigrations } from '@/harness/migrations';
import { applyBootstrap } from '@/harness/bootstrap';

let container: StartedPostgreSqlContainer | null = null;

/**
 * Vitest invoca esta função UMA VEZ antes de qualquer ficheiro de teste correr.
 * Devolve uma teardown function chamada após todos os testes terminarem.
 */
export default async function globalSetup(): Promise<() => Promise<void>> {
  console.log('[db-test/setup] A iniciar Postgres 16 efémero (Testcontainers)…');
  const start = Date.now();

  // Imagem `pgvector/pgvector:pg16` é Postgres 16 oficial + extensão pgvector pré-instalada.
  // Necessária porque a migration de produção (`0000_initial_schema.sql`) corre
  // `create extension if not exists "vector"` (architecture §11.2 prepara Fase 3 RAG).
  // A imagem standard `postgres:16` falha com `extension "vector" is not available`.
  container = await new PostgreSqlContainer('pgvector/pgvector:pg16')
    .withDatabase('rls_test')
    .withUsername('postgres')
    .withPassword('postgres')
    // Performance: desactiva fsync e durabilidade (container efémero, OK perder dados em crash).
    .withCommand([
      'postgres',
      '-c',
      'fsync=off',
      '-c',
      'synchronous_commit=off',
      '-c',
      'full_page_writes=off',
    ])
    .start();

  const url = container.getConnectionUri();
  process.env.RLS_TEST_DATABASE_URL = url;

  console.log(`[db-test/setup] Postgres pronto em ${Date.now() - start}ms — ${container.getHost()}:${container.getPort()}`);

  // 1. Bootstrap: cria role `authenticated`, schema `auth`, funções `auth.uid()` / `auth.jwt()`.
  //    Estas existem em Supabase mas NÃO em Postgres 16 vanilla. Tem de correr ANTES das migrations
  //    de produção, porque `0001_rls_policies.sql` referencia `auth.uid()` nas policies.
  console.log('[db-test/setup] A aplicar bootstrap (role authenticated + auth.* helpers)…');
  await applyBootstrap(url);

  // 2. Migrations de produção: todas as 0000..NNNN da pasta migrations, aplicadas por glob.
  console.log('[db-test/setup] A aplicar todas as migrations de produção (0000..NNNN, dir glob)…');
  await applyMigrations(url);

  console.log(`[db-test/setup] Schema pronto em ${Date.now() - start}ms total.`);

  return async () => {
    if (container) {
      console.log('[db-test/setup] A parar container Postgres…');
      await container.stop();
      container = null;
    }
  };
}
