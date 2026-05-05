#!/usr/bin/env tsx
/**
 * Seed runner — meu-jarvis (Expressia)
 *
 * Aplica os ficheiros SQL em `packages/db/migrations/seeds/*.sql` em ordem
 * lexicográfica. Cada ficheiro deve ser idempotente (`ON CONFLICT DO NOTHING`).
 *
 * Uso:
 *   pnpm db:seed                  (lê DIRECT_URL de .env.local)
 *   DIRECT_URL=… tsx apply-seeds.ts
 *
 * Trace: Story 1.3 AC6.
 */
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { config as loadEnv } from 'dotenv';
import postgres from 'postgres';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const PKG_ROOT = resolve(__dirname, '..', '..');
const SEEDS_DIR = join(PKG_ROOT, 'migrations', 'seeds');

loadEnv({ path: join(PKG_ROOT, '.env.local') });

async function main(): Promise<number> {
  const url = process.env.DIRECT_URL ?? process.env.DATABASE_URL_DIRECT;

  if (!url) {
    console.error('[db:seed] ERRO: DIRECT_URL não definido.');
    return 1;
  }

  if (!existsSync(SEEDS_DIR)) {
    console.warn(`[db:seed] Pasta ${SEEDS_DIR} não existe — nada a fazer.`);
    return 0;
  }

  const files = readdirSync(SEEDS_DIR)
    .filter((f) => f.endsWith('.sql'))
    .sort();

  if (files.length === 0) {
    console.warn('[db:seed] Nenhum seed encontrado em migrations/seeds/.');
    return 0;
  }

  const sql = postgres(url, {
    max: 1,
    prepare: false,
    onnotice: () => {},
  });

  console.log(`[db:seed] ${files.length} seed(s) a aplicar:`);
  for (const f of files) console.log(`  - ${f}`);
  console.log('');

  try {
    for (const file of files) {
      const sqlText = readFileSync(join(SEEDS_DIR, file), 'utf8');
      const start = Date.now();
      console.log(`[apply] ${file} …`);
      await sql.unsafe(sqlText);
      const ms = Date.now() - start;
      console.log(`[done]  ${file} em ${ms}ms`);
    }
    console.log('\n✅ Seeds aplicados com sucesso.');
    return 0;
  } catch (err) {
    console.error('\n❌ Seed falhou:', err);
    return 1;
  } finally {
    await sql.end();
  }
}

main()
  .then((code) => process.exit(code))
  .catch((err) => {
    console.error('[db:seed] Erro inesperado:', err);
    process.exit(1);
  });
