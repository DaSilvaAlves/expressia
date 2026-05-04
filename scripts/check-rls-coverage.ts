#!/usr/bin/env tsx
/**
 * RLS Coverage Gate — bloqueia merges sem policies em tabelas multi-tenant.
 *
 * NFR5 (PRD): "RLS Postgres activa em TODAS as tabelas com `household_id`;
 * teste automatizado bloqueia merge se nova tabela com `household_id` for
 * criada sem policy RLS."
 *
 * Algoritmo:
 * 1. Lê todos os ficheiros .ts em packages/db/src/schema/.
 * 2. Detecta tabelas que declaram coluna `household_id` (uuid('household_id')).
 * 3. Lê packages/db/migrations/0001_rls_policies.sql.
 * 4. Para cada tabela detectada, verifica que existem policies para os 4
 *    comandos: SELECT, INSERT, UPDATE, DELETE (ou ALL).
 * 5. Sai com exit code 1 se faltar coverage.
 *
 * Uso:
 *   tsx scripts/check-rls-coverage.ts
 *   npm run check:rls          (depois de configurar package.json root)
 *
 * CI:
 *   GitHub Actions corre este script antes de merge para main.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const REPO_ROOT = resolve(__dirname, '..');

const SCHEMA_DIR = join(REPO_ROOT, 'packages', 'db', 'src', 'schema');
const RLS_MIGRATION = join(REPO_ROOT, 'packages', 'db', 'migrations', '0001_rls_policies.sql');

const REQUIRED_COMMANDS = ['select', 'insert', 'update', 'delete'] as const;
type Command = (typeof REQUIRED_COMMANDS)[number];

interface TableInfo {
  schemaFile: string;
  tableName: string;
}

interface PolicyInfo {
  tableName: string;
  command: Command | 'all';
}

/**
 * Detecta declarações `pgTable('xxx', { ... })` que contêm coluna household_id.
 * Heurística simples baseada em regex porque ts-morph é overkill para isto.
 */
function findMultiTenantTables(): TableInfo[] {
  const tables: TableInfo[] = [];
  const files = readdirSync(SCHEMA_DIR).filter((f) => f.endsWith('.ts') && f !== 'index.ts');

  for (const file of files) {
    const filePath = join(SCHEMA_DIR, file);
    const content = readFileSync(filePath, 'utf8');

    // Match: `export const xxx = pgTable('table_name', { ... }, ...)`.
    // Captura nome da tabela e o conteúdo do bloco até ao primeiro `)` balanceado.
    const tableRegex = /pgTable\s*\(\s*['"]([a-z_]+)['"]/g;
    let match: RegExpExecArray | null;

    while ((match = tableRegex.exec(content)) !== null) {
      const tableName = match[1];
      // Procura `household_id` num raio de 2000 chars após o match — basta para
      // qualquer tabela razoável.
      const lookAhead = content.slice(match.index, match.index + 2000);
      if (/household_id/i.test(lookAhead) || /householdId/.test(lookAhead)) {
        tables.push({ schemaFile: file, tableName });
      }
    }
  }

  return tables;
}

/**
 * Extrai todas as policies do ficheiro RLS migration.
 * Procura por `create policy "..." on public.<table> for <command>`.
 */
function findExistingPolicies(): PolicyInfo[] {
  const policies: PolicyInfo[] = [];
  const sql = readFileSync(RLS_MIGRATION, 'utf8').toLowerCase();

  // Match: `create policy "..." on [public.]<table> for <command>`
  // command pode ser select|insert|update|delete|all
  const policyRegex =
    /create\s+policy\s+["'][^"']+["']\s+on\s+(?:public\.)?([a-z_]+)\s+for\s+(select|insert|update|delete|all)/g;

  let match: RegExpExecArray | null;
  while ((match = policyRegex.exec(sql)) !== null) {
    policies.push({
      tableName: match[1],
      command: match[2] as Command | 'all',
    });
  }

  return policies;
}

/**
 * Verifica se uma tabela tem coverage completa.
 * "all" cobre os 4 comandos.
 */
function hasFullCoverage(tableName: string, policies: PolicyInfo[]): {
  full: boolean;
  missing: Command[];
} {
  const tablePolicies = policies.filter((p) => p.tableName === tableName);

  if (tablePolicies.some((p) => p.command === 'all')) {
    return { full: true, missing: [] };
  }

  const covered = new Set(tablePolicies.map((p) => p.command));
  const missing = REQUIRED_COMMANDS.filter((cmd) => !covered.has(cmd));
  return { full: missing.length === 0, missing };
}

function main(): number {
  console.log('🔒 RLS Coverage Gate — verificando tabelas multi-tenant...\n');

  const tables = findMultiTenantTables();
  if (tables.length === 0) {
    console.warn('⚠️  Nenhuma tabela com household_id detectada.');
    console.warn('   Esperado: pelo menos `households` ou similares em packages/db/src/schema/.');
    return 1;
  }

  const policies = findExistingPolicies();
  console.log(`Tabelas com household_id encontradas: ${tables.length}`);
  console.log(`Policies existentes em 0001_rls_policies.sql: ${policies.length}\n`);

  const failures: { table: TableInfo; missing: Command[] }[] = [];

  for (const table of tables) {
    const { full, missing } = hasFullCoverage(table.tableName, policies);
    if (!full) {
      failures.push({ table, missing });
    }
  }

  if (failures.length === 0) {
    console.log('✅ Todas as tabelas multi-tenant têm coverage completa (SELECT/INSERT/UPDATE/DELETE).\n');
    console.log('Tabelas verificadas:');
    for (const t of tables) {
      console.log(`  ✓ ${t.tableName.padEnd(30)} (${t.schemaFile})`);
    }
    return 0;
  }

  console.error('❌ RLS coverage incompleto — merge bloqueado.\n');
  console.error('Tabelas com policies em falta:');
  for (const { table, missing } of failures) {
    console.error(`  ✗ ${table.tableName.padEnd(30)} (${table.schemaFile})`);
    console.error(`      Em falta: ${missing.join(', ').toUpperCase()}`);
  }
  console.error('\nAdicione as policies em packages/db/migrations/0001_rls_policies.sql.');
  console.error('Padrão obrigatório: 4 policies por tabela (SELECT/INSERT/UPDATE/DELETE).\n');
  console.error('Trace: NFR5 do PRD (bloqueante).\n');
  return 1;
}

process.exit(main());
