/**
 * Testes para `atualizar_tarefa` tool — resolução (taskId/fuzzy), UPDATE parcial,
 * snapshot snake_case (PO-FIX-1), reverse_op restore_row, R-2.14.5 completedAt,
 * RLS isolation, Zod validation.
 *
 * Trace: Story 2.14 AC1 + AC12.
 *
 * Padrão de mocking: igual a `completar-tarefa.test.ts` (Story 3.8).
 */
import { describe, expect, it, vi } from 'vitest';

import type {
  DrizzleDbClient,
  ToolExecutionContext,
} from '@/contracts';
import { ToolExecutionError } from '@/errors';

import { atualizarTarefa } from '../atualizar-tarefa';

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
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

interface CapturedExecute {
  readonly sqlText: string;
}

interface MockState {
  executes: CapturedExecute[];
  insertReturns: ReadonlyArray<ReadonlyArray<unknown>>;
}

function captureSqlText(query: unknown): string {
  let sqlText = '';
  const walk = (node: unknown): void => {
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
  };
  walk(query);
  return sqlText;
}

function makeMockDb(state: MockState): DrizzleDbClient {
  let i = 0;
  const exec = vi.fn(async (query: unknown) => {
    state.executes.push({ sqlText: captureSqlText(query) });
    const r = state.insertReturns[i] ?? [];
    i += 1;
    return r;
  });
  return {
    transaction: vi.fn(async <T,>(fn: (tx: DrizzleDbClient) => Promise<T>) =>
      fn(makeMockDb(state)),
    ) as unknown as DrizzleDbClient['transaction'],
    insert: vi.fn(),
    execute: exec as unknown as DrizzleDbClient['execute'],
  };
}

const TASK_ID = '11111111-2222-4333-8444-555555555555';
const TASK_ID_B = 'bbbbbbbb-cccc-4ddd-8eee-ffffffffffff';
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

