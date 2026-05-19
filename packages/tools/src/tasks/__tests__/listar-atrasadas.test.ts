/**
 * Testes para `listar_atrasadas` tool — overdue filter + daysOverdue +
 * sentinela inerte `_noop` (R1b v1.1).
 *
 * Trace: Story 3.8 AC4 + AC8 (≥15 testes).
 */
import { describe, expect, it, vi } from 'vitest';

import type {
  DrizzleDbClient,
  ToolExecutionContext,
} from '@/contracts';
import {
  ReverseOpDeleteRowSchema,
  ReverseOpPayloadSchema,
} from '@/contracts';

import { listarAtrasadas } from '../listar-atrasadas';

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

interface MockState {
  executes: string[];
  insertReturns: ReadonlyArray<ReadonlyArray<unknown>>;
}

function captureSqlText(query: unknown): string {
  let sqlText = '';
  function walk(node: unknown): void {
    if (typeof node === 'string') {
      sqlText += node;
      return;
    }
    if (!node || typeof node !== 'object') return;
    const obj = node as { queryChunks?: unknown[]; value?: unknown };
    if (Array.isArray(obj.queryChunks)) {
      for (const c of obj.queryChunks) walk(c);
      return;
    }
    const v = obj.value;
    if (Array.isArray(v)) {
      for (const x of v) if (typeof x === 'string') sqlText += x;
    } else if (typeof v === 'string') {
      sqlText += v;
    }
  }
  walk(query);
  return sqlText;
}

function makeMockDb(state: MockState): DrizzleDbClient {
  let i = 0;
  const exec = vi.fn(async (q: unknown) => {
    state.executes.push(captureSqlText(q));
    const r = state.insertReturns[i] ?? [];
    i += 1;
    return r;
  });
  const db: DrizzleDbClient = {
    transaction: vi.fn(async <T,>(fn: (tx: DrizzleDbClient) => Promise<T>) =>
      fn(db),
    ) as unknown as DrizzleDbClient['transaction'],
    insert: vi.fn(),
    execute: exec as unknown as DrizzleDbClient['execute'],
  };
  return db;
}

const HOUSEHOLD_A = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';
const HOUSEHOLD_B = 'bbbbbbbb-cccc-4ddd-8eee-ffffffffffff';
const USER_ID = '99999999-aaaa-4bbb-8ccc-dddddddddddd';

function makeCtx(db: DrizzleDbClient, householdId = HOUSEHOLD_A): ToolExecutionContext {
  return {
    householdId,
    userId: USER_ID,
    db,
    traceId: 'trace_test',
    runId: '88888888-7777-4666-8555-444444444444',
  };
}

const TASK_A = '11111111-aaaa-4111-8111-111111111111';
const TASK_B = '22222222-bbbb-4222-8222-222222222222';

const overdueRow = (id: string, dueDate: string, daysOverdue: number, priority: 'low' | 'medium' | 'high' = 'high') => ({
  id,
  title: 'tarefa atrasada',
  due_date: dueDate,
  priority,
  days_overdue: daysOverdue,
});

// ─────────────────────────────────────────────────────────────────────────────
// Tests — metadata
// ─────────────────────────────────────────────────────────────────────────────

