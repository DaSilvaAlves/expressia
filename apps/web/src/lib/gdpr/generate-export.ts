/**
 * Geração do ZIP de export GDPR (Story 6.8 AC3/AC4/AC5) — construção nova.
 *
 * Fluxo (geração síncrona inline — PO-D1):
 *   1. Recolhe os dados de domínio household-scoped via `withHousehold` (RLS
 *      2.ª rede + filtro `household_id` app-enforced 1.ª rede SEC-1) para cada
 *      entidade em `EXPORT_ENTITIES` (AC3).
 *   2. Serializa cada entidade em JSON (snake_case) e CSV (headers PT-PT,
 *      separador `;`, BOM UTF-8, coluna `*_eur` nas financeiras) — AC4.
 *   3. Gera README.txt em PT-PT (AC4).
 *   4. Cria o ZIP em memória com `archiver` (AC4).
 *   5. Faz upload para Supabase Storage e devolve o signed URL 24h (AC5).
 *
 * O cliente que chama (`route.ts`) é responsável por marcar o job `ready`/`failed`
 * via `getServiceDb()` com verificação de pertença (AC8).
 *
 * Trace: Story 6.8 AC3/AC4/AC5; CON3 (PT-PT); CON9 (cêntimos); PO-D2; PO-D3.
 */
import archiver from 'archiver';
import { sql } from 'drizzle-orm';

import { withHousehold } from '@/lib/agent/db-shim';

import {
  EXPORT_ENTITIES,
  type ExportColumn,
  type ExportEntity,
} from '@/lib/gdpr/entities';
import { centsToEurPt, toCsv, toJson, type ExportRow } from '@/lib/gdpr/serialize';
import { uploadExportZip } from '@/lib/gdpr/storage';

/** Resultado da geração — usado pelo route handler para actualizar o job. */
export interface GenerateExportResult {
  readonly storagePath: string;
  readonly downloadUrl: string;
  readonly expiresAt: Date;
  /** Nome do ZIP (`{household_id}-export-{YYYYMMDD}.zip`) — para logging. */
  readonly zipFileName: string;
}

/** Contexto de autenticação necessário para a geração. */
export interface ExportAuth {
  readonly userId: string;
  readonly householdId: string;
}

