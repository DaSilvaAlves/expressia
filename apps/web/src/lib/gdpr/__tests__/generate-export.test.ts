import { describe, expect, it } from 'vitest';

/**
 * Testes unitários de serialização do export GDPR (Story 6.8 AC4 / T7.3).
 *
 * Cobre: serialização CSV (headers PT-PT, separador `;`, BOM UTF-8), colunas
 * `*_cents` + `*_eur` nas entidades financeiras, serialização JSON snake_case e
 * geração do README.txt. Não toca DB nem Storage (puro — env `jsdom`/`node`).
 */

import { centsToEurPt, toCsv, toJson, UTF8_BOM } from '@/lib/gdpr/serialize';
import { __testing } from '@/lib/gdpr/generate-export';
import type { ExportRow } from '@/lib/gdpr/serialize';

describe('serialize — centsToEurPt (PO-D3)', () => {
  it('converte cêntimos em decimal PT-PT com vírgula', () => {
    expect(centsToEurPt(7870)).toBe('78,70');
    expect(centsToEurPt(5)).toBe('0,05');
    expect(centsToEurPt(0)).toBe('0,00');
    expect(centsToEurPt(123456)).toBe('1234,56');
  });

  it('devolve string vazia para null/undefined', () => {
    expect(centsToEurPt(null)).toBe('');
    expect(centsToEurPt(undefined)).toBe('');
  });
});

describe('serialize — toCsv (PO-D2 + PO-D3)', () => {
  const headers = [
    { key: 'name', label: 'Nome' },
    { key: 'amount_cents', label: 'Valor (cêntimos)' },
  ] as const;

  it('usa headers PT-PT, separador ; e BOM UTF-8', () => {
    const csv = toCsv(headers, [{ name: 'Renda', amount_cents: 78000 }]);
    expect(csv.startsWith(UTF8_BOM)).toBe(true);
    const withoutBom = csv.slice(UTF8_BOM.length);
    const lines = withoutBom.trimEnd().split('\r\n');
    expect(lines[0]).toBe('Nome;Valor (cêntimos)');
    expect(lines[1]).toBe('Renda;78000');
  });

  it('cita campos que contêm o separador ; ou aspas', () => {
    const csv = toCsv([{ key: 'desc', label: 'Descrição' }], [
      { desc: 'café; pão' },
      { desc: 'aspas "duplas"' },
    ]);
    const lines = csv.slice(UTF8_BOM.length).trimEnd().split('\r\n');
    expect(lines[1]).toBe('"café; pão"');
    expect(lines[2]).toBe('"aspas ""duplas"""');
  });

  it('serializa objectos (jsonb) como JSON na célula', () => {
    const csv = toCsv([{ key: 'state', label: 'Estado' }], [
      { state: { a: 1 } },
    ]);
    const lines = csv.slice(UTF8_BOM.length).trimEnd().split('\r\n');
    // O JSON contém `"` → fica citado, com aspas internas duplicadas (RFC 4180).
    expect(lines[1]).toBe('"{""a"":1}"');
  });

  it('devolve só o header (com BOM) quando não há linhas', () => {
    const csv = toCsv(headers, []);
    expect(csv).toBe(`${UTF8_BOM}Nome;Valor (cêntimos)\r\n`);
  });
});

describe('serialize — toJson preserva snake_case', () => {
  it('serializa array de objectos pretty-printed com chaves técnicas', () => {
    const rows: ExportRow[] = [{ created_by_user_id: 'u1', amount_cents: 100 }];
    const json = toJson(rows);
    expect(json).toContain('"created_by_user_id": "u1"');
    expect(json).toContain('"amount_cents": 100');
  });
});

