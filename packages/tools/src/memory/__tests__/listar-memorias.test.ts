/**
 * Testes para a tool `listar_memorias` (Story M-6 AC7) — metadata + preview
 * estático + Zod validation + execute (SELECT RLS-scoped, cap, shape
 * `{memories,count}`) + reverse() sentinela `_noop`.
 *
 * Padrão de mocking espelhado de `memorizar.test.ts` (mock `ctx.db.execute` que
 * captura o SQL e devolve as rows esperadas).
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type {
  DrizzleDbClient,
  ToolExecutionContext,
} from '@/contracts';

import { listarMemorias } from '../listar-memorias';

// ─────────────────────────────────────────────────────────────────────────────
// Helpers — mock Drizzle client captura SELECT + params
// ─────────────────────────────────────────────────────────────────────────────

interface CapturedExecute {
  readonly sqlText: string;
  /** Params (values) do template sql — para asserir o `limit` passado. */
  readonly params: readonly unknown[];
}

interface MockState {
  executes: CapturedExecute[];
  /** Resposta do execute em sequência — array de result rows por chamada. */
  selectReturns: ReadonlyArray<ReadonlyArray<unknown>>;
}

function captureSqlText(query: unknown): string {
  let sqlText = '';
  const q = query as { queryChunks?: unknown[] };
  if (Array.isArray(q.queryChunks)) {
    for (const chunk of q.queryChunks) {
      if (typeof chunk === 'string') {
        sqlText += chunk;
      } else if (chunk && typeof chunk === 'object') {
        const value = (chunk as { value?: unknown }).value;
        if (typeof value === 'string') sqlText += value;
        else if (Array.isArray(value)) {
          for (const v of value) if (typeof v === 'string') sqlText += v;
        }
      }
    }
  }
  return sqlText;
}

function captureParams(query: unknown): readonly unknown[] {
  // Numa `sql` template do drizzle, um número interpolado (`${limit}`) fica como
  // um chunk PRIMITIVO `number` no array `queryChunks` (não embrulhado). O único
  // param numérico desta query é o `limit`.
  const q = query as { queryChunks?: unknown[] };
  const params: number[] = [];
  if (Array.isArray(q.queryChunks)) {
    for (const chunk of q.queryChunks) {
      if (typeof chunk === 'number') params.push(chunk);
    }
  }
  return params;
}

function makeMockDb(state: MockState): DrizzleDbClient {
  let idx = 0;
  const executeImpl = vi.fn(async (query: unknown) => {
    state.executes.push({
      sqlText: captureSqlText(query),
      params: captureParams(query),
    });
    const row = state.selectReturns[idx] ?? [];
    idx += 1;
    return row;
  });

  return {
    transaction: vi.fn(async <T,>(fn: (tx: DrizzleDbClient) => Promise<T>) =>
      fn(makeMockDb(state)),
    ) as unknown as DrizzleDbClient['transaction'],
    insert: vi.fn(),
    execute: executeImpl as unknown as DrizzleDbClient['execute'],
  };
}

const HOUSEHOLD_ID = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';
const USER_ID = '99999999-aaaa-4bbb-8ccc-dddddddddddd';
const RUN_ID = '88888888-7777-4666-8555-444444444444';

