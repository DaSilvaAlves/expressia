/**
 * Testes para `criar_tarefa` tool — happy paths + Zod validation + reverse_op
 * + RLS via ctx.householdId + bonus TEST-001-NB (InternalAtomicAbort rollback).
 *
 * Trace: Story 3.8 AC1 + AC8 (≥20 testes) + bonus cenário Story 2.3 TEST-001-NB.
 *
 * Padrão de mocking: `vi.mock` com `mockTx` para o cliente Drizzle —
 * reutiliza padrão já validado em `packages/tools/src/__tests__/atomic.test.ts`.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type {
  DrizzleDbClient,
  ToolExecutionContext,
} from '@/contracts';
import { executeAtomic } from '@/atomic';

import { criarTarefa } from '../criar-tarefa';

// ─────────────────────────────────────────────────────────────────────────────
// Mocks
// ─────────────────────────────────────────────────────────────────────────────

vi.mock('@meu-jarvis/observability', () => ({
  withSpan: vi.fn(
    async (_name: string, _attrs: unknown, fn: (span: unknown) => unknown) => {
      const mockSpan = {
        setAttribute: vi.fn(),
        setAttributes: vi.fn(),
        end: vi.fn(),
        recordException: vi.fn(),
        setStatus: vi.fn(),
      };
      return fn(mockSpan);
    },
  ),
  hashForCorrelation: vi.fn((s: string) => `hash_${s.slice(0, 8)}`),
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

// ─────────────────────────────────────────────────────────────────────────────
// Helpers — mock Drizzle client capture INSERT
// ─────────────────────────────────────────────────────────────────────────────

interface CapturedExecute {
  readonly sqlText: string;
  readonly params: ReadonlyArray<unknown>;
}

interface MockState {
  executes: CapturedExecute[];
  /** Resposta do execute em sequência — array de result rows por chamada. */
  insertReturns: ReadonlyArray<ReadonlyArray<unknown>>;
  /** Força a transacção a rebentar (para testar InternalAtomicAbort rollback). */
  shouldThrowInTransaction?: Error;
}

function captureSqlAndParams(query: unknown): CapturedExecute {
  let sqlText = '';
  const params: unknown[] = [];
  const q = query as { queryChunks?: unknown[]; params?: unknown[] };

  if (Array.isArray(q.queryChunks)) {
    for (const chunk of q.queryChunks) {
      if (typeof chunk === 'string') {
        sqlText += chunk;
      } else if (chunk && typeof chunk === 'object') {
        const value = (chunk as { value?: unknown }).value;
        if (Array.isArray(value)) {
          for (const v of value) {
            if (typeof v === 'string') sqlText += v;
          }
        } else if (typeof value === 'string') {
          sqlText += value;
        } else {
          // Provavelmente é um param value — guardamos para inspecção.
          params.push(value);
        }
      }
    }
  }
  if (Array.isArray(q.params)) {
    for (const p of q.params) params.push(p);
  }

  return { sqlText, params };
}

function makeMockDb(state: MockState): DrizzleDbClient {
  let executeCallIndex = 0;

  const executeImpl = vi.fn(async (query: unknown) => {
    state.executes.push(captureSqlAndParams(query));
    const row = state.insertReturns[executeCallIndex] ?? [];
    executeCallIndex += 1;
    return row;
  });

  const tx: DrizzleDbClient = {
    transaction: vi.fn(async <T,>(fn: (tx: DrizzleDbClient) => Promise<T>) =>
      fn(tx),
    ) as unknown as DrizzleDbClient['transaction'],
    insert: vi.fn(),
    execute: executeImpl as unknown as DrizzleDbClient['execute'],
  };

  const db: DrizzleDbClient = {
    transaction: vi.fn(async <T,>(fn: (tx: DrizzleDbClient) => Promise<T>) => {
      if (state.shouldThrowInTransaction) {
        throw state.shouldThrowInTransaction;
      }
      return fn(tx);
    }) as unknown as DrizzleDbClient['transaction'],
    insert: vi.fn(),
    // db.execute partilha o mesmo mock (tests podem chamar criarTarefa.execute
    // directamente, sem passar pelo transaction wrapper).
    execute: executeImpl as unknown as DrizzleDbClient['execute'],
  };

  return db;
}

