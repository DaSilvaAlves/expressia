/**
 * Testes para a tool `memorizar` — metadata + preview PT-PT + Zod validation
 * + execute (INSERT via ctx, RLS) + reverse_op delete_row.
 *
 * Trace: Story M-1 AC9 (≥5 testes). Padrão de mocking espelhado de
 * `packages/tools/src/tasks/__tests__/criar-tarefa.test.ts` (mock `ctx.db.execute`
 * que captura o SQL/params e devolve a row esperada).
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type {
  DrizzleDbClient,
  ToolExecutionContext,
} from '@/contracts';

import { memorizar } from '../memorizar';

// ─────────────────────────────────────────────────────────────────────────────
// Helpers — mock Drizzle client captura INSERT
// ─────────────────────────────────────────────────────────────────────────────

interface CapturedExecute {
  readonly sqlText: string;
}

interface MockState {
  executes: CapturedExecute[];
  /** Resposta do execute em sequência — array de result rows por chamada. */
  insertReturns: ReadonlyArray<ReadonlyArray<unknown>>;
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

function makeMockDb(state: MockState): DrizzleDbClient {
  let idx = 0;
  const executeImpl = vi.fn(async (query: unknown) => {
    state.executes.push({ sqlText: captureSqlText(query) });
    const row = state.insertReturns[idx] ?? [];
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

const MEMORY_ID = '11111111-2222-4333-8444-555555555555';
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

describe('memorizar — metadata', () => {
  it('tem o nome correcto', () => {
    expect(memorizar.name).toBe('memorizar');
  });

  it('está no domínio memory', () => {
    expect(memorizar.domain).toBe('memory');
  });

  it('tem estimatedTokens = 50 (mesmo perfil de criar_tarefa)', () => {
    expect(memorizar.estimatedTokens).toBe(50);
  });

  it('tem description PT-PT que distingue de criar_tarefa', () => {
    expect(memorizar.description.length).toBeGreaterThan(20);
    expect(memorizar.description.toLowerCase()).toMatch(/lembra-te|memoriza|guarda/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Tests — input schema validation (Zod)
// ─────────────────────────────────────────────────────────────────────────────

describe('memorizar — input validation', () => {
  it('aceita content válido (1-500 chars)', () => {
    expect(
      memorizar.inputSchema.safeParse({ content: 'odeio reuniões antes das 10h' }).success,
    ).toBe(true);
  });

  it('rejeita content vazio', () => {
    expect(memorizar.inputSchema.safeParse({ content: '' }).success).toBe(false);
  });

  it('rejeita content > 500 chars', () => {
    expect(memorizar.inputSchema.safeParse({ content: 'X'.repeat(501) }).success).toBe(false);
  });

  it('aceita content no limite 500 chars', () => {
    expect(memorizar.inputSchema.safeParse({ content: 'X'.repeat(500) }).success).toBe(true);
  });

  it('inputSchema não tem campo household_id (defesa em profundidade)', () => {
    const result = memorizar.inputSchema.safeParse({
      content: 'X',
      household_id: 'fake-uuid-attack',
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data).not.toHaveProperty('household_id');
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Tests — preview PT-PT
// ─────────────────────────────────────────────────────────────────────────────

describe('memorizar — preview PT-PT', () => {
  const ctx = makeCtx(makeMockDb({ executes: [], insertReturns: [] }));

  it('preview cita o conteúdo da memória', () => {
    const out = memorizar.preview({ content: 'odeio reuniões antes das 10h' }, ctx);
    expect(out).toContain('odeio reuniões antes das 10h');
    expect(out).toContain('Vou lembrar-me disso');
  });

  it('preview envolve o conteúdo em aspas', () => {
    const out = memorizar.preview({ content: 'prefiro café sem açúcar' }, ctx);
    expect(out).toBe('Vou lembrar-me disso: "prefiro café sem açúcar"');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Tests — execute (RLS, INSERT, output)
// ─────────────────────────────────────────────────────────────────────────────

describe('memorizar — execute', () => {
  let state: MockState;
  let ctx: ToolExecutionContext;

  beforeEach(() => {
    state = {
      executes: [],
      insertReturns: [[{ id: MEMORY_ID, content: 'odeio reuniões antes das 10h' }]],
    };
    ctx = makeCtx(makeMockDb(state));
  });

  it('INSERT em jarvis_memories usa household_id e created_by_user_id do ctx (não payload)', async () => {
    await memorizar.execute({ content: 'odeio reuniões antes das 10h' }, ctx);
    expect(state.executes.length).toBe(1);
    const sqlText = state.executes[0]?.sqlText ?? '';
    expect(sqlText).toMatch(/insert into jarvis_memories/i);
    expect(sqlText).toMatch(/household_id/i);
    expect(sqlText).toMatch(/created_by_user_id/i);
    expect(sqlText).toMatch(/content/i);
    // `source` não é passado no INSERT — fica no default 'explicit' da coluna.
    expect(sqlText).not.toMatch(/source/i);
  });

  it('output valida e devolve memoryId UUID + content', async () => {
    const out = await memorizar.execute({ content: 'odeio reuniões antes das 10h' }, ctx);
    expect(out.memoryId).toBe(MEMORY_ID);
    expect(out.content).toBe('odeio reuniões antes das 10h');
    expect(memorizar.outputSchema.safeParse(out).success).toBe(true);
  });

  it('lança erro quando INSERT não devolve row (defensivo)', async () => {
    state.insertReturns = [[]]; // empty result
    await expect(memorizar.execute({ content: 'X' }, ctx)).rejects.toThrow(
      /INSERT em jarvis_memories não devolveu row/,
    );
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Tests — reverse() reverse_op delete_row
// ─────────────────────────────────────────────────────────────────────────────

describe('memorizar — reverse()', () => {
  const ctx = makeCtx(makeMockDb({ executes: [], insertReturns: [] }));

  it('reverse() devolve delete_row para jarvis_memories com o memoryId', async () => {
    const reverseOp = await memorizar.reverse(
      { memoryId: MEMORY_ID, content: 'X' },
      ctx,
    );
    expect(reverseOp).toEqual({
      kind: 'delete_row',
      table: 'jarvis_memories',
      id: MEMORY_ID,
    });
  });

  it('reverse() é reversível de verdade (não _noop)', async () => {
    const reverseOp = await memorizar.reverse(
      { memoryId: MEMORY_ID, content: 'X' },
      ctx,
    );
    expect(reverseOp.kind).toBe('delete_row');
    if (reverseOp.kind === 'delete_row') {
      expect(reverseOp.table).toBe('jarvis_memories');
      expect(reverseOp.id).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
      );
    }
  });
});
