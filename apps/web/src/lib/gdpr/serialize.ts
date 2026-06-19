/**
 * Serialização JSON + CSV para o export GDPR (Story 6.8 AC4).
 *
 * Convenções (PO-D2 + PO-D3):
 *   - JSON: array de objectos com nomes de campo snake_case técnicos
 *     (interoperabilidade Art. 20). Datas como ISO-8601.
 *   - CSV: headers em PT-PT (legibilidade humana), separador `;` (ponto-e-vírgula
 *     — obrigatório porque os decimais usam vírgula), encoding UTF-8 BOM.
 *   - Valores monetários: coluna `*_cents` (inteiro, fonte de verdade CON9) E
 *     coluna `*_eur` (decimal PT-PT com vírgula, ex.: `78,70`).
 *
 * Sem dependência externa — serializer simples (array de objectos → CSV).
 *
 * Trace: Story 6.8 AC4; CON3 (PT-PT); CON9 (EUR cêntimos); PO-D2; PO-D3.
 */

/** BOM UTF-8 para compatibilidade Excel PT (`\xEF\xBB\xBF`). */
export const UTF8_BOM = '﻿';

/** Linha de uma entidade — registo chave→valor (valores já normalizados a primitivos). */
export type ExportRow = Record<string, unknown>;

/**
 * Converte cêntimos (inteiro) em string decimal PT-PT com vírgula.
 * Ex.: `7870` → `"78,70"`; `-500` → `"-5,00"`; `null` → `""`.
 */
export function centsToEurPt(cents: number | null | undefined): string {
  if (cents === null || cents === undefined) return '';
  return (cents / 100).toFixed(2).replace('.', ',');
}

/**
 * Normaliza um valor de célula CSV para string segura.
 * Datas → ISO; objectos/arrays → JSON; null/undefined → "".
 */
function cellToString(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (value instanceof Date) return value.toISOString();
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
}

/**
 * Escapa um campo CSV segundo RFC 4180 adaptado ao separador `;`.
 * Campos com `;`, aspas, quebras de linha ou BOM são citados; aspas duplicadas.
 */
function escapeCsvField(raw: string): string {
  if (/[;"\r\n]/.test(raw)) {
    return `"${raw.replace(/"/g, '""')}"`;
  }
  return raw;
}

/**
 * Serializa um array de objectos em CSV PT-PT.
 *
 * @param headers - Pares `{ key, label }`: `key` é a chave técnica em cada row,
 *   `label` é o cabeçalho PT-PT apresentado (PO-D2). A ordem das colunas segue
 *   a ordem do array.
 * @param rows - Os dados (cada objecto é uma linha; chaves em falta → célula vazia).
 * @returns String CSV com BOM UTF-8, separador `;` e terminação `\r\n`.
 */
export function toCsv(
  headers: ReadonlyArray<{ readonly key: string; readonly label: string }>,
  rows: readonly ExportRow[],
): string {
  const sep = ';';
  const headerLine = headers.map((h) => escapeCsvField(h.label)).join(sep);
  const dataLines = rows.map((row) =>
    headers.map((h) => escapeCsvField(cellToString(row[h.key]))).join(sep),
  );
  // BOM + header + linhas. Mesmo sem linhas, devolve o header (CSV válido vazio).
  return UTF8_BOM + [headerLine, ...dataLines].join('\r\n') + '\r\n';
}

/**
 * Serializa um array de objectos em JSON pretty-printed (snake_case preservado).
 * Datas convertidas para ISO-8601 via `JSON.stringify` nativo (Date.toJSON).
 */
export function toJson(rows: readonly ExportRow[]): string {
  return JSON.stringify(rows, null, 2);
}
