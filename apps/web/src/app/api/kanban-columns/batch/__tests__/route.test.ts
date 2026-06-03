// @vitest-environment node
/**
 * Teste de isolamento cross-tenant — PATCH /api/kanban-columns/batch (SEC-1-F4).
 *
 * Defesa-em-profundidade: as mutações por `id` da transacção batch
 * (UPDATE/DELETE de kanban_columns e UPDATE de tasks) passaram a incluir
 * `and household_id = ${auth.householdId}` inline. `validateInput` já garante
 * a pertença antes, mas a RLS está inerte em runtime — o filtro inline torna
 * cada mutação segura por construção.
 *
 * Assert: a DELETE de uma coluna e o move de tasks carregam o `household_id`
 * autenticado como parâmetro bound na query SQL.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  requireAuthMock: vi.fn(),
  dbExecuteMock: vi.fn(),
  insertAuditLogMock: vi.fn(),
}));

vi.mock('@meu-jarvis/observability', () => ({
  annotateSpan: vi.fn(),
  captureException: vi.fn(),
  childLogger: () => ({ info: vi.fn(), warn: vi.fn(), error: vi.fn() }),
  withSpan: (_n: string, _a: unknown, fn: (span: unknown) => unknown) =>
    fn({ setAttribute: vi.fn() }),
}));

vi.mock('@/lib/agent/db-shim', () => ({
  getDb: () => ({ execute: mocks.dbExecuteMock }),
  // SEC-5: o batch envolve todas as queries de domínio em `withHousehold`. O mock
  // injecta o mesmo `execute` (mockImplementation por SQL text mantém-se válido).
  withHousehold: (
    _auth: { userId: string; householdId: string },
    fn: (tx: { execute: typeof mocks.dbExecuteMock }) => unknown,
  ) => fn({ execute: mocks.dbExecuteMock }),
}));

vi.mock('@/lib/api-helpers/auth', () => ({
  requireAuth: mocks.requireAuthMock,
}));

vi.mock('@/lib/api-helpers/audit', () => ({
  insertAuditLog: mocks.insertAuditLogMock,
}));

import { NextRequest } from 'next/server';

const { PATCH } = await import('@/app/api/kanban-columns/batch/route');

const USER_UUID = '00000000-0000-0000-0000-0000000000a1';
const HOUSEHOLD_A = '00000000-0000-0000-0000-00000000000a';
const COL_DEL = '00000000-0000-0000-0000-0000000000d1';
const COL_MOVE = '00000000-0000-0000-0000-0000000000d2';
const COL_K1 = '00000000-0000-0000-0000-0000000000c1';
const COL_K2 = '00000000-0000-0000-0000-0000000000c2';
const COL_K3 = '00000000-0000-0000-0000-0000000000c3';

/** SQL text de um objecto SQL Drizzle (concatena os StringChunk). */
function sqlText(sqlObj: unknown): string {
  let text = '';
  const walk = (chunks: unknown): void => {
    if (!Array.isArray(chunks)) return;
    for (const chunk of chunks) {
      if (chunk != null && typeof chunk === 'object') {
        const obj = chunk as Record<string, unknown>;
        if (Array.isArray(obj.value)) text += (obj.value as string[]).join('');
        if ('queryChunks' in obj) walk(obj.queryChunks);
      }
    }
  };
  if (sqlObj != null && typeof sqlObj === 'object' && 'queryChunks' in (sqlObj as object)) {
    walk((sqlObj as { queryChunks: unknown }).queryChunks);
  }
  return text;
}

function boundParamValues(sqlObj: unknown): unknown[] {
  const out: unknown[] = [];
  const walk = (chunks: unknown): void => {
    if (!Array.isArray(chunks)) return;
    for (const chunk of chunks) {
      if (chunk != null && typeof chunk === 'object') {
        const obj = chunk as Record<string, unknown>;
        if ('queryChunks' in obj) walk(obj.queryChunks);
      } else {
        out.push(chunk);
      }
    }
  };
  if (sqlObj != null && typeof sqlObj === 'object' && 'queryChunks' in (sqlObj as object)) {
    walk((sqlObj as { queryChunks: unknown }).queryChunks);
  }
  return out;
}

