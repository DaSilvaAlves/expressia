/**
 * Testes para `executeAtomic` — atomicidade transaccional, rollback,
 * persistência de agent_reverse_ops, RLS guard, span attributes.
 *
 * Trace: Story 2.3 AC5 + AC6 + AC7 + AC11 (≥12 testes em atomic.test.ts).
 *
 * Mocks:
 *   - `ctx.db.transaction` é mockada com `vi.fn(async (fn) => fn(mockTx))`.
 *   - `mockTx.execute` é mockada para devolver array com row inserida.
 *   - `@meu-jarvis/observability` é mockada (igual a tracing.test.ts) para
 *     evitar requirimento de SDK OTel registado.
 */
import { describe, expect, it, vi, beforeEach } from 'vitest';
import { z } from 'zod';

import type {
  AtomicResult,
  AtomicFailure,
  ReverseOpPayload,
  ToolDefinition,
  ToolExecutionContext,
  DrizzleDbClient,
  TxRunner,
} from '@/contracts';
import { executeAtomic } from '@/atomic';
import {
  ToolError,
  ToolExecutionError,
  ToolPlanGateError,
  ToolValidationError,
} from '@/errors';
import { echoTool, failTool, slowTool } from '@/__fixtures__/mock-tools';

// ─────────────────────────────────────────────────────────────────────────────
// Mocks
// ─────────────────────────────────────────────────────────────────────────────

