/**
 * Migration runner para o harness de testes RLS.
 *
 * Reusa a mesma estratégia do `packages/db/src/scripts/apply-migrations.ts`:
 *   - Lê SQLs em ordem lexicográfica de `packages/db/migrations/*.sql`.
 *   - Aplica cada ficheiro numa transação com `set local check_function_bodies = off`.
 *
 * Diferença chave: NÃO mantém tabela `__schema_migrations` (cada container é descartável).
 *
 * Trace: Story 1.4 Task 2.2, Architecture §11.2 (migration strategy).
 */
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import postgres from 'postgres';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// packages/db-test/src/harness/migrations.ts → packages/db/migrations/
const MIGRATIONS_DIR = resolve(__dirname, '..', '..', '..', 'db', 'migrations');

interface MigrationFile {
  readonly name: string;
  readonly path: string;
  readonly sql: string;
}

function listMigrations(): MigrationFile[] {
  return readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith('.sql'))
    .filter((f) => !f.startsWith('_'))
    .sort()
    .map((name) => {
      const path = join(MIGRATIONS_DIR, name);
      return {
        name,
        path,
        sql: readFileSync(path, 'utf8'),
      };
    });
}

/**
 * Aplica todas as migrations de produção contra a connection URL fornecida.
 *
 * Cada ficheiro SQL é aplicado dentro de uma transação. Falha de qualquer ficheiro
 * causa rollback completo desse ficheiro e propagação da excepção.
 *
 * @param url Connection URL postgres-style (postgres://...).
 */
export async function applyMigrations(url: string): Promise<void> {
  const sql = postgres(url, {
    max: 1,
    prepare: false,
    onnotice: () => {
      // Suprimir NOTICEs ruidosos (ex: "extension already exists").
    },
  });

  const migrations = listMigrations();

  if (migrations.length === 0) {
    throw new Error(
      `[db-test/migrations] Nenhum ficheiro .sql em ${MIGRATIONS_DIR}. Verifica o path.`,
    );
  }

  try {
    for (const file of migrations) {
      await sql.begin(async (tx) => {
        // check_function_bodies=off permite criar funções language sql que referenciam
        // tabelas criadas mais à frente no mesmo ficheiro (forward references).
        await tx.unsafe('set local check_function_bodies = off;');
        await tx.unsafe(file.sql);
      });
    }
  } finally {
    await sql.end();
  }
}