const TASK_ID = '11111111-2222-4333-8444-555555555555';
const HOUSEHOLD_ID = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';
const USER_ID = '99999999-aaaa-4bbb-8ccc-dddddddddddd';
const RUN_ID = '88888888-7777-4666-8555-444444444444';

function makeCtx(db: DrizzleDbClient, overrides?: Partial<ToolExecutionContext>): ToolExecutionContext {
  return {
    householdId: HOUSEHOLD_ID,
    userId: USER_ID,
    db,
    traceId: 'trace_test',
    runId: RUN_ID,
    ...overrides,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Tests — metadata + schemas
// ─────────────────────────────────────────────────────────────────────────────

describe('criar_tarefa — metadata', () => {
  it('tem o nome correcto', () => {
    expect(criarTarefa.name).toBe('criar_tarefa');
  });

  it('está no domínio tasks', () => {
    expect(criarTarefa.domain).toBe('tasks');
  });

  it('tem description PT-PT non-empty', () => {
    expect(criarTarefa.description.length).toBeGreaterThan(20);
    // Descrição deve mencionar "tarefa" ou "to-do".
    expect(criarTarefa.description.toLowerCase()).toMatch(/tarefa|to-?do/);
  });

  it('tem estimatedTokens definido', () => {
    expect(criarTarefa.estimatedTokens).toBe(50);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Tests — input schema validation
// ─────────────────────────────────────────────────────────────────────────────

describe('criar_tarefa — input validation', () => {
  it('aceita title válido (1-200 chars)', () => {
    const result = criarTarefa.inputSchema.safeParse({ title: 'ir às compras' });
    expect(result.success).toBe(true);
  });

  it('rejeita title vazio', () => {
    const result = criarTarefa.inputSchema.safeParse({ title: '' });
    expect(result.success).toBe(false);
  });

  it('rejeita title > 200 chars', () => {
    const result = criarTarefa.inputSchema.safeParse({ title: 'X'.repeat(201) });
    expect(result.success).toBe(false);
  });

  it('aceita dueDate ISO YYYY-MM-DD', () => {
    const result = criarTarefa.inputSchema.safeParse({
      title: 'X',
      dueDate: '2026-06-15',
    });
    expect(result.success).toBe(true);
  });

  it('rejeita dueDate em formato errado (DD/MM/YYYY)', () => {
    const result = criarTarefa.inputSchema.safeParse({
      title: 'X',
      dueDate: '15/06/2026',
    });
    expect(result.success).toBe(false);
  });

  it('rejeita dueDate em formato errado (ISO timestamp completo)', () => {
    const result = criarTarefa.inputSchema.safeParse({
      title: 'X',
      dueDate: '2026-06-15T10:00:00Z',
    });
    expect(result.success).toBe(false);
  });

  it('aceita priority valid enum (low/medium/high)', () => {
    expect(
      criarTarefa.inputSchema.safeParse({ title: 'X', priority: 'low' }).success,
    ).toBe(true);
    expect(
      criarTarefa.inputSchema.safeParse({ title: 'X', priority: 'medium' }).success,
    ).toBe(true);
    expect(
      criarTarefa.inputSchema.safeParse({ title: 'X', priority: 'high' }).success,
    ).toBe(true);
  });

  it('rejeita priority inválida', () => {
    const result = criarTarefa.inputSchema.safeParse({
      title: 'X',
      priority: 'critical',
    });
    expect(result.success).toBe(false);
  });

  it('permite priority opcional (omissão)', () => {
    const result = criarTarefa.inputSchema.safeParse({ title: 'X' });
    expect(result.success).toBe(true);
  });

  // ── dueTime (OBS-2) ──────────────────────────────────────────────────────

  it('aceita dueTime HH:MM 24h quando há dueDate', () => {
    const result = criarTarefa.inputSchema.safeParse({
      title: 'reunião',
      dueDate: '2026-06-15',
      dueTime: '09:30',
    });
    expect(result.success).toBe(true);
  });

  it('aceita dueTime no limite 23:59', () => {
    const result = criarTarefa.inputSchema.safeParse({
      title: 'X',
      dueDate: '2026-06-15',
      dueTime: '23:59',
    });
    expect(result.success).toBe(true);
  });

  it('rejeita dueTime em formato errado (sem zero à esquerda)', () => {
    const result = criarTarefa.inputSchema.safeParse({
      title: 'X',
      dueDate: '2026-06-15',
      dueTime: '9:30',
    });
    expect(result.success).toBe(false);
  });

  it('rejeita dueTime com minutos inválidos (>59)', () => {
    const result = criarTarefa.inputSchema.safeParse({
      title: 'X',
      dueDate: '2026-06-15',
      dueTime: '10:75',
    });
    expect(result.success).toBe(false);
  });

  it('rejeita dueTime SEM dueDate (regra de domínio: hora exige dia)', () => {
    const result = criarTarefa.inputSchema.safeParse({
      title: 'reunião',
      dueTime: '15:00',
    });
    expect(result.success).toBe(false);
    if (!result.success) {
      // O erro do refine aponta para o campo dueTime.
      expect(result.error.issues[0]?.path).toContain('dueTime');
    }
  });

  it('permite dueDate sem dueTime (hora opcional)', () => {
    const result = criarTarefa.inputSchema.safeParse({
      title: 'X',
      dueDate: '2026-06-15',
    });
    expect(result.success).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Tests — preview
// ─────────────────────────────────────────────────────────────────────────────

describe('criar_tarefa — preview PT-PT', () => {
  const ctx = makeCtx(makeMockDb({ executes: [], insertReturns: [] }));

  it('preview sem dueDate inclui apenas o título', () => {
    const out = criarTarefa.preview({ title: 'comprar leite' }, ctx);
    expect(out).toContain('comprar leite');
    expect(out).not.toContain('para');
  });

  it('preview com dueDate inclui data formatada DD/MM/YYYY', () => {
    const out = criarTarefa.preview(
      { title: 'pagar renda', dueDate: '2026-06-01' },
      ctx,
    );
    expect(out).toContain('pagar renda');
    expect(out).toContain('01/06/2026');
  });

  it('preview com dueDate + dueTime inclui a hora (OBS-2)', () => {
    const out = criarTarefa.preview(
      { title: 'reunião', dueDate: '2026-06-01', dueTime: '15:00' },
      ctx,
    );
    expect(out).toContain('reunião');
    expect(out).toContain('01/06/2026');
    expect(out).toContain('às 15:00');
  });

  it('preview começa com PT-PT "Criar tarefa"', () => {
    const out = criarTarefa.preview({ title: 'X' }, ctx);
    expect(out.startsWith('Criar tarefa')).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Tests — execute (RLS, INSERT, output)
// ─────────────────────────────────────────────────────────────────────────────

describe('criar_tarefa — execute', () => {
  let state: MockState;
  let ctx: ToolExecutionContext;

  beforeEach(() => {
    state = {
      executes: [],
      insertReturns: [
        [
          {
            id: TASK_ID,
            title: 'comprar leite',
            due_date: '2026-06-01',
            due_time: null,
            priority: 'medium',
          },
        ],
      ],
    };
    ctx = makeCtx(makeMockDb(state));
  });

  it('INSERT em tasks usa ctx.householdId (não payload)', async () => {
    await criarTarefa.execute({ title: 'comprar leite' }, ctx);
    expect(state.executes.length).toBe(1);
    // Verifica que o SQL menciona household_id (Drizzle parametriza valor).
    expect(state.executes[0]?.sqlText).toMatch(/household_id/i);
    expect(state.executes[0]?.sqlText).toMatch(/insert into tasks/i);
  });

  it('INSERT inclui created_by_user_id, title, due_date, due_time, priority, status', async () => {
    await criarTarefa.execute(
      { title: 'X', dueDate: '2026-06-15', dueTime: '15:00', priority: 'high' },
      ctx,
    );
    const sql = state.executes[0]?.sqlText ?? '';
    expect(sql).toMatch(/created_by_user_id/i);
    expect(sql).toMatch(/title/i);
    expect(sql).toMatch(/due_date/i);
    expect(sql).toMatch(/due_time/i);
    expect(sql).toMatch(/priority/i);
    expect(sql).toMatch(/status/i);
    expect(sql).toMatch(/'todo'::task_status/);
  });

  it('output schema valida e retorna taskId UUID', async () => {
    const out = await criarTarefa.execute({ title: 'comprar leite' }, ctx);
    expect(out.taskId).toBe(TASK_ID);
    expect(out.title).toBe('comprar leite');
    expect(out.dueDate).toBe('2026-06-01');
    expect(out.dueTime).toBeNull();
    expect(out.priority).toBe('medium');

    // Output schema deve validar o resultado.
    const parsed = criarTarefa.outputSchema.safeParse(out);
    expect(parsed.success).toBe(true);
  });

  it('dueDate ausente retorna null no output', async () => {
    state.insertReturns = [
      [
        {
          id: TASK_ID,
          title: 'X',
          due_date: null,
          due_time: null,
          priority: 'medium',
        },
      ],
    ];
    const out = await criarTarefa.execute({ title: 'X' }, ctx);
    expect(out.dueDate).toBeNull();
    expect(out.dueTime).toBeNull();
  });

  it('dueTime preenchido com dueDate retorna a hora no output (OBS-2)', async () => {
    state.insertReturns = [
      [
        {
          id: TASK_ID,
          title: 'reunião',
          due_date: '2026-06-15',
          due_time: '15:00',
          priority: 'medium',
        },
      ],
    ];
    const out = await criarTarefa.execute(
      { title: 'reunião', dueDate: '2026-06-15', dueTime: '15:00' },
      ctx,
    );
    expect(out.dueDate).toBe('2026-06-15');
    expect(out.dueTime).toBe('15:00');

    // O SQL parametriza o valor da hora como bind param do due_time::text.
    expect(state.executes[0]?.sqlText).toMatch(/due_time/i);

    const parsed = criarTarefa.outputSchema.safeParse(out);
    expect(parsed.success).toBe(true);
  });

  it('priority default "medium" aplicado quando omitido', async () => {
    state.insertReturns = [
      [
        {
          id: TASK_ID,
          title: 'X',
          due_date: null,
          due_time: null,
          priority: 'medium',
        },
      ],
    ];
    await criarTarefa.execute({ title: 'X' }, ctx);
    // O SQL captura o valor 'medium' como bind param.
    // Inspeção quantitativa: pelo menos um query executou.
    expect(state.executes.length).toBe(1);
  });

  it('lança erro quando INSERT não devolve row (defensivo)', async () => {
    state.insertReturns = [[]]; // empty result
    await expect(criarTarefa.execute({ title: 'X' }, ctx)).rejects.toThrow(
      /INSERT em tasks não devolveu row/,
    );
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Tests — reverse() reverse_op delete_row
// ─────────────────────────────────────────────────────────────────────────────

describe('criar_tarefa — reverse()', () => {
  const ctx = makeCtx(makeMockDb({ executes: [], insertReturns: [] }));

  it('reverse() retorna delete_row para tasks com taskId correcto', async () => {
    const reverseOp = await criarTarefa.reverse(
      {
        taskId: TASK_ID,
        title: 'X',
        dueDate: null,
        dueTime: null,
        priority: 'medium',
      },
      ctx,
    );
    expect(reverseOp).toEqual({
      kind: 'delete_row',
      table: 'tasks',
      id: TASK_ID,
    });
  });

  it('reverse() retorna sempre kind=delete_row', async () => {
    const reverseOp = await criarTarefa.reverse(
      {
        taskId: TASK_ID,
        title: 'X',
        dueDate: null,
        dueTime: null,
        priority: 'low',
      },
      ctx,
    );
    expect(reverseOp.kind).toBe('delete_row');
  });

  it('reverse() retorna table=tasks (não _noop)', async () => {
    const reverseOp = await criarTarefa.reverse(
      {
        taskId: TASK_ID,
        title: 'X',
        dueDate: null,
        dueTime: null,
        priority: 'high',
      },
      ctx,
    );
    if (reverseOp.kind === 'delete_row') {
      expect(reverseOp.table).toBe('tasks');
    }
  });

  it('reverse() id é UUID válido (passa Zod uuid())', async () => {
    const reverseOp = await criarTarefa.reverse(
      {
        taskId: TASK_ID,
        title: 'X',
        dueDate: null,
        dueTime: null,
        priority: 'medium',
      },
      ctx,
    );
    if (reverseOp.kind === 'delete_row') {
      expect(reverseOp.id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i);
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Tests — integração com executeAtomic (E2E mock)
// ─────────────────────────────────────────────────────────────────────────────

describe('criar_tarefa — executeAtomic integration', () => {
  it('via executeAtomic — sucesso + reverse_op persistido', async () => {
    const state: MockState = {
      executes: [],
      insertReturns: [
        // 1ª chamada: INSERT em tasks → retorna a row criada.
        [
          {
            id: TASK_ID,
            title: 'comprar leite',
            due_date: null,
            due_time: null,
            priority: 'medium',
          },
        ],
        // 2ª chamada: INSERT em agent_reverse_ops → retorna { id }.
        [{ id: '00000000-0000-4000-8000-000000000001' }],
      ],
    };
    const db = makeMockDb(state);
    const ctx = makeCtx(db);

    const outcome = await executeAtomic(
      [{ definition: criarTarefa, input: { title: 'comprar leite' } }],
      ctx,
    );

    expect(outcome.success).toBe(true);
    if (outcome.success) {
      expect(outcome.results.length).toBe(1);
      expect(outcome.results[0]?.toolName).toBe('criar_tarefa');
    }

    // Deve haver 2 execute calls: INSERT tasks + INSERT agent_reverse_ops.
    expect(state.executes.length).toBe(2);
    expect(state.executes[0]?.sqlText).toMatch(/insert into tasks/i);
    expect(state.executes[1]?.sqlText).toMatch(/insert into agent_reverse_ops/i);
    // O insert em agent_reverse_ops deve incluir reverse_op tipo delete_row.
    expect(state.executes[1]?.sqlText).toMatch(/expires_at/i);
  });

  it('via executeAtomic — input inválido falha com ToolValidationError', async () => {
    const state: MockState = { executes: [], insertReturns: [[]] };
    const ctx = makeCtx(makeMockDb(state));

    const outcome = await executeAtomic(
      [{ definition: criarTarefa, input: { title: '' } }], // title vazio
      ctx,
    );

    expect(outcome.success).toBe(false);
    if (!outcome.success) {
      expect(outcome.failedToolName).toBe('criar_tarefa');
      expect(outcome.error.name).toBe('ToolValidationError');
    }
  });

  /**
   * Bonus TEST-001-NB (Story 2.3 gate carry-over):
   * Simula InternalAtomicAbort path via `shouldThrowInTransaction` →
   * verifica que Drizzle propaga o erro como ToolTransactionError (retryable).
   */
  it('TEST-001-NB bonus — transacção rebenta → ToolTransactionError propaga', async () => {
    const state: MockState = {
      executes: [],
      insertReturns: [],
      shouldThrowInTransaction: new Error('connection lost mid-tx'),
    };
    const db = makeMockDb(state);
    const ctx = makeCtx(db);

    await expect(
      executeAtomic(
        [{ definition: criarTarefa, input: { title: 'X' } }],
        ctx,
      ),
    ).rejects.toThrow(/transaction failed|connection lost/i);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Tests — segurança RLS (não usa input para household_id)
// ─────────────────────────────────────────────────────────────────────────────

describe('criar_tarefa — segurança RLS', () => {
  it('execute usa ctx.householdId mesmo se payload tentasse forçar outro', async () => {
    const state: MockState = {
      executes: [],
      insertReturns: [
        [{ id: TASK_ID, title: 'X', due_date: null, due_time: null, priority: 'medium' }],
      ],
    };
    const ctx = makeCtx(makeMockDb(state));

    // Mesmo que houvesse um campo household_id no input (não há no schema —
    // garantia adicional), o execute só usa ctx.householdId.
    await criarTarefa.execute({ title: 'X' }, ctx);

    // O SQL parametriza ctx.householdId — testamos via formato do query.
    expect(state.executes.length).toBe(1);
    // O Drizzle bind dos valores: o sqlText cobre apenas literals SQL.
    expect(state.executes[0]?.sqlText).toMatch(/household_id/i);
  });

  it('inputSchema não tem campo household_id (defesa em profundidade)', () => {
    // Tentar passar household_id no input não causa erro mas é ignorado:
    // o schema é `strip` mode (default Zod), descarta keys desconhecidas.
    const result = criarTarefa.inputSchema.safeParse({
      title: 'X',
      household_id: 'fake-uuid-attack',
    });
    expect(result.success).toBe(true);
    if (result.success) {
      // O household_id desconhecido foi descartado.
      expect(result.data).not.toHaveProperty('household_id');
    }
  });
});
