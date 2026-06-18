import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from 'vitest';

import { EXPORT_ENTITIES, type ExportEntity } from '@/lib/gdpr/entities';
import { __testing } from '@/lib/gdpr/generate-export';

/**
 * Teste de invariante schema↔export (Story 6.8 — QA fix TEST-001).
 *
 * Objectivo: garantir que cada `EXPORT_ENTITY` só referencia colunas que EXISTEM
 * mesmo na tabela correspondente do schema Drizzle real (`packages/db/src/schema/*.ts`),
 * incluindo a COLUNA DE SCOPING que o `buildQuery` injecta no WHERE.
 *
 * Porquê (REL-001): a entidade `households` usava `where: 'household'`, mas a tabela
 * `public.households` não tem coluna `household_id` (a PK é `id`). O `buildQuery`
 * gerava `... where household_id = $hid` → Postgres 42703 em runtime, partindo o
 * export inteiro. Nem o typecheck (SQL é `sql.raw`) nem os testes de serialização
 * (Map mockado) o apanhavam. Este teste TERIA falhado com o bug presente: detecta a
 * coluna de scoping inexistente sem precisar de DB.
 *
 * Estratégia: parse do SOURCE dos schemas (não import de runtime Drizzle), extraindo
 * os nomes de coluna SQL de cada `pgTable('<tabela>', { ... })`. Determinístico,
 * sem DB, sem dependência de subpath exports.
 */

const require_ = createRequire(import.meta.url);
// `@meu-jarvis/db/schema` → `<pkg>/src/schema/index.ts` (subpath export). A pasta
// dos schemas é o directório que o contém.
const schemaDir = path.dirname(require_.resolve('@meu-jarvis/db/schema'));

/**
 * Extrai, de um source de schema, o mapa `tabela SQL` → conjunto de colunas SQL.
 * Detecta `pgTable('nome', { ... })` e, dentro do bloco, as chamadas de coluna
 * `<helper>('coluna_sql', ...)` (uuid/text/timestamp/integer/boolean/jsonb/pgEnum…).
 */