function makeCtx(db: DrizzleDbClient): ToolExecutionContext {
  return {
    householdId: HOUSEHOLD_ID,
    userId: USER_ID,
    db,
    traceId: 'trace_test',
    runId: RUN_ID,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Tests — metadata
// ─────────────────────────────────────────────────────────────────────────────

describe('listar_memorias — metadata', () => {
  it('tem o nome correcto', () => {
    expect(listarMemorias.name).toBe('listar_memorias');
  });

  it('está no domínio memory (4.ª tool do domínio)', () => {
    expect(listarMemorias.domain).toBe('memory');
  });

  it('tem estimatedTokens = 100 (perfil de listar_tarefas)', () => {
    expect(listarMemorias.estimatedTokens).toBe(100);
  });

  it('tem description PT-PT com os gatilhos de recall', () => {
    expect(listarMemorias.description.toLowerCase()).toMatch(/o que sabes sobre mim/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Tests — preview estático
// ─────────────────────────────────────────────────────────────────────────────

describe('listar_memorias — preview', () => {
  const ctx = makeCtx(makeMockDb({ executes: [], selectReturns: [] }));

  it('preview() devolve o label estático PT-PT', () => {
    expect(listarMemorias.preview({}, ctx)).toBe('Listar memórias guardadas');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Tests — input schema validation (Zod)
// ─────────────────────────────────────────────────────────────────────────────

describe('listar_memorias — input validation', () => {
  it('aceita input vazio (limit opcional)', () => {
    expect(listarMemorias.inputSchema.safeParse({}).success).toBe(true);
  });

  it('aceita limit no intervalo [1, 50]', () => {
    expect(listarMemorias.inputSchema.safeParse({ limit: 1 }).success).toBe(true);
    expect(listarMemorias.inputSchema.safeParse({ limit: 50 }).success).toBe(true);
  });

  it('rejeita limit fora de [1, 50]', () => {
    expect(listarMemorias.inputSchema.safeParse({ limit: 0 }).success).toBe(false);
    expect(listarMemorias.inputSchema.safeParse({ limit: 51 }).success).toBe(false);
  });

  it('MVP list-all-capped — NÃO expõe campo de pesquisa (query/topic descartados)', () => {
    const result = listarMemorias.inputSchema.safeParse({ query: 'café', topic: 'preferências' });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data).not.toHaveProperty('query');
      expect(result.data).not.toHaveProperty('topic');
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Tests — execute (RLS-scoped SELECT, cap, output shape)
// ─────────────────────────────────────────────────────────────────────────────

describe('listar_memorias — execute', () => {
  let state: MockState;
  let ctx: ToolExecutionContext;

  beforeEach(() => {
    state = { executes: [], selectReturns: [[]] };
    ctx = makeCtx(makeMockDb(state));
  });

  it('SELECT RLS-scoped: public.jarvis_memories + household_id + order by created_at desc', async () => {
    await listarMemorias.execute({}, ctx);
    const sqlText = state.executes[0]?.sqlText ?? '';
    expect(sqlText).toMatch(/select\s+content,\s*created_at/i);
    expect(sqlText).toMatch(/from\s+public\.jarvis_memories/i);
    expect(sqlText).toMatch(/household_id/i);
    expect(sqlText).toMatch(/order by created_at desc/i);
  });

  it('0 rows → { memories: [], count: 0 }', async () => {
    state.selectReturns = [[]];
    const out = await listarMemorias.execute({}, ctx);
    expect(out).toEqual({ memories: [], count: 0 });
    expect(listarMemorias.outputSchema.safeParse(out).success).toBe(true);
  });

  it('N rows → mapeamento correcto content/createdAt + count', async () => {
    state.selectReturns = [
      [
        { content: 'odeio reuniões antes das 10h', created_at: '2026-07-07T09:00:00.000Z' },
        { content: 'prefiro café sem açúcar', created_at: '2026-07-06T09:00:00.000Z' },
      ],
    ];
    const out = await listarMemorias.execute({}, ctx);
    expect(out.count).toBe(2);
    expect(out.memories).toEqual([
      { content: 'odeio reuniões antes das 10h', createdAt: '2026-07-07T09:00:00.000Z' },
      { content: 'prefiro café sem açúcar', createdAt: '2026-07-06T09:00:00.000Z' },
    ]);
    expect(listarMemorias.outputSchema.safeParse(out).success).toBe(true);
  });

  it('respeita input.limit (SQL param usa o valor passado)', async () => {
    await listarMemorias.execute({ limit: 5 }, ctx);
    expect(state.executes[0]?.params).toContain(5);
    expect(state.executes[0]?.params).not.toContain(50);
  });

  it('sem input.limit usa default 50 (SQL param usa 50)', async () => {
    await listarMemorias.execute({}, ctx);
    expect(state.executes[0]?.params).toContain(50);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Tests — reverse() sentinela _noop (leitura pura, sem undo)
// ─────────────────────────────────────────────────────────────────────────────

describe('listar_memorias — reverse()', () => {
  const ctx = makeCtx(makeMockDb({ executes: [], selectReturns: [] }));

  it('reverse() devolve sentinela inerte { delete_row, _noop, <uuid> }', async () => {
    const reverseOp = await listarMemorias.reverse({ memories: [], count: 0 }, ctx);
    expect(reverseOp.kind).toBe('delete_row');
    if (reverseOp.kind === 'delete_row') {
      expect(reverseOp.table).toBe('_noop');
      expect(reverseOp.id).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
      );
    }
  });
});