function resolvedRow(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: TASK_ID,
    title: 'dentista',
    description: 'consulta anual',
    due_date: '2026-06-20',
    priority: 'medium',
    status: 'todo',
    completed_at: null,
    match_count: 1,
    ...overrides,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Metadata
// ─────────────────────────────────────────────────────────────────────────────

describe('atualizar_tarefa — metadata', () => {
  it('nome correcto', () => {
    expect(atualizarTarefa.name).toBe('atualizar_tarefa');
  });
  it('domínio tasks', () => {
    expect(atualizarTarefa.domain).toBe('tasks');
  });
  it('estimatedTokens = 90', () => {
    expect(atualizarTarefa.estimatedTokens).toBe(90);
  });
  it('description menciona editar/alterar', () => {
    expect(atualizarTarefa.description.toLowerCase()).toMatch(/editar|alterar|modificar/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Validation
// ─────────────────────────────────────────────────────────────────────────────

describe('atualizar_tarefa — input validation', () => {
  it('rejeita sem identificador', () => {
    expect(atualizarTarefa.inputSchema.safeParse({ newTitle: 'X' }).success).toBe(false);
  });
  it('rejeita sem nenhum campo new*', () => {
    expect(atualizarTarefa.inputSchema.safeParse({ taskId: TASK_ID }).success).toBe(false);
  });
  it('aceita taskId + newPriority', () => {
    expect(
      atualizarTarefa.inputSchema.safeParse({ taskId: TASK_ID, newPriority: 'high' }).success,
    ).toBe(true);
  });
  it('aceita taskTitle + newDueDate', () => {
    expect(
      atualizarTarefa.inputSchema.safeParse({ taskTitle: 'dentista', newDueDate: '2026-06-27' }).success,
    ).toBe(true);
  });
  it('rejeita newDueDate em formato inválido', () => {
    expect(
      atualizarTarefa.inputSchema.safeParse({ taskId: TASK_ID, newDueDate: '27/06/2026' }).success,
    ).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// execute — taskId directo
// ─────────────────────────────────────────────────────────────────────────────

describe('atualizar_tarefa — execute via taskId', () => {
  it('resolve por taskId e UPDATE apenas dos campos fornecidos', async () => {
    const state: MockState = {
      executes: [],
      insertReturns: [[resolvedRow()], [{ id: TASK_ID }]],
    };
    const ctx = makeCtx(makeMockDb(state));

    const out = await atualizarTarefa.execute(
      { taskId: TASK_ID, newPriority: 'high', newDueDate: '2026-06-27' },
      ctx,
    );

    expect(out.taskId).toBe(TASK_ID);
    expect(out.updatedFields).toContain('priority');
    expect(out.updatedFields).toContain('due_date');
    expect(out.updatedFields).not.toContain('title');
    expect(atualizarTarefa.outputSchema.safeParse(out).success).toBe(true);

    const updateSql = state.executes[1]?.sqlText ?? '';
    expect(updateSql).toMatch(/update tasks/i);
    expect(updateSql).toMatch(/priority =/i);
    expect(updateSql).toMatch(/due_date =/i);
    expect(updateSql).toMatch(/updated_at = now\(\)/i);
  });

  it('snapshot captura APENAS campos alterados, em snake_case (PO-FIX-1)', async () => {
    const state: MockState = {
      executes: [],
      insertReturns: [
        [resolvedRow({ priority: 'low', due_date: '2026-06-20' })],
        [{ id: TASK_ID }],
      ],
    };
    const ctx = makeCtx(makeMockDb(state));

    const out = await atualizarTarefa.execute(
      { taskId: TASK_ID, newPriority: 'high' },
      ctx,
    );

    // snapshot só tem priority (snake_case key), não due_date nem title.
    expect(out.snapshot).toEqual({ priority: 'low' });
    expect(Object.keys(out.snapshot)).not.toContain('description');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// fuzzy match
// ─────────────────────────────────────────────────────────────────────────────

describe('atualizar_tarefa — fuzzy match', () => {
  it('resolve fuzzy match único', async () => {
    const state: MockState = {
      executes: [],
      insertReturns: [[resolvedRow()], [{ id: TASK_ID }]],
    };
    const ctx = makeCtx(makeMockDb(state));
    const out = await atualizarTarefa.execute(
      { taskTitle: 'dentista', newStatus: 'doing' },
      ctx,
    );
    expect(out.taskId).toBe(TASK_ID);
    expect(out.warnings).toBeUndefined();
    expect(state.executes[0]?.sqlText.toLowerCase()).toContain('ilike');
  });

  it('múltiplos matches → usa mais recente + warnings PT-PT', async () => {
    const state: MockState = {
      executes: [],
      insertReturns: [
        [resolvedRow({ id: TASK_ID_B, title: 'dentista urgente', match_count: 3 })],
        [{ id: TASK_ID_B }],
      ],
    };
    const ctx = makeCtx(makeMockDb(state));
    const out = await atualizarTarefa.execute(
      { taskTitle: 'dentista', newPriority: 'high' },
      ctx,
    );
    expect(out.taskId).toBe(TASK_ID_B);
    expect(out.warnings?.[0]).toMatch(/3 tarefas/);
  });

  it('zero matches → ToolExecutionError PT-PT', async () => {
    const state: MockState = { executes: [], insertReturns: [[]] };
    const ctx = makeCtx(makeMockDb(state));
    await expect(
      atualizarTarefa.execute({ taskTitle: 'inexistente', newPriority: 'high' }, ctx),
    ).rejects.toBeInstanceOf(ToolExecutionError);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// R-2.14.5 — completedAt coerente com status
// ─────────────────────────────────────────────────────────────────────────────

describe('atualizar_tarefa — completedAt coerência (R-2.14.5)', () => {
  it('newStatus=done → completed_at = now() no UPDATE', async () => {
    const state: MockState = {
      executes: [],
      insertReturns: [[resolvedRow({ status: 'todo', completed_at: null })], [{ id: TASK_ID }]],
    };
    const ctx = makeCtx(makeMockDb(state));
    const out = await atualizarTarefa.execute({ taskId: TASK_ID, newStatus: 'done' }, ctx);
    const updateSql = state.executes[1]?.sqlText ?? '';
    expect(updateSql).toMatch(/completed_at = now\(\)/i);
    // snapshot guarda o status e completed_at anteriores (snake_case).
    expect(out.snapshot.status).toBe('todo');
    expect(out.snapshot.completed_at).toBeNull();
  });

  it('newStatus=todo (reabrir) → completed_at = null no UPDATE', async () => {
    const state: MockState = {
      executes: [],
      insertReturns: [
        [resolvedRow({ status: 'done', completed_at: '2026-06-19T10:00:00Z' })],
        [{ id: TASK_ID }],
      ],
    };
    const ctx = makeCtx(makeMockDb(state));
    const out = await atualizarTarefa.execute({ taskId: TASK_ID, newStatus: 'todo' }, ctx);
    const updateSql = state.executes[1]?.sqlText ?? '';
    expect(updateSql).toMatch(/completed_at = null/i);
    expect(out.snapshot.completed_at).toBe('2026-06-19T10:00:00Z');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// reverse + preview
// ─────────────────────────────────────────────────────────────────────────────

describe('atualizar_tarefa — reverse() restore_row', () => {
  const ctx = makeCtx(makeMockDb({ executes: [], insertReturns: [] }));

  it('reverse() retorna restore_row com snapshot snake_case', async () => {
    const reverseOp = await atualizarTarefa.reverse(
      { taskId: TASK_ID, updatedFields: ['priority'], snapshot: { priority: 'low' } },
      ctx,
    );
    expect(reverseOp).toMatchObject({ kind: 'restore_row', table: 'tasks', id: TASK_ID });
    if (reverseOp.kind === 'restore_row') {
      expect(reverseOp.snapshot).toEqual({ priority: 'low' });
    }
  });
});

describe('atualizar_tarefa — preview', () => {
  const ctx = makeCtx(makeMockDb({ executes: [], insertReturns: [] }));
  it('preview PT-PT lista campos a alterar', () => {
    const out = atualizarTarefa.preview(
      { taskTitle: 'dentista', newDueDate: '2026-06-27', newPriority: 'high' },
      ctx,
    );
    expect(out).toContain('dentista');
    expect(out.toLowerCase()).toContain('actualizar');
    expect(out).toContain('2026-06-27');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// RLS isolation
// ─────────────────────────────────────────────────────────────────────────────

describe('atualizar_tarefa — RLS isolation', () => {
  it('tarefa de outro household não é encontrada (mock vazio) → erro', async () => {
    const state: MockState = { executes: [], insertReturns: [[]] };
    const ctx = makeCtx(makeMockDb(state));
    await expect(
      atualizarTarefa.execute({ taskId: TASK_ID, newPriority: 'high' }, ctx),
    ).rejects.toBeInstanceOf(ToolExecutionError);
  });

  it('input do utilizador NUNCA injecta household_id (Zod strip)', () => {
    const parsed = atualizarTarefa.inputSchema.safeParse({
      taskId: TASK_ID,
      newPriority: 'high',
      household_id: 'fake',
    });
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data).not.toHaveProperty('household_id');
    }
  });
});
