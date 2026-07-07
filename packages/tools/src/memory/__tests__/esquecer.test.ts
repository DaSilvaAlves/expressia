/**
 * Testes para a tool `esquecer` — metadata + preview PT-PT + Zod validation
 * + execute (SELECT+snapshot+DELETE via ctx, household-scoped, RLS) + zero-match
 * + reverse_op reinsert_row (snake_case) + a garantia de que `execute` NUNCA usa
 * `input.content` para decidir o que apagar (só `memoryId`+household).
 *
 * Trace: Story M-4 AC12 (≥6 testes). Padrão de mocking espelhado de
 * `packages/tools/src/memory/__tests__/memorizar.test.ts`.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type {
  DrizzleDbClient,
  ToolExecutionContext,
} from '@/contracts';
import { ToolExecutionError } from '@/errors';

import { esquecer } from '../esquecer';

// ─────────────────────────────────────────────────────────────────────────────
// Helpers — mock Drizzle client captura SELECT + DELETE
// ─────────────────────────────────────────────────────────────────────────────

interface CapturedExecute {
  readonly sqlText: string;
}

interface MockState {
  executes: CapturedExecute[];
  /** Resposta do execute em sequência — array de result rows por chamada. */
  returns: ReadonlyArray<ReadonlyArray<unknown>>;
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
    const row = state.returns[idx] ?? [];
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
const CREATED_AT = '2026-07-01T09:30:00.000Z';

/** Row completa que o SELECT devolve (snake_case). */
const RESOLVED_ROW = {
  id: MEMORY_ID,
  household_id: HOUSEHOLD_ID,
  created_by_user_id: USER_ID,
  content: 'odeio reuniões antes das 10h',
  source: 'explicit',
  created_at: CREATED_AT,
};

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

