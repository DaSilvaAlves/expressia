/**
 * Testes para a tool `sugerir_memoria` — metadata + preview PT-PT (PERGUNTA)
 * + Zod validation + execute (INSERT com source='inferred' LITERAL, RLS) +
 * reverse_op delete_row.
 *
 * Trace: Story M-5 AC7 (≥6 testes). Padrão de mocking espelhado de
 * `packages/tools/src/memory/__tests__/memorizar.test.ts` (mock `ctx.db.execute`
 * que captura o SQL/params e devolve a row esperada).
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type {
  DrizzleDbClient,
  ToolExecutionContext,
} from '@/contracts';

import { sugerirMemoria } from '../sugerir-memoria';

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

describe('sugerir_memoria — metadata', () => {
  it('tem o nome correcto', () => {
    expect(sugerirMemoria.name).toBe('sugerir_memoria');
  });

  it('está no domínio memory (3.ª tool do domínio, sem domínio novo)', () => {
    expect(sugerirMemoria.domain).toBe('memory');
  });

  it('tem estimatedTokens = 50 (mesmo perfil de memorizar)', () => {
    expect(sugerirMemoria.estimatedTokens).toBe(50);
  });

  it('tem description PT-PT que distingue de memorizar (inferida, não explícita)', () => {
    expect(sugerirMemoria.description.length).toBeGreaterThan(20);
    expect(sugerirMemoria.description.toLowerCase()).toMatch(/notaste|passagem|prop/i);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Tests — input schema validation (Zod)
// ─────────────────────────────────────────────────────────────────────────────

describe('sugerir_memoria — input validation', () => {
  it('aceita content válido (1-500 chars)', () => {
    expect(
      sugerirMemoria.inputSchema.safeParse({ content: 'odeio reuniões antes das 10h' }).success,
    ).toBe(true);
  });

  it('rejeita content vazio', () => {
    expect(sugerirMemoria.inputSchema.safeParse({ content: '' }).success).toBe(false);
  });

  it('rejeita content > 500 chars', () => {
    expect(sugerirMemoria.inputSchema.safeParse({ content: 'X'.repeat(501) }).success).toBe(false);
  });

  it('aceita content no limite 500 chars', () => {
    expect(sugerirMemoria.inputSchema.safeParse({ content: 'X'.repeat(500) }).success).toBe(true);
  });

  it('inputSchema não tem campo source (proveniência é literal no SQL, nunca do input)', () => {
    const result = sugerirMemoria.inputSchema.safeParse({
      content: 'X',
      source: 'explicit', // tentativa de forçar source via input
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data).not.toHaveProperty('source');
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Tests — preview PT-PT (PERGUNTA, não afirmação)
// ─────────────────────────────────────────────────────────────────────────────

describe('sugerir_memoria — preview PT-PT (pergunta de consentimento)', () => {
  const ctx = makeCtx(makeMockDb({ executes: [], insertReturns: [] }));

  it('preview cita o conteúdo da memória em forma de PERGUNTA', () => {
    const out = sugerirMemoria.preview({ content: 'odeio reuniões antes das 10h' }, ctx);
    expect(out).toContain('odeio reuniões antes das 10h');
    expect(out).toContain('Reparei nisto');
    expect(out).toContain('?'); // é uma pergunta, não uma afirmação
  });

  it('preview é EXACTAMENTE a pergunta de consentimento (não afirmação como memorizar)', () => {
    const out = sugerirMemoria.preview({ content: 'prefiro café sem açúcar' }, ctx);
    expect(out).toBe(
      'Reparei nisto: "prefiro café sem açúcar". Queres que eu guarde isto como memória?',
    );
    // NÃO usa a copy declarativa de `memorizar` ("Vou lembrar-me disso").
    expect(out).not.toContain('Vou lembrar-me');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Tests — execute (RLS, INSERT, source='inferred' literal, output)
// ─────────────────────────────────────────────────────────────────────────────

describe('sugerir_memoria — execute', () => {
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
    await sugerirMemoria.execute({ content: 'odeio reuniões antes das 10h' }, ctx);
    expect(state.executes.length).toBe(1);
    const sqlText = state.executes[0]?.sqlText ?? '';
    expect(sqlText).toMatch(/insert into jarvis_memories/i);
    expect(sqlText).toMatch(/household_id/i);
    expect(sqlText).toMatch(/created_by_user_id/i);
    expect(sqlText).toMatch(/content/i);
  });

  it("grava source='inferred' como LITERAL no SQL (nunca vindo do input/LLM)", async () => {
    await sugerirMemoria.execute({ content: 'odeio reuniões antes das 10h' }, ctx);
    const sqlText = state.executes[0]?.sqlText ?? '';
    // 'inferred' está inline no texto SQL (literal), não parametrizado do input.
    expect(sqlText).toMatch(/source/i);
    expect(sqlText).toContain("'inferred'");
    // Nunca grava 'explicit' (essa continua exclusiva de `memorizar`).
    expect(sqlText).not.toContain("'explicit'");
  });

  it('output valida e devolve memoryId UUID + content', async () => {
    const out = await sugerirMemoria.execute({ content: 'odeio reuniões antes das 10h' }, ctx);
    expect(out.memoryId).toBe(MEMORY_ID);
    expect(out.content).toBe('odeio reuniões antes das 10h');
    expect(sugerirMemoria.outputSchema.safeParse(out).success).toBe(true);
  });

  it('lança erro quando INSERT não devolve row (defensivo)', async () => {
    state.insertReturns = [[]]; // empty result
    await expect(sugerirMemoria.execute({ content: 'X' }, ctx)).rejects.toThrow(
      /INSERT em jarvis_memories não devolveu row/,
    );
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Tests — reverse() reverse_op delete_row
// ─────────────────────────────────────────────────────────────────────────────

describe('sugerir_memoria — reverse()', () => {
  const ctx = makeCtx(makeMockDb({ executes: [], insertReturns: [] }));

  it('reverse() devolve delete_row para jarvis_memories com o memoryId', async () => {
    const reverseOp = await sugerirMemoria.reverse({ memoryId: MEMORY_ID, content: 'X' }, ctx);
    expect(reverseOp).toEqual({
      kind: 'delete_row',
      table: 'jarvis_memories',
      id: MEMORY_ID,
    });
  });

  it('reverse() é reversível de verdade (delete_row, não _noop nem reinsert_row)', async () => {
    const reverseOp = await sugerirMemoria.reverse({ memoryId: MEMORY_ID, content: 'X' }, ctx);
    // A operação da tool é um INSERT → desfeito por DELETE (delete_row), NÃO
    // reinsert_row (que seria para desfazer um DELETE, como `esquecer`).
    expect(reverseOp.kind).toBe('delete_row');
    if (reverseOp.kind === 'delete_row') {
      expect(reverseOp.table).toBe('jarvis_memories');
      expect(reverseOp.id).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
      );
    }
  });
});