/** `YYYYMMDD` em hora local (Europe/Lisbon implícito no servidor fra1). */
function yyyymmdd(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}${m}${d}`;
}

/** Data/hora legível PT-PT para o README (`DD/MM/YYYY HH:MM`). */
function formatPtDateTime(date: Date): string {
  const d = String(date.getDate()).padStart(2, '0');
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const y = date.getFullYear();
  const hh = String(date.getHours()).padStart(2, '0');
  const mm = String(date.getMinutes()).padStart(2, '0');
  return `${d}/${m}/${y} ${hh}:${mm}`;
}

/**
 * Constrói os headers CSV de uma entidade, inserindo a coluna companheira
 * `*_eur` (decimal PT-PT) imediatamente a seguir a cada coluna `*_cents` (PO-D3).
 */
function csvHeadersFor(entity: ExportEntity): ReadonlyArray<ExportColumn> {
  const out: ExportColumn[] = [];
  for (const col of entity.columns) {
    out.push(col);
    if (entity.moneyColumns.includes(col.key)) {
      const eurKey = col.key.replace(/_cents$/, '_eur');
      out.push({ key: eurKey, label: col.label.replace('(cêntimos)', '(EUR)') });
    }
  }
  return out;
}

/**
 * Enriquece cada row com as colunas `*_eur` derivadas das `*_cents` (PO-D3).
 * Não-destrutivo (mantém as `*_cents` originais).
 */
function withEurColumns(entity: ExportEntity, rows: readonly ExportRow[]): ExportRow[] {
  if (entity.moneyColumns.length === 0) return [...rows];
  return rows.map((row) => {
    const enriched: ExportRow = { ...row };
    for (const centsKey of entity.moneyColumns) {
      const eurKey = centsKey.replace(/_cents$/, '_eur');
      const raw = row[centsKey];
      enriched[eurKey] = typeof raw === 'number' ? centsToEurPt(raw) : '';
    }
    return enriched;
  });
}

/**
 * Constrói o WHERE parametrizado para a entidade, escolhendo a coluna de scoping
 * conforme `entity.where` (1.ª rede app-enforced SEC-1):
 *   - `user`        → `user_id = $uid` (só a row do utilizador autenticado).
 *   - `self_by_id`  → `id = $hid` (tabela `households`: a PK é `id`, não tem
 *                     `household_id` — REL-001 / QA fix 6.8).
 *   - `household`   → `household_id = $hid` (restantes tabelas de domínio).
 */
function buildQuery(
  entity: ExportEntity,
  auth: ExportAuth,
): ReturnType<typeof sql> {
  const base = sql.raw(entity.from);
  switch (entity.where) {
    case 'user':
      return sql`${base} where user_id = ${auth.userId}::uuid`;
    case 'self_by_id':
      return sql`${base} where id = ${auth.householdId}::uuid`;
    case 'household':
      return sql`${base} where household_id = ${auth.householdId}::uuid`;
  }
}

/**
 * Recolhe os dados de todas as entidades (AC3) dentro de UMA transação
 * `withHousehold` (RLS-enforced). Devolve um mapa entidade→rows.
 */
async function collectEntityData(
  auth: ExportAuth,
): Promise<Map<string, ExportRow[]>> {
  return withHousehold(auth, async (tx) => {
    const result = new Map<string, ExportRow[]>();
    for (const entity of EXPORT_ENTITIES) {
      const rows = await tx.execute<ExportRow>(buildQuery(entity, auth));
      result.set(entity.file, Array.isArray(rows) ? rows : [...rows]);
    }
    return result;
  });
}

/** Gera o conteúdo do README.txt em PT-PT (AC4). */
function buildReadme(
  householdId: string,
  generatedAt: Date,
  data: Map<string, ExportRow[]>,
): string {
  const lines: string[] = [];
  lines.push('EXPORTAÇÃO DE DADOS — EXPRESSIA');
  lines.push('================================');
  lines.push('');
  lines.push(`Data da exportação: ${formatPtDateTime(generatedAt)}`);
  lines.push(`Família (household) exportada: ${householdId}`);
  lines.push('');
  lines.push('Este ficheiro ZIP contém todos os dados pessoais e da tua família');
  lines.push('geridos pela Expressia, ao abrigo do direito de portabilidade de dados');
  lines.push('previsto no RGPD (Artigo 20.º).');
  lines.push('');
  lines.push('FICHEIROS INCLUÍDOS');
  lines.push('-------------------');
  lines.push('Cada entidade é exportada em dois formatos:');
  lines.push('  - .json : formato técnico (nomes de campo em inglês), para');
  lines.push('            interoperabilidade e reimportação noutros sistemas.');
  lines.push('  - .csv  : formato tabular legível, cabeçalhos em português.');
  lines.push('');
  for (const entity of EXPORT_ENTITIES) {
    const count = data.get(entity.file)?.length ?? 0;
    lines.push(`  - ${entity.file}.json / ${entity.file}.csv — ${entity.label} (${count} registo(s))`);
  }
  lines.push('');
  lines.push('VALORES MONETÁRIOS');
  lines.push('------------------');
  lines.push('Os valores monetários são guardados em CÊNTIMOS de euro (coluna');
  lines.push('terminada em "(cêntimos)" / "_cents") — esta é a fonte de verdade,');
  lines.push('sem erros de arredondamento. Para tua conveniência, os ficheiros CSV');
  lines.push('das entidades financeiras incluem também uma coluna em euros (coluna');
  lines.push('terminada em "(EUR)" / "_eur"), no formato português com a vírgula');
  lines.push('como separador decimal (por exemplo: 78,70 €).');
  lines.push('');
  lines.push('SEPARADOR DOS FICHEIROS CSV');
  lines.push('---------------------------');
  lines.push('Os ficheiros CSV usam ponto-e-vírgula ( ; ) como separador de colunas,');
  lines.push('porque os valores decimais usam a vírgula. Ao abrir no Excel ou noutra');
  lines.push('folha de cálculo em português, as colunas são reconhecidas');
  lines.push('automaticamente. A codificação é UTF-8 (com BOM) para acentos correctos.');
  lines.push('');
  lines.push('DADOS NÃO INCLUÍDOS');
  lines.push('-------------------');
  lines.push('Por opção ou por não serem dados de domínio da tua conta, NÃO estão');
  lines.push('incluídos nesta exportação:');
  lines.push('  - Dados de faturação e subscrição (planos, faturas, métodos de');
  lines.push('    pagamento) — geridos separadamente.');
  lines.push('  - Categorias predefinidas globais da aplicação (apenas as tuas');
  lines.push('    categorias próprias são exportadas).');
  lines.push('  - Registos técnicos externos (monitorização/observabilidade), que');
  lines.push('    não contêm dados pessoais directos.');
  lines.push('  - Os campos de endereço IP e identificação do navegador no registo');
  lines.push('    de auditoria, omitidos por privacidade.');
  lines.push('');
  lines.push('Para mais informação sobre os teus direitos, consulta a página de');
  lines.push('Privacidade da Expressia.');
  lines.push('');
  return lines.join('\n');
}

/**
 * Empacota os ficheiros num ZIP em memória usando `archiver`.
 * Resolve com o `Buffer` completo do ZIP.
 */
function buildZip(files: ReadonlyArray<{ name: string; content: string }>): Promise<Buffer> {
  return new Promise<Buffer>((resolve, reject) => {
    const archive = archiver('zip', { zlib: { level: 9 } });
    const chunks: Buffer[] = [];

    archive.on('data', (chunk: Buffer) => chunks.push(chunk));
    archive.on('warning', (err) => {
      // Warnings não-fatais (ex.: ficheiro vazio) — não rejeitar.
      if ((err as { code?: string }).code !== 'ENOENT') reject(err);
    });
    archive.on('error', (err) => reject(err));
    archive.on('end', () => resolve(Buffer.concat(chunks)));

    for (const file of files) {
      archive.append(file.content, { name: file.name });
    }
    void archive.finalize();
  });
}

/**
 * Constrói os ficheiros (JSON + CSV por entidade + README.txt) a partir dos
 * dados recolhidos — extraído para teste isolado da serialização.
 */
function buildExportFiles(
  householdId: string,
  generatedAt: Date,
  data: Map<string, ExportRow[]>,
): Array<{ name: string; content: string }> {
  const files: Array<{ name: string; content: string }> = [];
  for (const entity of EXPORT_ENTITIES) {
    const rows = data.get(entity.file) ?? [];
    // JSON — snake_case técnico (sem colunas *_eur derivadas).
    files.push({ name: `${entity.file}.json`, content: toJson(rows) });
    // CSV — headers PT-PT + coluna *_eur nas financeiras.
    const csvRows = withEurColumns(entity, rows);
    files.push({ name: `${entity.file}.csv`, content: toCsv(csvHeadersFor(entity), csvRows) });
  }
  files.push({ name: 'README.txt', content: buildReadme(householdId, generatedAt, data) });
  return files;
}

/**
 * Gera o export completo e faz upload para Storage. Devolve o signed URL.
 *
 * O `jobId` define o path determinístico no Storage
 * (`exports/{household_id}/{job_id}.zip` — AC5). Lança em caso de falha
 * (recolha de dados, ZIP ou upload) — o chamador deve marcar o job `failed`
 * via `getServiceDb()`.
 */
export async function generateExportForJob(
  auth: ExportAuth,
  jobId: string,
): Promise<GenerateExportResult> {
  const generatedAt = new Date();
  const data = await collectEntityData(auth);
  const files = buildExportFiles(auth.householdId, generatedAt, data);

  const zip = await buildZip(files);
  const zipFileName = `${auth.householdId}-export-${yyyymmdd(generatedAt)}.zip`;

  const { storagePath, signedUrl, expiresAt } = await uploadExportZip(
    auth.householdId,
    jobId,
    zip,
  );

  return { storagePath, downloadUrl: signedUrl, expiresAt, zipFileName };
}

// Exports para testes unitários (serialização isolada + invariante de scoping).
export const __testing = {
  csvHeadersFor,
  withEurColumns,
  buildReadme,
  buildExportFiles,
  buildZip,
  buildQuery,
  yyyymmdd,
  formatPtDateTime,
};