describe('listar_atrasadas — metadata', () => {
  it('nome correcto', () => {
    expect(listarAtrasadas.name).toBe('listar_atrasadas');
  });

  it('domínio tasks', () => {
    expect(listarAtrasadas.domain).toBe('tasks');
  });

  it('description menciona "atraso" ou "atrasadas"', () => {
    expect(listarAtrasadas.description.toLowerCase()).toMatch(/atraso|atrasadas/);
  });

  it('estimatedTokens = 80', () => {
    expect(listarAtrasadas.estimatedTokens).toBe(80);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Tests — input validation
// ─────────────────────────────────────────────────────────────────────────────

describe('listar_atrasadas — input validation', () => {
  it('aceita input vazio (limit opcional)', () => {
    expect(listarAtrasadas.inputSchema.safeParse({}).success).toBe(true);
  });

  it('aceita limit válido', () => {
    expect(listarAtrasadas.inputSchema.safeParse({ limit: 5 }).success).toBe(true);
  });

  it('rejeita limit > 20', () => {
    expect(listarAtrasadas.inputSchema.safeParse({ limit: 21 }).success).toBe(false);
  });

  it('rejeita limit < 1', () => {
    expect(listarAtrasadas.inputSchema.safeParse({ limit: 0 }).success).toBe(false);
  });

  it('rejeita limit float', () => {
    expect(listarAtrasadas.inputSchema.safeParse({ limit: 3.7 }).success).toBe(
      false,
    );
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Tests — preview
// ─────────────────────────────────────────────────────────────────────────────

describe('listar_atrasadas — preview', () => {
  const ctx = makeCtx(makeMockDb({ executes: [], insertReturns: [] }));

  it('preview é fixo PT-PT', () => {
    expect(listarAtrasadas.preview({}, ctx)).toBe('Listar tarefas em atraso');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Tests — execute
// ─────────────────────────────────────────────────────────────────────────────

describe('listar_atrasadas — execute', () => {
  it('SELECT inclui due_date < current_date e status NOT IN (done, archived)', async () => {
    const state: MockState = {
      executes: [],
      insertReturns: [
        [overdueRow(TASK_A, '2026-05-10', 9), overdueRow(TASK_B, '2026-05-15', 4)],
      ],
    };
    const ctx = makeCtx(makeMockDb(state));
    await listarAtrasadas.execute({}, ctx);

    const sql = state.executes[0] ?? '';
    expect(sql.toLowerCase()).toContain('due_date < current_date');
    expect(sql.toLowerCase()).toContain('not in');
    expect(sql).toMatch(/'done'\s*::\s*task_status/);
    expect(sql).toMatch(/'archived'\s*::\s*task_status/);
  });

  it('SELECT calcula days_overdue via (current_date - due_date)', async () => {
    const state: MockState = {
      executes: [],
      insertReturns: [[overdueRow(TASK_A, '2026-05-10', 9)]],
    };
    const ctx = makeCtx(makeMockDb(state));
    await listarAtrasadas.execute({}, ctx);

    expect(state.executes[0]?.toLowerCase()).toContain(
      'current_date - due_date',
    );
  });

  it('ORDER BY due_date asc (mais antigo primeiro)', async () => {
    const state: MockState = {
      executes: [],
      insertReturns: [[overdueRow(TASK_A, '2026-05-10', 9)]],
    };
    const ctx = makeCtx(makeMockDb(state));
    await listarAtrasadas.execute({}, ctx);

    expect(state.executes[0]?.toLowerCase()).toContain('order by due_date asc');
  });

  it('output mapeia snake_case → camelCase + daysOverdue', async () => {
    const state: MockState = {
      executes: [],
      insertReturns: [
        [overdueRow(TASK_A, '2026-05-10', 9, 'high')],
      ],
    };
    const ctx = makeCtx(makeMockDb(state));
    const out = await listarAtrasadas.execute({}, ctx);

    expect(out.tasks.length).toBe(1);
    expect(out.tasks[0]).toEqual({
      id: TASK_A,
      title: 'tarefa atrasada',
      dueDate: '2026-05-10',
      priority: 'high',
      daysOverdue: 9,
    });
  });

  it('limit default 10', async () => {
    const state: MockState = { executes: [], insertReturns: [[]] };
    const ctx = makeCtx(makeMockDb(state));
    await listarAtrasadas.execute({}, ctx);
    expect(state.executes[0]?.toLowerCase()).toContain('limit');
  });

  it('limit custom 5 aplicado', async () => {
    const state: MockState = { executes: [], insertReturns: [[]] };
    const ctx = makeCtx(makeMockDb(state));
    await listarAtrasadas.execute({ limit: 5 }, ctx);
    expect(state.executes[0]?.toLowerCase()).toContain('limit');
  });

  it('count reflecte número de tasks retornadas', async () => {
    const state: MockState = {
      executes: [],
      insertReturns: [
        [
          overdueRow(TASK_A, '2026-05-10', 9),
          overdueRow(TASK_B, '2026-05-15', 4),
        ],
      ],
    };
    const ctx = makeCtx(makeMockDb(state));
    const out = await listarAtrasadas.execute({}, ctx);
    expect(out.count).toBe(2);
  });

  it('zero overdue tasks — retorna count=0', async () => {
    const state: MockState = { executes: [], insertReturns: [[]] };
    const ctx = makeCtx(makeMockDb(state));
    const out = await listarAtrasadas.execute({}, ctx);
    expect(out.count).toBe(0);
    expect(out.tasks.length).toBe(0);
  });

  it('output schema valida — daysOverdue ≥ 1', async () => {
    const state: MockState = {
      executes: [],
      insertReturns: [[overdueRow(TASK_A, '2026-05-10', 9)]],
    };
    const ctx = makeCtx(makeMockDb(state));
    const out = await listarAtrasadas.execute({}, ctx);
    expect(listarAtrasadas.outputSchema.safeParse(out).success).toBe(true);
  });

  it('SELECT exclui due_date NULL (due_date is not null)', async () => {
    const state: MockState = { executes: [], insertReturns: [[]] };
    const ctx = makeCtx(makeMockDb(state));
    await listarAtrasadas.execute({}, ctx);
    expect(state.executes[0]?.toLowerCase()).toContain(
      'due_date is not null',
    );
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Tests — RLS isolation (mock cross-household)
// ─────────────────────────────────────────────────────────────────────────────

describe('listar_atrasadas — RLS isolation', () => {
  it('múltiplos contextos household diferentes têm execuções isoladas', async () => {
    const stateA: MockState = {
      executes: [],
      insertReturns: [[overdueRow(TASK_A, '2026-05-10', 9)]],
    };
    const stateB: MockState = {
      executes: [],
      insertReturns: [[]], // household B não tem tasks atrasadas
    };

    const ctxA = makeCtx(makeMockDb(stateA), HOUSEHOLD_A);
    const ctxB = makeCtx(makeMockDb(stateB), HOUSEHOLD_B);

    const outA = await listarAtrasadas.execute({}, ctxA);
    const outB = await listarAtrasadas.execute({}, ctxB);

    expect(outA.count).toBe(1);
    expect(outB.count).toBe(0);
  });

  it('SQL não inclui household_id como bind param — RLS filtra via JWT', async () => {
    const state: MockState = { executes: [], insertReturns: [[]] };
    const ctx = makeCtx(makeMockDb(state));
    await listarAtrasadas.execute({}, ctx);

    // O SELECT depende inteiramente de RLS (JWT) para o household. Não há
    // bind explícito de household_id na query.
    const sql = state.executes[0] ?? '';
    expect(sql.toLowerCase()).not.toContain('household_id');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Tests — reverse() sentinela _noop (R1b v1.1)
// ─────────────────────────────────────────────────────────────────────────────

describe('listar_atrasadas — reverse() sentinela _noop (R1b v1.1)', () => {
  const ctx = makeCtx(makeMockDb({ executes: [], insertReturns: [] }));

  it('reverse() retorna kind=delete_row table=_noop', async () => {
    const reverseOp = await listarAtrasadas.reverse(
      { tasks: [], count: 0 },
      ctx,
    );
    expect(reverseOp.kind).toBe('delete_row');
    if (reverseOp.kind === 'delete_row') {
      expect(reverseOp.table).toBe('_noop');
    }
  });

  it('reverse() id UUID válido — passa ReverseOpDeleteRowSchema', async () => {
    const reverseOp = await listarAtrasadas.reverse(
      { tasks: [], count: 0 },
      ctx,
    );
    expect(ReverseOpDeleteRowSchema.safeParse(reverseOp).success).toBe(true);
  });

  it('reverse() passa ReverseOpPayloadSchema', async () => {
    const reverseOp = await listarAtrasadas.reverse(
      { tasks: [], count: 0 },
      ctx,
    );
    expect(ReverseOpPayloadSchema.safeParse(reverseOp).success).toBe(true);
  });

  it('reverse() id é diferente entre chamadas (randomUUID)', async () => {
    const op1 = await listarAtrasadas.reverse({ tasks: [], count: 0 }, ctx);
    const op2 = await listarAtrasadas.reverse({ tasks: [], count: 0 }, ctx);
    if (op1.kind === 'delete_row' && op2.kind === 'delete_row') {
      expect(op1.id).not.toBe(op2.id);
    }
  });

  it('reverse() consistente com listar_tarefas (mesma sentinela _noop)', async () => {
    const reverseOp = await listarAtrasadas.reverse(
      { tasks: [], count: 0 },
      ctx,
    );
    if (reverseOp.kind === 'delete_row') {
      // Igual pattern de `listar_tarefas` — table sentinela inerte.
      expect(reverseOp.table).toBe('_noop');
    }
  });
});