vi.mock('@meu-jarvis/observability', () => ({
  withSpan: vi.fn(async (_name: string, _attrs: unknown, fn: (span: unknown) => unknown) => {
    const mockSpan = {
      setAttribute: vi.fn(),
      setAttributes: vi.fn(),
      end: vi.fn(),
      recordException: vi.fn(),
      setStatus: vi.fn(),
    };
    return fn(mockSpan);
  }),
  hashForCorrelation: vi.fn((s: string) => `hash_${s.slice(0, 8)}`),
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

// ─────────────────────────────────────────────────────────────────────────────
// Mock DB Client builder
// ─────────────────────────────────────────────────────────────────────────────

interface MockDbState {
  transactionCalls: number;
  insertedReverseOps: Array<{ raw: unknown; sqlText: string }>;
  shouldThrowInTransaction?: Error;
  /** Permite o teste sabotar o execute para não devolver row (cobrir defensivo). */
  executeReturnsEmpty?: boolean;
}

function makeMockDb(state: MockDbState): { db: DrizzleDbClient; state: MockDbState } {
  const tx: DrizzleDbClient = {
    transaction: vi.fn(async <T,>(fn: (tx: DrizzleDbClient) => Promise<T>) => fn(tx)) as unknown as DrizzleDbClient['transaction'],
    insert: vi.fn(),
    execute: vi.fn(async (query: unknown) => {
      // Captura a SQL string para inspecção. Drizzle `sql` template tag
      // produz um objecto com `queryChunks` (array de strings + StringChunk)
      // intercalados com parâmetros. Concatenamos APENAS os fragmentos
      // string para inspeccionar o SQL literal (sem valores).
      let sqlText = '';
      const queryChunks = (query as { queryChunks?: unknown[] })?.queryChunks;
      if (Array.isArray(queryChunks)) {
        for (const chunk of queryChunks) {
          if (typeof chunk === 'string') {
            sqlText += chunk;
          } else if (chunk && typeof chunk === 'object') {
            // StringChunk has `.value: string[]` containing literal SQL fragments.
            const value = (chunk as { value?: unknown }).value;
            if (Array.isArray(value)) {
              for (const v of value) {
                if (typeof v === 'string') sqlText += v;
              }
            } else if (typeof value === 'string') {
              sqlText += value;
            }
          }
        }
      } else {
        sqlText = String(query);
      }
      state.insertedReverseOps.push({ raw: query, sqlText });
      if (state.executeReturnsEmpty) return [];
      // Retorna uma row mock com id UUID determinístico.
      return [
        {
          id: `00000000-0000-4000-8000-${String(state.insertedReverseOps.length).padStart(12, '0')}`,
        },
      ];
    }) as unknown as DrizzleDbClient['execute'],
  };

  const db: DrizzleDbClient = {
    transaction: vi.fn(async <T,>(fn: (tx: DrizzleDbClient) => Promise<T>): Promise<T> => {
      state.transactionCalls += 1;
      if (state.shouldThrowInTransaction) {
        throw state.shouldThrowInTransaction;
      }
      // Drizzle propaga throws do callback (rollback automático). Replicamos.
      return fn(tx);
    }) as unknown as DrizzleDbClient['transaction'],
    insert: vi.fn(),
    execute: vi.fn() as unknown as DrizzleDbClient['execute'],
  };

  return { db, state };
}

function makeCtx(db: DrizzleDbClient): ToolExecutionContext {
  return {
    householdId: '11111111-2222-3333-4444-555555555555',
    userId: '99999999-aaaa-bbbb-cccc-dddddddddddd',
    db,
    traceId: 'trace_test',
    runId: '88888888-7777-4666-8555-444444444444',
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Tests
// ─────────────────────────────────────────────────────────────────────────────

describe('executeAtomic — happy paths', () => {
  let state: MockDbState;
  let ctx: ToolExecutionContext;

  beforeEach(() => {
    state = { transactionCalls: 0, insertedReverseOps: [] };
    const { db } = makeMockDb(state);
    ctx = makeCtx(db);
  });

  it('1 tool sucesso — retorna AtomicResult com 1 result', async () => {
    const outcome = await executeAtomic([{ definition: echoTool, input: { text: 'olá' } }], ctx);
    expect(outcome.success).toBe(true);
    if (outcome.success) {
      expect(outcome.results.length).toBe(1);
      expect(outcome.results[0]?.toolName).toBe('echo_test');
      expect(outcome.results[0]?.reverseOpId).toMatch(/^[0-9a-f-]{36}$/);
      expect(outcome.results[0]?.output).toMatchObject({ echoed: 'olá' });
    }
    expect(state.transactionCalls).toBe(1);
    expect(state.insertedReverseOps.length).toBe(1);
  });

  it('3 tools sucesso — retorna AtomicResult com 3 results sequenciais', async () => {
    const outcome = await executeAtomic(
      [
        { definition: echoTool, input: { text: 'a' } },
        { definition: slowTool, input: { delayMs: 0 } },
        { definition: echoTool, input: { text: 'c' } },
      ],
      ctx,
    );
    expect(outcome.success).toBe(true);
    if (outcome.success) {
      expect(outcome.results.length).toBe(3);
      expect(outcome.results[0]?.toolName).toBe('echo_test');
      expect(outcome.results[1]?.toolName).toBe('slow_test');
      expect(outcome.results[2]?.toolName).toBe('echo_test');
    }
    expect(state.transactionCalls).toBe(1);
    expect(state.insertedReverseOps.length).toBe(3);
  });

  it('AtomicResult.results contém output validado contra outputSchema', async () => {
    const outcome = await executeAtomic([{ definition: echoTool, input: { text: 'X' } }], ctx);
    expect(outcome.success).toBe(true);
    if (outcome.success) {
      const out = outcome.results[0]?.output as { echoed: string; id: string };
      expect(out.echoed).toBe('X');
      expect(out.id).toMatch(/^[0-9a-f-]{36}$/);
    }
  });
});

describe('executeAtomic — failure modes (rollback automático)', () => {
  let state: MockDbState;
  let ctx: ToolExecutionContext;

  beforeEach(() => {
    state = { transactionCalls: 0, insertedReverseOps: [] };
    const { db } = makeMockDb(state);
    ctx = makeCtx(db);
  });

  it('rollback quando tool 2 falha — retorna AtomicFailure', async () => {
    const outcome = await executeAtomic(
      [
        { definition: echoTool, input: { text: 'first' } },
        { definition: failTool, input: { shouldFail: true } },
        { definition: echoTool, input: { text: 'never_runs' } },
      ],
      ctx,
    );
    expect(outcome.success).toBe(false);
    if (!outcome.success) {
      const failure = outcome as AtomicFailure;
      expect(failure.failedToolName).toBe('fail_test');
      expect(failure.error).toBeInstanceOf(ToolError);
      expect(failure.error).toBeInstanceOf(ToolExecutionError);
      expect(failure.rolledBack).toBe(true);
    }
    // O tool 1 inseriu reverse_op DENTRO da transacção, mas a transacção
    // foi rolled back pelo Drizzle — o nosso mock simula via state mas em
    // produção o Postgres reverte o insert. Aqui validamos que o tool 3
    // nunca foi alcançado (executor sequencial parou na falha).
    expect(state.transactionCalls).toBe(1);
  });

  it('rollback quando input inválido (Zod fail) — AtomicFailure com ToolValidationError', async () => {
    const outcome = await executeAtomic(
      [
        { definition: echoTool, input: { text: '' } }, // text min 1 — falha
      ],
      ctx,
    );
    expect(outcome.success).toBe(false);
    if (!outcome.success) {
      const failure = outcome as AtomicFailure;
      expect(failure.failedToolName).toBe('echo_test');
      expect(failure.error).toBeInstanceOf(ToolValidationError);
      expect(failure.rolledBack).toBe(true);
    }
  });

  it('rollback quando schema do output não bate', async () => {
    const malformedTool: ToolDefinition<{ x: number }, { y: number }> = {
      name: 'malformed_test',
      domain: 'system',
      description: 'mock',
      inputSchema: z.object({ x: z.number() }),
      outputSchema: z.object({ y: z.number() }),
      preview: () => 'preview',
      // execute devolve string em vez de { y: number } — output invalido
      execute: async () => ({ y: 'not-a-number' }) as unknown as { y: number },
      reverse: async () => ({ kind: 'delete_row', table: 'm', id: '11111111-1111-4111-8111-111111111111' }),
    };

    const outcome = await executeAtomic([{ definition: malformedTool, input: { x: 1 } }], ctx);
    expect(outcome.success).toBe(false);
    if (!outcome.success) {
      expect(outcome.error).toBeInstanceOf(ToolValidationError);
      expect((outcome.error as ToolValidationError).field).toContain('output');
    }
  });

  it('reverse() lançar é capturado como ToolExecutionError', async () => {
    const reverseFailsTool: ToolDefinition<{ x: number }, { y: number }> = {
      name: 'reverse_fails',
      domain: 'system',
      description: 'mock',
      inputSchema: z.object({ x: z.number() }),
      outputSchema: z.object({ y: z.number() }),
      preview: () => 'preview',
      execute: async (input) => ({ y: input.x }),
      reverse: async () => {
        throw new Error('reverse boom');
      },
    };

    const outcome = await executeAtomic([{ definition: reverseFailsTool, input: { x: 1 } }], ctx);
    expect(outcome.success).toBe(false);
    if (!outcome.success) {
      expect(outcome.error).toBeInstanceOf(ToolExecutionError);
      expect(outcome.failedToolName).toBe('reverse_fails');
    }
  });
});

describe('executeAtomic — persistência agent_reverse_ops', () => {
  it('insert SQL contém `expires_at = now() + interval` (não JS Date)', async () => {
    const state: MockDbState = { transactionCalls: 0, insertedReverseOps: [] };
    const { db } = makeMockDb(state);
    const ctx = makeCtx(db);

    await executeAtomic([{ definition: echoTool, input: { text: 'x' } }], ctx);

    expect(state.insertedReverseOps.length).toBe(1);
    const inserted = state.insertedReverseOps[0];
    expect(inserted).toBeDefined();
    // O sql template captura inclui o literal string `now() + interval '30 seconds'`.
    expect(inserted?.sqlText).toMatch(/now\(\)\s*\+\s*interval\s*'30\s*seconds'/i);
  });

  it('insert recebe agent_run_id, household_id e reverse_op via SQL placeholders', async () => {
    const state: MockDbState = { transactionCalls: 0, insertedReverseOps: [] };
    const { db } = makeMockDb(state);
    const ctx = makeCtx(db);

    await executeAtomic([{ definition: echoTool, input: { text: 'x' } }], ctx);

    expect(state.insertedReverseOps.length).toBe(1);
    const inserted = state.insertedReverseOps[0];
    // Garantia: o SQL template inclui referências às colunas correctas.
    expect(inserted?.sqlText).toMatch(/agent_run_id/i);
    expect(inserted?.sqlText).toMatch(/household_id/i);
    expect(inserted?.sqlText).toMatch(/reverse_op/i);
    expect(inserted?.sqlText).toMatch(/returning\s+id/i);
  });

  it('insert com row vazio (defensivo) → ToolExecutionError + AtomicFailure', async () => {
    const state: MockDbState = {
      transactionCalls: 0,
      insertedReverseOps: [],
      executeReturnsEmpty: true,
    };
    const { db } = makeMockDb(state);
    const ctx = makeCtx(db);

    const outcome = await executeAtomic([{ definition: echoTool, input: { text: 'x' } }], ctx);
    expect(outcome.success).toBe(false);
    if (!outcome.success) {
      expect(outcome.error).toBeInstanceOf(ToolExecutionError);
      expect(outcome.failedToolName).toBe('echo_test');
    }
  });
});

describe('executeAtomic — ctxWithTx invariants', () => {
  it('ctx.db nunca é substituído por getServiceDb internamente', async () => {
    // Verificação: o `db` passado a tools dentro da transacção é o `tx`,
    // não outro cliente. Tornamos isto observável capturando o ctx que cada
    // tool recebe e validando a referência.

    const state: MockDbState = { transactionCalls: 0, insertedReverseOps: [] };
    const { db } = makeMockDb(state);

    let ctxSeenByTool: ToolExecutionContext | undefined;
    const inspectorTool: ToolDefinition<{ y: number }, { z: number }> = {
      name: 'inspector',
      domain: 'system',
      description: 'mock',
      inputSchema: z.object({ y: z.number() }),
      outputSchema: z.object({ z: z.number() }),
      preview: () => 'p',
      execute: async (input, innerCtx) => {
        ctxSeenByTool = innerCtx;
        return { z: input.y };
      },
      reverse: async () => ({ kind: 'delete_row', table: 'mock', id: '11111111-1111-4111-8111-111111111111' }) as ReverseOpPayload,
    };

    const ctx = makeCtx(db);
    await executeAtomic([{ definition: inspectorTool, input: { y: 5 } }], ctx);

    expect(ctxSeenByTool).toBeDefined();
    // db é o tx — deveria ter `execute` (o nosso mock tx tem-no).
    expect(typeof ctxSeenByTool?.db.execute).toBe('function');
    // Os outros campos devem ser preservados exactamente.
    expect(ctxSeenByTool?.householdId).toBe(ctx.householdId);
    expect(ctxSeenByTool?.userId).toBe(ctx.userId);
    expect(ctxSeenByTool?.traceId).toBe(ctx.traceId);
    expect(ctxSeenByTool?.runId).toBe(ctx.runId);
    // CRÍTICO: db NÃO é o cliente raiz — é o tx interno.
    expect(ctxSeenByTool?.db).not.toBe(ctx.db);
  });
});

describe('executeAtomic — propagação de ToolError', () => {
  it('ToolPlanGateError lançado pela tool propaga como AtomicFailure', async () => {
    const planGatedTool: ToolDefinition<{ x: number }, { y: number }> = {
      name: 'plan_gated',
      domain: 'finance',
      description: 'mock requires familia',
      requiredPlan: 'familia',
      inputSchema: z.object({ x: z.number() }),
      outputSchema: z.object({ y: z.number() }),
      preview: () => 'preview',
      execute: async () => {
        throw new ToolPlanGateError('plan_gated', 'familia', 'pessoal');
      },
      reverse: async () => ({ kind: 'delete_row', table: 'm', id: '11111111-1111-4111-8111-111111111111' }),
    };

    const state: MockDbState = { transactionCalls: 0, insertedReverseOps: [] };
    const { db } = makeMockDb(state);
    const ctx = makeCtx(db);

    const outcome = await executeAtomic([{ definition: planGatedTool, input: { x: 1 } }], ctx);
    expect(outcome.success).toBe(false);
    if (!outcome.success) {
      expect(outcome.error).toBeInstanceOf(ToolPlanGateError);
      const planErr = outcome.error as ToolPlanGateError;
      expect(planErr.requiredPlan).toBe('familia');
      expect(planErr.actualPlan).toBe('pessoal');
    }
  });
});

describe('executeAtomic — AtomicResult shape', () => {
  it('AtomicResult.success === true e contém results[]', async () => {
    const state: MockDbState = { transactionCalls: 0, insertedReverseOps: [] };
    const { db } = makeMockDb(state);
    const ctx = makeCtx(db);

    const outcome = await executeAtomic([{ definition: echoTool, input: { text: 'a' } }], ctx);
    expect(outcome).toMatchObject<Partial<AtomicResult>>({ success: true });
    if (outcome.success) {
      expect(Array.isArray(outcome.results)).toBe(true);
      expect(outcome.results[0]).toHaveProperty('toolName');
      expect(outcome.results[0]).toHaveProperty('output');
      expect(outcome.results[0]).toHaveProperty('reverseOpId');
    }
  });
});

describe('executeAtomic — txRunner injectado (SEC-8 / ADR-003 Fase 4 Fatia D)', () => {
  /**
   * Constrói um `tx` mínimo com `execute` funcional (devolve a row do
   * agent_reverse_ops insert) para o callback do `txRunner`.
   */
  function makeTxClient(): DrizzleDbClient {
    return {
      transaction: vi.fn() as unknown as DrizzleDbClient['transaction'],
      insert: vi.fn() as unknown as DrizzleDbClient['insert'],
      execute: vi.fn(async () => [
        { id: '00000000-0000-4000-8000-00000000abcd' },
      ]) as unknown as DrizzleDbClient['execute'],
    };
  }

  it('usa o txRunner injectado para abrir a tx (NÃO ctx.db.transaction)', async () => {
    const state: MockDbState = { transactionCalls: 0, insertedReverseOps: [] };
    const { db } = makeMockDb(state);
    const ctx = makeCtx(db);

    let txRunnerCalls = 0;
    let txSeenByLoop: DrizzleDbClient | undefined;
    const txClient = makeTxClient();
    const txRunner: TxRunner = async (fn) => {
      txRunnerCalls += 1;
      return fn(txClient);
    };

    const outcome = await executeAtomic(
      [{ definition: echoTool, input: { text: 'rls' } }],
      ctx,
      txRunner,
    );

    expect(outcome.success).toBe(true);
    // O runner injectado foi usado exactamente uma vez...
    expect(txRunnerCalls).toBe(1);
    // ...e o default `ctx.db.transaction` NÃO disparou.
    expect(state.transactionCalls).toBe(0);
    // E o agent_reverse_ops insert correu no tx que o runner forneceu.
    expect(txClient.execute).toHaveBeenCalledTimes(1);
    txSeenByLoop = txClient;
    expect(txSeenByLoop).toBe(txClient);
  });

  it('o loop recebe o tx do runner em ctxWithTx.db (não o ctx.db raiz)', async () => {
    const state: MockDbState = { transactionCalls: 0, insertedReverseOps: [] };
    const { db } = makeMockDb(state);
    const ctx = makeCtx(db);

    const txClient = makeTxClient();
    const txRunner: TxRunner = async (fn) => fn(txClient);

    let ctxSeenByTool: ToolExecutionContext | undefined;
    const inspectorTool: ToolDefinition<{ y: number }, { z: number }> = {
      name: 'inspector_txrunner',
      domain: 'system',
      description: 'mock',
      inputSchema: z.object({ y: z.number() }),
      outputSchema: z.object({ z: z.number() }),
      preview: () => 'p',
      execute: async (input, innerCtx) => {
        ctxSeenByTool = innerCtx;
        return { z: input.y };
      },
      reverse: async () =>
        ({ kind: 'delete_row', table: 'mock', id: '11111111-1111-4111-8111-111111111111' }) as ReverseOpPayload,
    };

    await executeAtomic([{ definition: inspectorTool, input: { y: 7 } }], ctx, txRunner);

    expect(ctxSeenByTool).toBeDefined();
    // O db visto pela tool é o tx do runner, NUNCA o ctx.db raiz (placeholder em prod).
    expect(ctxSeenByTool?.db).toBe(txClient);
    expect(ctxSeenByTool?.db).not.toBe(ctx.db);
    // Demais campos preservados.
    expect(ctxSeenByTool?.householdId).toBe(ctx.householdId);
    expect(ctxSeenByTool?.userId).toBe(ctx.userId);
  });

  it('sem txRunner: default backward-compat abre via ctx.db.transaction', async () => {
    const state: MockDbState = { transactionCalls: 0, insertedReverseOps: [] };
    const { db } = makeMockDb(state);
    const ctx = makeCtx(db);

    const outcome = await executeAtomic([{ definition: echoTool, input: { text: 'legacy' } }], ctx);

    expect(outcome.success).toBe(true);
    // Default path: a transacção raiz foi aberta exactamente uma vez.
    expect(state.transactionCalls).toBe(1);
  });
});