function parseSchemaColumns(source: string): Map<string, Set<string>> {
  const tables = new Map<string, Set<string>>();
  // `export const x = pgTable(\n  'tabela',\n  { ... },` — capturamos o nome SQL.
  const tableRe = /pgTable\(\s*['"]([a-z_]+)['"]/g;
  let m: RegExpExecArray | null;
  while ((m = tableRe.exec(source)) !== null) {
    const tableName = m[1]!;
    // Janela a partir do início do pgTable até ao próximo `pgTable(` (ou fim).
    const start = m.index;
    tableRe.lastIndex = start + 'pgTable('.length;
    const nextIdx = source.indexOf('pgTable(', start + 'pgTable('.length);
    const end = nextIdx === -1 ? source.length : nextIdx;
    const block = source.slice(start, end);
    const cols = new Set<string>();
    // Colunas: `nomeHelper('coluna_sql'` — o 1.º arg textual de cada coluna é o
    // nome SQL. Os helpers de coluna usados nos schemas do projecto:
    const colRe =
      /\b(?:uuid|text|timestamp|integer|boolean|jsonb|numeric|date|time)\(\s*['"]([a-z_0-9]+)['"]/g;
    let c: RegExpExecArray | null;
    while ((c = colRe.exec(block)) !== null) {
      cols.add(c[1]!);
    }
    // Colunas baseadas em enum: `<enumVar>('coluna_sql')` — ex.: planTierEnum('plan'),
    // householdRoleEnum('role'), auditActionEnum('action'), dataExportStatusEnum('status').
    const enumColRe = /\b[a-zA-Z]+Enum\(\s*['"]([a-z_0-9]+)['"]/g;
    let e: RegExpExecArray | null;
    while ((e = enumColRe.exec(block)) !== null) {
      cols.add(e[1]!);
    }
    tables.set(tableName, cols);
  }
  return tables;
}

/** Lê e funde os mapas de colunas de todos os ficheiros de schema. */
function loadAllSchemaColumns(): Map<string, Set<string>> {
  const files = [
    'auth.ts',
    'tenancy.ts',
    'billing.ts',
    'agent.ts',
    'tasks.ts',
    'finance.ts',
    'audit.ts',
    'prefs.ts',
  ];
  const all = new Map<string, Set<string>>();
  for (const f of files) {
    const source = readFileSync(path.join(schemaDir, f), 'utf8');
    for (const [table, cols] of parseSchemaColumns(source)) {
      all.set(table, cols);
    }
  }
  return all;
}

/** Nome da tabela SQL referida pelo fragmento `from ... from public.<tabela>`. */
function tableNameFromEntity(entity: ExportEntity): string {
  const match = /from\s+public\.([a-z_]+)/i.exec(entity.from);
  if (!match) throw new Error(`Entidade ${entity.file}: não consegui extrair a tabela do FROM`);
  return match[1]!;
}

/** Colunas referidas no SELECT da entidade (entre `select` e `from`). */
function selectColumnsFromEntity(entity: ExportEntity): string[] {
  const match = /select\s+(.+?)\s+from\s+/is.exec(entity.from);
  if (!match) throw new Error(`Entidade ${entity.file}: não consegui extrair o SELECT`);
  return match[1]!
    .split(',')
    .map((c) => c.trim().replace(/^"|"$/g, '')) // remove aspas de identificadores (ex.: "interval")
    .filter((c) => c.length > 0);
}

/** Coluna que o `buildQuery` usa no WHERE, conforme o modo de scoping. */
function scopingColumnFor(entity: ExportEntity): string {
  switch (entity.where) {
    case 'user':
      return 'user_id';
    case 'self_by_id':
      return 'id';
    case 'household':
      return 'household_id';
  }
}

describe('export GDPR — invariante schema↔entidades (TEST-001 / REL-001)', () => {
  const schemaColumns = loadAllSchemaColumns();

  it('parse de schema encontra as tabelas-chave com as suas colunas', () => {
    // Sanity check do parser — se falhar, o teste de invariante seria um falso verde.
    expect(schemaColumns.get('households')?.has('id')).toBe(true);
    expect(schemaColumns.get('households')?.has('household_id')).toBe(false);
    expect(schemaColumns.get('tasks')?.has('household_id')).toBe(true);
    expect(schemaColumns.get('user_prefs')?.has('user_id')).toBe(true);
  });

  it.each(EXPORT_ENTITIES.map((e) => [e.file, e] as const))(
    'entidade "%s": coluna de scoping existe no schema real',
    (_file, entity) => {
      const table = tableNameFromEntity(entity);
      const cols = schemaColumns.get(table);
      expect(cols, `tabela "${table}" não encontrada no schema`).toBeDefined();
      const scopeCol = scopingColumnFor(entity);
      // ESTA assertion teria FALHADO com o bug REL-001:
      // households + where:'household' → scopeCol 'household_id' ∉ colunas de households.
      expect(
        cols!.has(scopeCol),
        `Entidade "${entity.file}" (tabela ${table}, where='${entity.where}') ` +
          `referencia a coluna de scoping "${scopeCol}" que NÃO existe no schema. ` +
          `Colunas reais: ${[...cols!].sort().join(', ')}`,
      ).toBe(true);
    },
  );

  it.each(EXPORT_ENTITIES.map((e) => [e.file, e] as const))(
    'entidade "%s": todas as colunas do SELECT existem no schema real',
    (_file, entity) => {
      const table = tableNameFromEntity(entity);
      const cols = schemaColumns.get(table)!;
      for (const selectCol of selectColumnsFromEntity(entity)) {
        expect(
          cols.has(selectCol),
          `Entidade "${entity.file}" (tabela ${table}): coluna SELECT "${selectCol}" ` +
            `não existe no schema. Colunas reais: ${[...cols].sort().join(', ')}`,
        ).toBe(true);
      }
    },
  );

  it('buildQuery gera o WHERE com a coluna de scoping correcta por modo', () => {
    const auth = {
      userId: '11111111-1111-1111-1111-111111111111',
      householdId: '22222222-2222-2222-2222-222222222222',
    };

    // Concatena só as partes TEXTUAIS dos chunks do template `sql` (os parâmetros
    // `::uuid` são chunks de parâmetro, irrelevantes para o nome da coluna do WHERE).
    const whereText = (entity: ExportEntity): string => {
      const chunks = (__testing.buildQuery(entity, auth) as { queryChunks: unknown[] })
        .queryChunks;
      return chunks
        .flatMap((c) => {
          if (typeof c === 'string') return [c];
          if (c && typeof c === 'object' && 'value' in c) {
            const v = (c as { value: unknown }).value;
            return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [];
          }
          return [];
        })
        .join('');
    };

    const households = EXPORT_ENTITIES.find((e) => e.file === 'households')!;
    const userPrefs = EXPORT_ENTITIES.find((e) => e.file === 'user_prefs')!;
    const tasks = EXPORT_ENTITIES.find((e) => e.file === 'tasks')!;

    // `households` → `where id = $hid` (NÃO household_id) — o cerne do fix REL-001.
    const hhSql = whereText(households);
    expect(hhSql).toContain('where id =');
    expect(hhSql).not.toContain('where household_id =');

    expect(whereText(userPrefs)).toContain('where user_id =');
    expect(whereText(tasks)).toContain('where household_id =');
  });
});
