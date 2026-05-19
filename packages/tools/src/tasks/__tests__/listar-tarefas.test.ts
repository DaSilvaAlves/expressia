/**
 * Testes para `listar_tarefas` tool — happy paths + filtros + limit +
 * sentinela inerte `_noop` (R1b v1.1).
 *
 * Trace: Story 3.8 AC3 + AC8 (≥15 testes).
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

import { listarTarefas } from '../listar-tarefas';

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
  // Recursivo — Drizzle SQL pode aninhar `sql` template tags como chunks via
  // ${sql\`...\`} interpolation. Cada nested SQL é um objecto com `queryChunks`.
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

const HOUSEHOLD_ID = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';
const USER_ID = '99999999-aaaa-4bbb-8ccc-dddddddddddd';

function makeCtx(db: DrizzleDbClient): ToolExecutionContext {
  return {
    householdId: HOUSEHOLD_ID,
    userId: USER_ID,
    db,
    traceId: 'trace_test',
    runId: '88888888-7777-4666-8555-444444444444',
  };
}

const TASK_A = '11111111-aaaa-4111-8111-111111111111';
const TASK_B = '22222222-bbbb-4222-8222-222222222222';
const TASK_C = '33333333-cccc-4333-8333-333333333333';

const sampleRow = (id: string, overrides: Partial<{ title: string; due_date: string | null; priority: 'low' | 'medium' | 'high'; status: 'todo' | 'doing' | 'done' | 'archived' }> = {}) => ({
  id,
  title: overrides.title ?? 'Tarefa X',
  due_date: overrides.due_date ?? null,
  priority: overrides.priority ?? 'medium',
  status: overrides.status ?? 'todo',
});

// ─────────────────────────────────────────────────────────────────────────────
// Tests — metadata
// ─────────────────────────────────────────────────────────────────────────────

describe('listar_tarefas — metadata', () => {
  it('tem o nome correcto', () => {
    expect(listarTarefas.name).toBe('listar_tarefas');
  });

  it('está no domínio tasks', () => {
    expect(listarTarefas.domain).toBe('tasks');
  });

  it('description menciona "listar" ou "ver"', () => {
    expect(listarTarefas.description.toLowerCase()).toMatch(/listar|ver/);
  });

  it('estimatedTokens = 100', () => {
    expect(listarTarefas.estimatedTokens).toBe(100);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Tests — input validation
// ─────────────────────────────────────────────────────────────────────────────

describe('listar_tarefas — input validation', () => {
  it('aceita input vazio (todos os filtros opcionais)', () => {
    expect(listarTarefas.inputSchema.safeParse({}).success).toBe(true);
  });

  it('aceita filtros completos', () => {
    expect(
      listarTarefas.inputSchema.safeParse({
        status: 'todo',
        dueDateFrom: '2026-06-01',
        dueDateTo: '2026-06-30',
        limit: 25,
      }).success,
    ).toBe(true);
  });

  it('rejeita status inválido', () => {
    expect(
      listarTarefas.inputSchema.safeParse({ status: 'pending' }).success,
    ).toBe(false);
  });

  it('rejeita limit > 50', () => {
    expect(listarTarefas.inputSchema.safeParse({ limit: 51 }).success).toBe(
      false,
    );
  });

  it('rejeita limit < 1', () => {
    expect(listarTarefas.inputSchema.safeParse({ limit: 0 }).success).toBe(false);
  });

  it('rejeita limit float', () => {
    expect(listarTarefas.inputSchema.safeParse({ limit: 5.5 }).success).toBe(
      false,
    );
  });

  it('rejeita dueDateFrom em formato errado', () => {
    expect(
      listarTarefas.inputSchema.safeParse({ dueDateFrom: '01/06/2026' }).success,
    ).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Tests — preview
// ─────────────────────────────────────────────────────────────────────────────

describe('listar_tarefas — preview', () => {
  const ctx = makeCtx(makeMockDb({ executes: [], insertReturns: [] }));

  it('preview sem filtros é genérico', () => {
    expect(listarTarefas.preview({}, ctx)).toBe('Listar tarefas');
  });

  it('preview com status inclui o filtro', () => {
    expect(listarTarefas.preview({ status: 'todo' }, ctx)).toContain('status=todo');
  });

  it('preview com intervalo de datas inclui ambas', () => {
    const out = listarTarefas.preview(
      { dueDateFrom: '2026-06-01', dueDateTo: '2026-06-30' },
      ctx,
    );
    expect(out).toContain('2026-06-01');
    expect(out).toContain('2026-06-30');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Tests — execute (SELECT + filtros + limit)
// ─────────────────────────────────────────────────────────────────────────────

describe('listar_tarefas — execute', () => {
  it('sem filtros — SELECT com default limit 10 + exclusão archived', async () => {
    const state: MockState = {
      executes: [],
      insertReturns: [
        [
          sampleRow(TASK_A, { title: 'tarefa 1' }),
          sampleRow(TASK_B, { title: 'tarefa 2' }),
        ],
      ],
    };
    const ctx = makeCtx(makeMockDb(state));
    const out = await listarTarefas.execute({}, ctx);

    expect(out.tasks.length).toBe(2);
    expect(out.count).toBe(2);
    // SQL deve excluir archived por default.
    expect(state.executes[0]).toMatch(/status\s*!=\s*'archived'/i);
    expect(state.executes[0]).toMatch(/limit/i);
  });

  it('filtro status=done — SELECT WHERE status=done (não exclui archived default)', async () => {
    const state: MockState = {
      executes: [],
      insertReturns: [[sampleRow(TASK_A, { status: 'done' })]],
    };
    const ctx = makeCtx(makeMockDb(state));
    await listarTarefas.execute({ status: 'done' }, ctx);

    // Quando o utilizador especifica status, usa-se = (não !=).
    // O valor 'done' é bind param (Drizzle parametriza) — o sqlText captura
    // o cast `::task_status` em chunk SQL puro.
    expect(state.executes[0]).toMatch(/status\s*=.*task_status/);
    // Não deve usar default exclusion archived.
    expect(state.executes[0]).not.toMatch(/status\s*!=\s*'archived'/);
  });

  it('filtro dueDateFrom — SELECT inclui due_date >=', async () => {
    const state: MockState = { executes: [], insertReturns: [[]] };
    const ctx = makeCtx(makeMockDb(state));
    await listarTarefas.execute({ dueDateFrom: '2026-06-01' }, ctx);

    expect(state.executes[0]).toMatch(/due_date\s*>=/i);
  });

  it('filtro dueDateTo — SELECT inclui due_date <=', async () => {
    const state: MockState = { executes: [], insertReturns: [[]] };
    const ctx = makeCtx(makeMockDb(state));
    await listarTarefas.execute({ dueDateTo: '2026-06-30' }, ctx);

    expect(state.executes[0]).toMatch(/due_date\s*<=/i);
  });

  it('filtros combinados são todos aplicados', async () => {
    const state: MockState = { executes: [], insertReturns: [[]] };
    const ctx = makeCtx(makeMockDb(state));
    await listarTarefas.execute(
      {
        status: 'todo',
        dueDateFrom: '2026-06-01',
        dueDateTo: '2026-06-30',
        limit: 5,
      },
      ctx,
    );

    const sql = state.executes[0] ?? '';
    // Drizzle parametriza valores enum/date → o sqlText apenas mostra o cast.
    expect(sql).toMatch(/status\s*=.*task_status/);
    expect(sql).toMatch(/due_date\s*>=/);
    expect(sql).toMatch(/due_date\s*<=/);
    expect(sql).toMatch(/limit/i);
  });

  it('limit custom 25 respeitado', async () => {
    const state: MockState = { executes: [], insertReturns: [[]] };
    const ctx = makeCtx(makeMockDb(state));
    await listarTarefas.execute({ limit: 25 }, ctx);
    expect(state.executes[0]).toMatch(/limit/i);
  });

  it('ORDER BY due_date asc nulls last, created_at desc', async () => {
    const state: MockState = { executes: [], insertReturns: [[]] };
    const ctx = makeCtx(makeMockDb(state));
    await listarTarefas.execute({}, ctx);

    expect(state.executes[0]?.toLowerCase()).toContain(
      'order by due_date asc nulls last',
    );
    expect(state.executes[0]?.toLowerCase()).toContain('created_at desc');
  });

  it('output mapeia colunas snake_case → camelCase', async () => {
    const state: MockState = {
      executes: [],
      insertReturns: [
        [
          sampleRow(TASK_A, {
            title: 'comprar leite',
            due_date: '2026-06-15',
            priority: 'high',
            status: 'doing',
          }),
        ],
      ],
    };
    const ctx = makeCtx(makeMockDb(state));
    const out = await listarTarefas.execute({}, ctx);

    expect(out.tasks[0]).toEqual({
      id: TASK_A,
      title: 'comprar leite',
      dueDate: '2026-06-15',
      priority: 'high',
      status: 'doing',
    });
  });

  it('count = tasks.length', async () => {
    const state: MockState = {
      executes: [],
      insertReturns: [[sampleRow(TASK_A), sampleRow(TASK_B), sampleRow(TASK_C)]],
    };
    const ctx = makeCtx(makeMockDb(state));
    const out = await listarTarefas.execute({}, ctx);
    expect(out.count).toBe(3);
    expect(out.tasks.length).toBe(3);
  });

  it('zero results retorna count=0 e tasks=[]', async () => {
    const state: MockState = { executes: [], insertReturns: [[]] };
    const ctx = makeCtx(makeMockDb(state));
    const out = await listarTarefas.execute({}, ctx);
    expect(out.count).toBe(0);
    expect(out.tasks.length).toBe(0);
  });

  it('output schema valida o resultado', async () => {
    const state: MockState = {
      executes: [],
      insertReturns: [[sampleRow(TASK_A)]],
    };
    const ctx = makeCtx(makeMockDb(state));
    const out = await listarTarefas.execute({}, ctx);
    expect(listarTarefas.outputSchema.safeParse(out).success).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Tests — reverse() sentinela _noop (R1b v1.1)
// ─────────────────────────────────────────────────────────────────────────────

describe('listar_tarefas — reverse() sentinela _noop (R1b v1.1)', () => {
  const ctx = makeCtx(makeMockDb({ executes: [], insertReturns: [] }));

  it('reverse() retorna kind=delete_row table=_noop', async () => {
    const reverseOp = await listarTarefas.reverse(
      { tasks: [], count: 0 },
      ctx,
    );
    expect(reverseOp.kind).toBe('delete_row');
    if (reverseOp.kind === 'delete_row') {
      expect(reverseOp.table).toBe('_noop');
    }
  });

  it('reverse() id é UUID válido (passa ReverseOpDeleteRowSchema)', async () => {
    const reverseOp = await listarTarefas.reverse(
      { tasks: [], count: 0 },
      ctx,
    );
    // Crítico: schema Zod do contract aceita o sentinela.
    expect(ReverseOpDeleteRowSchema.safeParse(reverseOp).success).toBe(true);
  });

  it('reverse() passa ReverseOpPayloadSchema (geral)', async () => {
    const reverseOp = await listarTarefas.reverse(
      { tasks: [], count: 0 },
      ctx,
    );
    expect(ReverseOpPayloadSchema.safeParse(reverseOp).success).toBe(true);
  });

  it('reverse() id é UUID diferente entre chamadas (randomUUID)', async () => {
    const op1 = await listarTarefas.reverse({ tasks: [], count: 0 }, ctx);
    const op2 = await listarTarefas.reverse({ tasks: [], count: 0 }, ctx);
    if (op1.kind === 'delete_row' && op2.kind === 'delete_row') {
      expect(op1.id).not.toBe(op2.id);
    }
  });
});