describe('esquecer — metadata', () => {
  it('tem o nome correcto', () => {
    expect(esquecer.name).toBe('esquecer');
  });

  it('está no domínio memory (2.ª tool do domínio, ao lado de memorizar)', () => {
    expect(esquecer.domain).toBe('memory');
  });

  it('tem estimatedTokens = 90 (mesmo perfil de eliminar_tarefa)', () => {
    expect(esquecer.estimatedTokens).toBe(90);
  });

  it('tem description PT-PT que refere apagar/esquecer memória', () => {
    expect(esquecer.description.length).toBeGreaterThan(20);
    expect(esquecer.description.toLowerCase()).toMatch(/esquec|apag/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Tests — input schema validation (Zod)
// ─────────────────────────────────────────────────────────────────────────────

describe('esquecer — input validation', () => {
  it('aceita memoryId UUID + content válido', () => {
    expect(
      esquecer.inputSchema.safeParse({ memoryId: MEMORY_ID, content: 'odeio reuniões' })
        .success,
    ).toBe(true);
  });

  it('rejeita memoryId não-UUID', () => {
    expect(
      esquecer.inputSchema.safeParse({ memoryId: 'nao-uuid', content: 'X' }).success,
    ).toBe(false);
  });

  it('rejeita content vazio', () => {
    expect(
      esquecer.inputSchema.safeParse({ memoryId: MEMORY_ID, content: '' }).success,
    ).toBe(false);
  });

  it('rejeita content > 500 chars', () => {
    expect(
      esquecer.inputSchema.safeParse({ memoryId: MEMORY_ID, content: 'X'.repeat(501) })
        .success,
    ).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Tests — preview PT-PT
// ─────────────────────────────────────────────────────────────────────────────

describe('esquecer — preview PT-PT', () => {
  const ctx = makeCtx(makeMockDb({ executes: [], returns: [] }));

  it('preview cita o conteúdo da memória e pede confirmação', () => {
    const out = esquecer.preview(
      { memoryId: MEMORY_ID, content: 'odeio reuniões antes das 10h' },
      ctx,
    );
    expect(out).toBe('Vou esquecer: "odeio reuniões antes das 10h". Confirmas?');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Tests — execute (SELECT household-scoped, snapshot, DELETE, output)
// ─────────────────────────────────────────────────────────────────────────────

describe('esquecer — execute', () => {
  let state: MockState;
  let ctx: ToolExecutionContext;

  beforeEach(() => {
    state = {
      executes: [],
      // 1ª chamada: SELECT devolve a row; 2ª chamada: DELETE (sem rows).
      returns: [[RESOLVED_ROW], []],
    };
    ctx = makeCtx(makeMockDb(state));
  });

  it('SELECT filtra por id E household_id (RLS 1.ª + 2.ª rede)', async () => {
    await esquecer.execute({ memoryId: MEMORY_ID, content: 'odeio reuniões antes das 10h' }, ctx);
    const selectSql = state.executes[0]?.sqlText ?? '';
    expect(selectSql).toMatch(/select/i);
    expect(selectSql).toMatch(/from jarvis_memories/i);
    expect(selectSql).toMatch(/household_id/i);
  });

  it('faz DELETE em jarvis_memories após capturar snapshot', async () => {
    await esquecer.execute({ memoryId: MEMORY_ID, content: 'odeio reuniões antes das 10h' }, ctx);
    expect(state.executes.length).toBe(2);
    const deleteSql = state.executes[1]?.sqlText ?? '';
    expect(deleteSql).toMatch(/delete from jarvis_memories/i);
  });

  it('output devolve o content REAL da row resolvida + snapshot snake_case', async () => {
    const out = await esquecer.execute(
      // `content` do input DIFERE do content real da row — o output usa o real.
      { memoryId: MEMORY_ID, content: 'texto do input diferente' },
      ctx,
    );
    expect(out.memoryId).toBe(MEMORY_ID);
    expect(out.content).toBe('odeio reuniões antes das 10h');
    expect(esquecer.outputSchema.safeParse(out).success).toBe(true);
    // Snapshot em snake_case (PO-SHOULD-FIX-1) — as keys viram colunas literais.
    expect(out.snapshot).toEqual({
      household_id: HOUSEHOLD_ID,
      created_by_user_id: USER_ID,
      content: 'odeio reuniões antes das 10h',
      source: 'explicit',
      created_at: CREATED_AT,
    });
    // NUNCA camelCase.
    expect(out.snapshot).not.toHaveProperty('householdId');
    expect(out.snapshot).not.toHaveProperty('createdByUserId');
    expect(out.snapshot).not.toHaveProperty('createdAt');
  });

  it('execute nunca usa input.content para decidir o que apagar (só memoryId+household)', async () => {
    await esquecer.execute({ memoryId: MEMORY_ID, content: 'lixo alucinado' }, ctx);
    const selectSql = state.executes[0]?.sqlText ?? '';
    const deleteSql = state.executes[1]?.sqlText ?? '';
    // Nem o SELECT nem o DELETE filtram por `content`.
    expect(selectSql).not.toMatch(/content\s*=/i);
    expect(deleteSql).not.toMatch(/content/i);
  });

  it('zero-match (SELECT sem row) lança ToolExecutionError PT-PT (mensagem na cause) sem DELETE', async () => {
    const zeroState: MockState = { executes: [], returns: [[]] };
    const zeroCtx = makeCtx(makeMockDb(zeroState));
    let caught: unknown;
    try {
      await esquecer.execute({ memoryId: MEMORY_ID, content: 'X' }, zeroCtx);
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(ToolExecutionError);
    // A mensagem PT-PT vive na `cause` (o `message` do wrapper é técnico).
    const cause = (caught as ToolExecutionError).cause;
    expect(cause).toBeInstanceOf(Error);
    expect((cause as Error).message).toMatch(/pode j[áa] ter sido apagada/i);
    // Só correu o SELECT — nunca o DELETE.
    expect(zeroState.executes.length).toBe(1);
    expect(zeroState.executes[0]?.sqlText ?? '').toMatch(/select/i);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Tests — reverse() reverse_op reinsert_row (reversível de verdade, FIX-1)
// ─────────────────────────────────────────────────────────────────────────────

describe('esquecer — reverse()', () => {
  const ctx = makeCtx(makeMockDb({ executes: [], returns: [] }));

  it('reverse() devolve reinsert_row para jarvis_memories com id + snapshot', async () => {
    const snapshot = {
      household_id: HOUSEHOLD_ID,
      created_by_user_id: USER_ID,
      content: 'odeio reuniões antes das 10h',
      source: 'explicit',
      created_at: CREATED_AT,
    };
    const reverseOp = await esquecer.reverse(
      { memoryId: MEMORY_ID, content: 'odeio reuniões antes das 10h', snapshot },
      ctx,
    );
    expect(reverseOp).toEqual({
      kind: 'reinsert_row',
      table: 'jarvis_memories',
      id: MEMORY_ID,
      snapshot,
    });
  });

  it('reverse() é reversível de verdade (reinsert_row, não _noop nem delete_row)', async () => {
    const reverseOp = await esquecer.reverse(
      { memoryId: MEMORY_ID, content: 'X', snapshot: {} },
      ctx,
    );
    expect(reverseOp.kind).toBe('reinsert_row');
  });
});