describe('generate-export — withEurColumns + csvHeadersFor (PO-D3)', () => {
  const transactionsEntity = {
    file: 'transactions',
    label: 'Transações',
    from: '',
    where: 'household' as const,
    columns: [
      { key: 'id', label: 'ID' },
      { key: 'amount_cents', label: 'Valor (cêntimos)' },
    ],
    moneyColumns: ['amount_cents'],
  };

  it('insere a coluna *_eur logo a seguir à coluna *_cents nos headers', () => {
    const headers = __testing.csvHeadersFor(transactionsEntity);
    expect(headers.map((h) => h.key)).toEqual(['id', 'amount_cents', 'amount_eur']);
    expect(headers[2]?.label).toBe('Valor (EUR)');
  });

  it('deriva a coluna *_eur (decimal PT-PT) a partir de *_cents nas rows', () => {
    const rows: ExportRow[] = [{ id: 't1', amount_cents: 7870 }];
    const enriched = __testing.withEurColumns(transactionsEntity, rows);
    expect(enriched[0]?.amount_eur).toBe('78,70');
    // Mantém a coluna original em cêntimos.
    expect(enriched[0]?.amount_cents).toBe(7870);
  });

  it('CSV financeiro completo: cents inteiro + eur com vírgula, separador ;', () => {
    const headers = __testing.csvHeadersFor(transactionsEntity);
    const rows = __testing.withEurColumns(transactionsEntity, [
      { id: 't1', amount_cents: 7870 },
    ]);
    const csv = toCsv(headers, rows);
    const lines = csv.slice(UTF8_BOM.length).trimEnd().split('\r\n');
    expect(lines[0]).toBe('ID;Valor (cêntimos);Valor (EUR)');
    expect(lines[1]).toBe('t1;7870;78,70');
  });

  it('entidade não-financeira não ganha colunas *_eur', () => {
    const tasksEntity = {
      file: 'tasks',
      label: 'Tarefas',
      from: '',
      where: 'household' as const,
      columns: [{ key: 'title', label: 'Título' }],
      moneyColumns: [],
    };
    const headers = __testing.csvHeadersFor(tasksEntity);
    expect(headers.map((h) => h.key)).toEqual(['title']);
  });
});

describe('generate-export — buildReadme (AC4)', () => {
  const generatedAt = new Date('2026-06-18T14:30:00Z');
  const data = new Map<string, ExportRow[]>([
    ['tasks', [{ id: 't1' }, { id: 't2' }]],
    ['transactions', [{ id: 'tx1' }]],
  ]);

  it('inclui data, household, nota de cêntimos/decimal e separador ;', () => {
    const readme = __testing.buildReadme('hh-1', generatedAt, data);
    expect(readme).toContain('Conta (household) exportada: hh-1');
    expect(readme).toContain('Artigo 20.º');
    expect(readme).toContain('CÊNTIMOS');
    expect(readme).toContain('separador decimal');
    expect(readme).toContain('ponto-e-vírgula');
    expect(readme).toContain('UTF-8');
    // Nota sobre billing/dados não incluídos.
    expect(readme).toContain('faturação');
  });

  it('é 100% PT-PT (sem termos PT-BR óbvios)', () => {
    const readme = __testing.buildReadme('hh-1', generatedAt, data);
    expect(readme).not.toMatch(/\bvocê\b/i);
    expect(readme).not.toMatch(/\bdeletar\b/i);
  });
});

describe('generate-export — buildExportFiles (AC4)', () => {
  it('gera 1 JSON + 1 CSV por entidade + 1 README.txt', async () => {
    const { EXPORT_ENTITIES } = await import('@/lib/gdpr/entities');
    const data = new Map<string, ExportRow[]>();
    const files = __testing.buildExportFiles('hh-1', new Date(), data);
    const names = files.map((f) => f.name);
    expect(names).toContain('tasks.json');
    expect(names).toContain('tasks.csv');
    expect(names).toContain('README.txt');
    // 2 ficheiros por entidade + README.
    expect(files.length).toBe(EXPORT_ENTITIES.length * 2 + 1);
  });
});

describe('generate-export — buildZip (AC4)', () => {
  it('produz um Buffer ZIP não-vazio com a assinatura PK', async () => {
    const zip = await __testing.buildZip([
      { name: 'a.txt', content: 'olá' },
      { name: 'b.csv', content: 'x;y\r\n1;2\r\n' },
    ]);
    expect(Buffer.isBuffer(zip)).toBe(true);
    expect(zip.length).toBeGreaterThan(0);
    // Assinatura local file header de um ZIP: 0x50 0x4B ("PK").
    expect(zip[0]).toBe(0x50);
    expect(zip[1]).toBe(0x4b);
  });
});