function patchReq(body: unknown) {
  return new NextRequest(
    new Request('http://localhost/api/kanban-columns/batch', {
      method: 'PATCH',
      body: JSON.stringify(body),
      headers: { 'content-type': 'application/json' },
    }),
  );
}

describe('PATCH /api/kanban-columns/batch — isolamento cross-tenant inline (SEC-1-F4)', () => {
  beforeEach(() => {
    mocks.requireAuthMock.mockReset();
    mocks.dbExecuteMock.mockReset();
    mocks.insertAuditLogMock.mockReset();
    mocks.requireAuthMock.mockResolvedValue({ userId: USER_UUID, householdId: HOUSEHOLD_A });
    mocks.insertAuditLogMock.mockResolvedValue(undefined);
  });

  it('a DELETE de coluna e o move de tasks carregam household_id como parâmetro bound', async () => {
    // 3 colunas finais (MIN_COLUMNS) + 1 delete com move_to.
    const cols = [
      { id: COL_K1, sort_order: 0 },
      { id: COL_K2, sort_order: 1 },
      { id: COL_K3, sort_order: 2 },
    ];
    const body = {
      columns: cols,
      deletes: [{ id: COL_DEL, move_to: COL_MOVE }],
    };

    // Sequência de db.execute:
    //  1) validateInput queries → devolvem [] (sem violações)
    //  ... a implementação faz vários SELECT de validação; devolvemos vazio
    //      e snapshot beforeRows com as 3 colunas + final select.
    // Estratégia: default [] e injectar o snapshot/final por SQL inspeccionado.
    // Colunas existentes do household: as 3 finais + a coluna a apagar + o destino.
    const existing = [
      { id: COL_K1, name: 'Col 0', sort_order: 0, is_done: 'false' },
      { id: COL_K2, name: 'Col 1', sort_order: 1, is_done: 'false' },
      { id: COL_K3, name: 'Col 2', sort_order: 2, is_done: 'true' },
      { id: COL_DEL, name: 'Apagar', sort_order: 3, is_done: 'false' },
      { id: COL_MOVE, name: 'Destino', sort_order: 4, is_done: 'false' },
    ];
    mocks.dbExecuteMock.mockImplementation(async (sqlObj: unknown) => {
      const text = sqlText(sqlObj).toLowerCase();
      // validateInput / snapshot / validateInvariants / final select:
      // devolver as colunas do household (todas têm household_id válido).
      if (text.includes('select') && text.includes('from public.kanban_columns')) {
        // validateInvariants pós-batch precisa de 3-6 colunas com 1 done.
        if (text.includes('is_done_column')) {
          return cols.map((c, i) => ({
            id: c.id,
            name: `Col ${i}`,
            is_done_column: i === 2 ? 'true' : 'false',
          }));
        }
        return existing.map((e) => ({
          id: e.id,
          household_id: HOUSEHOLD_A,
          name: e.name,
          sort_order: e.sort_order,
          color: '#6B7280',
          is_done_column: e.is_done,
        }));
      }
      return [];
    });

    const res = await PATCH(patchReq(body));

    // Não nos importa o status final (pode 200/422 conforme invariants do mock);
    // o que importa é que TODA mutação por id filtrou household_id inline.
    const mutations = mocks.dbExecuteMock.mock.calls
      .map((c) => c[0])
      .filter((s) => {
        const t = sqlText(s).toLowerCase();
        return (
          (t.includes('delete from public.kanban_columns') ||
            t.includes('update public.kanban_columns set sort_order = -100') ||
            t.includes('update public.tasks')) &&
          t.includes('where')
        );
      });

    // Pelo menos a DELETE da coluna + o UPDATE tasks (move_to) devem existir.
    expect(mutations.length).toBeGreaterThanOrEqual(2);
    for (const m of mutations) {
      expect(sqlText(m).toLowerCase()).toContain('household_id');
      expect(boundParamValues(m)).toContain(HOUSEHOLD_A);
    }

    void res;
  });
});
