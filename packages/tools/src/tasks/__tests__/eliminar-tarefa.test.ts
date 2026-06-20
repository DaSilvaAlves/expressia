/**
 * Testes para `eliminar_tarefa` tool — preview obrigatório (needsConfirmation),
 * DELETE efectivo + snapshot completo snake_case, reverse_op reinsert_row (FIX-1),
 * fuzzy match, RLS isolation.
 *
 * Trace: Story 2.14 AC2 + AC12.
 */
import { describe, expect, it, vi } from 'vitest';

import type {
  DrizzleDbClient,
  ToolExecutionContext,
} from '@/contracts';
import { ToolExecutionError } from '@/errors';

import { eliminarTarefa } from '../eliminar-tarefa';

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
    transaction: vi.fn() as unknown as DrizzleDbClient['transaction'],
    insert: vi.fn(),
    execute: exec as unknown as DrizzleDbClient['execute'],
  };
}

const TASK_ID = '11111111-2222-4333-8444-555555555555';
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
    household_id: HOUSEHOLD_ID,
    created_by_user_id: USER_ID,
    assigned_to_user_id: null,
    title: 'ir ao ginásio',
    description: null,
    due_date: '2026-06-25',
    due_time: null,
    priority: 'medium',
    status: 'todo',
    kanban_column_id: null,
    kanban_position: 0,
    project: null,
    recurrence_id: null,
    is_recurrence_template: false,
    completed_at: null,
    created_at: '2026-06-19T08:00:00Z',
    match_count: 1,
    ...overrides,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Metadata
// ─────────────────────────────────────────────────────────────────────────────

describe('eliminar_tarefa — metadata', () => {
  it('nome correcto', () => {
    expect(eliminarTarefa.name).toBe('eliminar_tarefa');
  });
  it('domínio tasks', () => {
    expect(eliminarTarefa.domain).toBe('tasks');
  });
  it('estimatedTokens = 90', () => {
    expect(eliminarTarefa.estimatedTokens).toBe(90);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Preview obrigatório (DP-2.14.B)
// ─────────────────────────────────────────────────────────────────────────────

describe('eliminar_tarefa — preview obrigatório', () => {
  it('sem confirmed=true → needsConfirmation true, sem DELETE, sem reverse_op', async () => {
    const state: MockState = { executes: [], insertReturns: [[resolvedRow()]] };
    const ctx = makeCtx(makeMockDb(state));

    const out = await eliminarTarefa.execute({ taskTitle: 'ginásio' }, ctx);

    expect(out.needsConfirmation).toBe(true);
    expect(out.taskId).toBe(TASK_ID);
    expect(out.snapshot).toBeUndefined();
    // Só 1 execute (o SELECT de resolução) — nenhum DELETE.
    expect(state.executes.length).toBe(1);
    expect(state.executes.some((e) => /delete from tasks/i.test(e.sqlText))).toBe(false);
  });

  it('confirmed=false explícito → needsConfirmation true', async () => {
    const state: MockState = { executes: [], insertReturns: [[resolvedRow()]] };
    const ctx = makeCtx(makeMockDb(state));
    const out = await eliminarTarefa.execute(
      { taskId: TASK_ID, confirmed: false },
      ctx,
    );
    expect(out.needsConfirmation).toBe(true);
  });

  it('preview() contém "CONFIRMAR"', () => {
    const ctx = makeCtx(makeMockDb({ executes: [], insertReturns: [] }));
    expect(eliminarTarefa.preview({ taskTitle: 'ginásio' }, ctx)).toContain('CONFIRMAR');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// DELETE efectivo + snapshot
// ─────────────────────────────────────────────────────────────────────────────

describe('eliminar_tarefa — DELETE confirmado', () => {
  it('confirmed=true → DELETE efectivo + snapshot completo snake_case', async () => {
    const state: MockState = {
      executes: [],
      insertReturns: [[resolvedRow()], []],
    };
    const ctx = makeCtx(makeMockDb(state));

    const out = await eliminarTarefa.execute(
      { taskId: TASK_ID, confirmed: true },
      ctx,
    );

    expect(out.needsConfirmation).toBe(false);
    expect(out.snapshot).toBeDefined();
    // snapshot em snake_case (PO-FIX-1).
    expect(out.snapshot?.created_by_user_id).toBe(USER_ID);
    expect(out.snapshot?.due_date).toBe('2026-06-25');
    expect(out.snapshot?.is_recurrence_template).toBe(false);
    // id NÃO está no snapshot (engine injecta via op.id).
    expect(out.snapshot).not.toHaveProperty('id');

    expect(state.executes.length).toBe(2);
    expect(state.executes[1]?.sqlText).toMatch(/delete from tasks/i);
    expect(atualizarOutputValid(out)).toBe(true);
  });
});

function atualizarOutputValid(out: unknown): boolean {
  return eliminarTarefa.outputSchema.safeParse(out).success;
}

// ─────────────────────────────────────────────────────────────────────────────
// reverse() reinsert_row (FIX-1)
// ─────────────────────────────────────────────────────────────────────────────

describe('eliminar_tarefa — reverse() reinsert_row (FIX-1)', () => {
  const ctx = makeCtx(makeMockDb({ executes: [], insertReturns: [] }));

  it('reverse() retorna reinsert_row com id original + snapshot completo', async () => {
    const snapshot = { title: 'ginásio', household_id: HOUSEHOLD_ID };
    const reverseOp = await eliminarTarefa.reverse(
      { taskId: TASK_ID, title: 'ginásio', needsConfirmation: false, snapshot },
      ctx,
    );
    expect(reverseOp).toMatchObject({
      kind: 'reinsert_row',
      table: 'tasks',
      id: TASK_ID,
    });
    if (reverseOp.kind === 'reinsert_row') {
      expect(reverseOp.snapshot).toEqual(snapshot);
    }
  });

  it('reverse() com snapshot undefined → snapshot vazio (defensive)', async () => {
    const reverseOp = await eliminarTarefa.reverse(
      { taskId: TASK_ID, title: 'X', needsConfirmation: true },
      ctx,
    );
    if (reverseOp.kind === 'reinsert_row') {
      expect(reverseOp.snapshot).toEqual({});
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// fuzzy + RLS
// ─────────────────────────────────────────────────────────────────────────────

describe('eliminar_tarefa — fuzzy + RLS', () => {
  it('zero matches → ToolExecutionError PT-PT', async () => {
    const state: MockState = { executes: [], insertReturns: [[]] };
    const ctx = makeCtx(makeMockDb(state));
    await expect(
      eliminarTarefa.execute({ taskTitle: 'inexistente', confirmed: true }, ctx),
    ).rejects.toBeInstanceOf(ToolExecutionError);
  });

  it('múltiplos matches → usa mais recente + warning', async () => {
    const state: MockState = {
      executes: [],
      insertReturns: [[resolvedRow({ match_count: 2 })]],
    };
    const ctx = makeCtx(makeMockDb(state));
    const out = await eliminarTarefa.execute({ taskTitle: 'ginásio' }, ctx);
    expect(out.warnings?.[0]).toMatch(/2 tarefas/);
  });

  it('cross-household: mock vazio → não encontra', async () => {
    const state: MockState = { executes: [], insertReturns: [[]] };
    const ctx = makeCtx(makeMockDb(state));
    await expect(
      eliminarTarefa.execute({ taskId: TASK_ID, confirmed: true }, ctx),
    ).rejects.toBeInstanceOf(ToolExecutionError);
  });
});
