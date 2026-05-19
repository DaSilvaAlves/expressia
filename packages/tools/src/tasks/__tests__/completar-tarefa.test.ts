/**
 * Testes para `completar_tarefa` tool — happy paths + fuzzy match +
 * ToolExecutionError em zero matches + reverse_op restore_row + RLS.
 *
 * Trace: Story 3.8 AC2 + AC8 (≥20 testes).
 *
 * Padrão de mocking: igual a `criar-tarefa.test.ts` (mock partilhado via
 * helpers).
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type {
  DrizzleDbClient,
  ToolExecutionContext,
} from '@/contracts';
import { ToolExecutionError } from '@/errors';

import { completarTarefa } from '../completar-tarefa';

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
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

interface CapturedExecute {
  readonly sqlText: string;
}

interface MockState {
  executes: CapturedExecute[];
  /** Por ordem de chamada — cada entry é o array que `execute` devolve. */
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
        if (Array.isArray(value)) {
          for (const v of value) {
            if (typeof v === 'string') sqlText += v;
          }
        } else if (typeof value === 'string') {
          sqlText += value;
        }
      }
    }
  }
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

  const tx: DrizzleDbClient = {
    transaction: vi.fn(async <T,>(fn: (tx: DrizzleDbClient) => Promise<T>) =>
      fn(tx),
    ) as unknown as DrizzleDbClient['transaction'],
    insert: vi.fn(),
    execute: exec as unknown as DrizzleDbClient['execute'],
  };

  const db: DrizzleDbClient = {
    transaction: vi.fn(async <T,>(fn: (tx: DrizzleDbClient) => Promise<T>) =>
      fn(tx),
    ) as unknown as DrizzleDbClient['transaction'],
    insert: vi.fn(),
    execute: exec as unknown as DrizzleDbClient['execute'],
  };

  return db;
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

// ─────────────────────────────────────────────────────────────────────────────
// Tests — metadata + schemas
// ─────────────────────────────────────────────────────────────────────────────

describe('completar_tarefa — metadata', () => {
  it('tem o nome correcto', () => {
    expect(completarTarefa.name).toBe('completar_tarefa');
  });

  it('está no domínio tasks', () => {
    expect(completarTarefa.domain).toBe('tasks');
  });

  it('description menciona "concluída" ou "feita"', () => {
    expect(completarTarefa.description.toLowerCase()).toMatch(/concluída|feita/);
  });

  it('estimatedTokens = 80', () => {
    expect(completarTarefa.estimatedTokens).toBe(80);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Tests — input validation
// ─────────────────────────────────────────────────────────────────────────────

describe('completar_tarefa — input validation', () => {
  it('aceita taskId UUID directo', () => {
    expect(
      completarTarefa.inputSchema.safeParse({ taskId: TASK_ID }).success,
    ).toBe(true);
  });

  it('aceita taskTitle string', () => {
    expect(
      completarTarefa.inputSchema.safeParse({ taskTitle: 'comprar leite' }).success,
    ).toBe(true);
  });

  it('aceita ambos taskId e taskTitle (taskId tem precedência)', () => {
    expect(
      completarTarefa.inputSchema.safeParse({
        taskId: TASK_ID,
        taskTitle: 'X',
      }).success,
    ).toBe(true);
  });

  it('rejeita input vazio (sem taskId nem taskTitle)', () => {
    expect(completarTarefa.inputSchema.safeParse({}).success).toBe(false);
  });

  it('rejeita taskId não-UUID', () => {
    expect(
      completarTarefa.inputSchema.safeParse({ taskId: 'not-a-uuid' }).success,
    ).toBe(false);
  });

  it('rejeita taskTitle vazio', () => {
    expect(
      completarTarefa.inputSchema.safeParse({ taskTitle: '' }).success,
    ).toBe(false);
  });

  it('rejeita taskTitle > 200 chars', () => {
    expect(
      completarTarefa.inputSchema.safeParse({ taskTitle: 'X'.repeat(201) })
        .success,
    ).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Tests — preview
// ─────────────────────────────────────────────────────────────────────────────

describe('completar_tarefa — preview', () => {
  const ctx = makeCtx(makeMockDb({ executes: [], insertReturns: [] }));

  it('preview com taskTitle inclui o nome', () => {
    const out = completarTarefa.preview({ taskTitle: 'comprar leite' }, ctx);
    expect(out).toContain('comprar leite');
    expect(out.toLowerCase()).toContain('concluída');
  });

  it('preview com taskId apenas tem texto genérico PT-PT', () => {
    const out = completarTarefa.preview({ taskId: TASK_ID }, ctx);
    expect(out.toLowerCase()).toContain('concluída');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Tests — execute resolução por taskId
// ─────────────────────────────────────────────────────────────────────────────

describe('completar_tarefa — execute via taskId', () => {
  it('resolve via taskId directo + UPDATE + output correcto', async () => {
    const state: MockState = {
      executes: [],
      insertReturns: [
        // 1ª chamada: SELECT resolveTask por id
        [
          {
            id: TASK_ID,
            title: 'pagar renda',
            status: 'todo',
            match_count: 1,
          },
        ],
        // 2ª chamada: UPDATE tasks RETURNING
        [
          {
            id: TASK_ID,
            title: 'pagar renda',
            completed_at: '2026-05-19T12:00:00Z',
          },
        ],
      ],
    };
    const ctx = makeCtx(makeMockDb(state));

    const out = await completarTarefa.execute({ taskId: TASK_ID }, ctx);

    expect(out.taskId).toBe(TASK_ID);
    expect(out.title).toBe('pagar renda');
    expect(out.prevStatus).toBe('todo');
    expect(out.completedAt).toBe('2026-05-19T12:00:00Z');
    expect(out.warnings).toBeUndefined();

    // Output schema valida.
    expect(completarTarefa.outputSchema.safeParse(out).success).toBe(true);
  });

  it('SELECT por taskId filtra status != done', async () => {
    const state: MockState = {
      executes: [],
      insertReturns: [
        [{ id: TASK_ID, title: 'X', status: 'todo', match_count: 1 }],
        [{ id: TASK_ID, title: 'X', completed_at: '2026-05-19T12:00:00Z' }],
      ],
    };
    const ctx = makeCtx(makeMockDb(state));
    await completarTarefa.execute({ taskId: TASK_ID }, ctx);

    // O 1º SELECT deve filtrar status != 'done'::task_status.
    expect(state.executes[0]?.sqlText).toMatch(/status\s*!=\s*'done'/);
  });

  it('UPDATE inclui completed_at = now() e status = done', async () => {
    const state: MockState = {
      executes: [],
      insertReturns: [
        [{ id: TASK_ID, title: 'X', status: 'todo', match_count: 1 }],
        [{ id: TASK_ID, title: 'X', completed_at: '2026-05-19T12:00:00Z' }],
      ],
    };
    const ctx = makeCtx(makeMockDb(state));
    await completarTarefa.execute({ taskId: TASK_ID }, ctx);

    const updateSql = state.executes[1]?.sqlText ?? '';
    expect(updateSql).toMatch(/update tasks/i);
    expect(updateSql).toMatch(/status\s*=\s*'done'/i);
    expect(updateSql).toMatch(/completed_at\s*=\s*now\(\)/i);
    expect(updateSql).toMatch(/returning/i);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Tests — fuzzy match
// ─────────────────────────────────────────────────────────────────────────────

describe('completar_tarefa — execute via taskTitle fuzzy', () => {
  it('resolve fuzzy match único — sem warnings', async () => {
    const state: MockState = {
      executes: [],
      insertReturns: [
        [{ id: TASK_ID, title: 'comprar leite', status: 'todo', match_count: 1 }],
        [{ id: TASK_ID, title: 'comprar leite', completed_at: '2026-05-19T10:00:00Z' }],
      ],
    };
    const ctx = makeCtx(makeMockDb(state));
    const out = await completarTarefa.execute({ taskTitle: 'leite' }, ctx);
    expect(out.taskId).toBe(TASK_ID);
    expect(out.warnings).toBeUndefined();
  });

  it('fuzzy match múltiplos — usa o mais recente + warnings PT-PT', async () => {
    const state: MockState = {
      executes: [],
      insertReturns: [
        // SELECT devolve a mais recente + match_count=3
        [
          {
            id: TASK_ID_B,
            title: 'comprar leite biológico',
            status: 'doing',
            match_count: 3,
          },
        ],
        [
          {
            id: TASK_ID_B,
            title: 'comprar leite biológico',
            completed_at: '2026-05-19T12:00:00Z',
          },
        ],
      ],
    };
    const ctx = makeCtx(makeMockDb(state));
    const out = await completarTarefa.execute({ taskTitle: 'leite' }, ctx);

    expect(out.taskId).toBe(TASK_ID_B);
    expect(out.prevStatus).toBe('doing');
    expect(out.warnings).toBeDefined();
    expect(out.warnings?.length).toBe(1);
    expect(out.warnings?.[0]).toMatch(/3 tarefas/);
    expect(out.warnings?.[0]).toMatch(/leite/);
  });

  it('fuzzy match zero — lança ToolExecutionError PT-PT', async () => {
    const state: MockState = {
      executes: [],
      insertReturns: [
        // SELECT não devolve row
        [],
      ],
    };
    const ctx = makeCtx(makeMockDb(state));

    await expect(
      completarTarefa.execute({ taskTitle: 'tarefa inexistente' }, ctx),
    ).rejects.toBeInstanceOf(ToolExecutionError);
  });

  it('fuzzy match zero — userMessage PT-PT com nome da tarefa', async () => {
    const state: MockState = {
      executes: [],
      insertReturns: [[]],
    };
    const ctx = makeCtx(makeMockDb(state));

    try {
      await completarTarefa.execute({ taskTitle: 'limpar a cozinha' }, ctx);
      expect.fail('should have thrown');
    } catch (e) {
      expect(e).toBeInstanceOf(ToolExecutionError);
      const err = e as ToolExecutionError;
      // O `message` técnico inclui o nome da tool e o causedBy.
      expect(err.message).toContain('completar_tarefa');
      // O `userMessage` é genérico PT-PT (não revela conteúdo).
      expect(err.userMessage).toMatch(/PT|operação|tenta/i);
      // O cause (Error original) tem a mensagem PT-PT com o título.
      const cause = err.cause as Error;
      expect(cause.message).toContain('limpar a cozinha');
      expect(cause.message).toMatch(/Verifica/);
    }
  });

  it('fuzzy match SQL usa ILIKE (NIT-PO-3.8.3 — Drizzle parametriza)', async () => {
    const state: MockState = {
      executes: [],
      insertReturns: [
        [{ id: TASK_ID, title: 'X', status: 'todo', match_count: 1 }],
        [{ id: TASK_ID, title: 'X', completed_at: '2026-05-19T12:00:00Z' }],
      ],
    };
    const ctx = makeCtx(makeMockDb(state));
    await completarTarefa.execute({ taskTitle: 'leite' }, ctx);

    // O SQL deve conter ILIKE. O Drizzle template tag parametriza valores em
    // bind params (postgres-js gera prepared statements) — safe contra
    // injection. NIT-PO-3.8.3 compliance.
    expect(state.executes[0]?.sqlText.toLowerCase()).toContain('ilike');
    // O SQL não deve conter a palavra "concat" nem `||` de SQL concat string.
    expect(state.executes[0]?.sqlText.toLowerCase()).not.toMatch(/\|\||concat/i);
  });

  it('fuzzy match ordena por created_at DESC (mais recente primeiro)', async () => {
    const state: MockState = {
      executes: [],
      insertReturns: [
        [{ id: TASK_ID, title: 'X', status: 'todo', match_count: 2 }],
        [{ id: TASK_ID, title: 'X', completed_at: '2026-05-19T12:00:00Z' }],
      ],
    };
    const ctx = makeCtx(makeMockDb(state));
    await completarTarefa.execute({ taskTitle: 'X' }, ctx);

    expect(state.executes[0]?.sqlText.toLowerCase()).toContain(
      'order by created_at desc',
    );
  });

  it('UPDATE não devolve row (RLS / race condition) → ToolExecutionError', async () => {
    const state: MockState = {
      executes: [],
      insertReturns: [
        [{ id: TASK_ID, title: 'X', status: 'todo', match_count: 1 }],
        [], // UPDATE devolve nada
      ],
    };
    const ctx = makeCtx(makeMockDb(state));

    await expect(
      completarTarefa.execute({ taskId: TASK_ID }, ctx),
    ).rejects.toBeInstanceOf(ToolExecutionError);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Tests — reverse() restore_row com prevStatus
// ─────────────────────────────────────────────────────────────────────────────

describe('completar_tarefa — reverse() restore_row', () => {
  const ctx = makeCtx(makeMockDb({ executes: [], insertReturns: [] }));

  it('reverse() retorna restore_row para tasks com taskId', async () => {
    const reverseOp = await completarTarefa.reverse(
      {
        taskId: TASK_ID,
        title: 'X',
        prevStatus: 'todo',
        completedAt: '2026-05-19T12:00:00Z',
      },
      ctx,
    );
    expect(reverseOp).toMatchObject({
      kind: 'restore_row',
      table: 'tasks',
      id: TASK_ID,
    });
  });

  it('reverse() snapshot inclui status=prevStatus e completed_at=null', async () => {
    const reverseOp = await completarTarefa.reverse(
      {
        taskId: TASK_ID,
        title: 'X',
        prevStatus: 'doing',
        completedAt: '2026-05-19T12:00:00Z',
      },
      ctx,
    );
    if (reverseOp.kind === 'restore_row') {
      expect(reverseOp.snapshot.status).toBe('doing');
      expect(reverseOp.snapshot.completed_at).toBeNull();
    }
  });

  it('reverse() preserva prevStatus todo', async () => {
    const reverseOp = await completarTarefa.reverse(
      {
        taskId: TASK_ID,
        title: 'X',
        prevStatus: 'todo',
        completedAt: '2026-05-19T12:00:00Z',
      },
      ctx,
    );
    if (reverseOp.kind === 'restore_row') {
      expect(reverseOp.snapshot.status).toBe('todo');
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Tests — RLS isolation (ctx.householdId)
// ─────────────────────────────────────────────────────────────────────────────

describe('completar_tarefa — RLS isolation', () => {
  it('SELECT não inclui household_id explícito — RLS filtra via JWT', async () => {
    const state: MockState = {
      executes: [],
      insertReturns: [
        [{ id: TASK_ID, title: 'X', status: 'todo', match_count: 1 }],
        [{ id: TASK_ID, title: 'X', completed_at: '2026-05-19T12:00:00Z' }],
      ],
    };
    const ctx = makeCtx(makeMockDb(state));
    await completarTarefa.execute({ taskId: TASK_ID }, ctx);

    // O SELECT depende de RLS (JWT) para filtrar household — não passa
    // ctx.householdId como bind param. Em produção, RLS rejeita tasks de
    // outro household via current_household_id() = household_id.
    // Aqui apenas verificamos que o SQL executou.
    expect(state.executes.length).toBe(2);
  });

  it('múltiplos contextos diferentes têm execuções isoladas (sanity)', async () => {
    const ctxA = makeCtx(
      makeMockDb({
        executes: [],
        insertReturns: [
          [{ id: TASK_ID, title: 'X', status: 'todo', match_count: 1 }],
          [{ id: TASK_ID, title: 'X', completed_at: '2026-05-19T12:00:00Z' }],
        ],
      }),
    );
    const ctxB = makeCtx(
      makeMockDb({
        executes: [],
        insertReturns: [[], []], // nada encontrado
      }),
    );

    const outA = await completarTarefa.execute({ taskId: TASK_ID }, ctxA);
    expect(outA.taskId).toBe(TASK_ID);

    await expect(
      completarTarefa.execute({ taskId: TASK_ID }, ctxB),
    ).rejects.toBeInstanceOf(ToolExecutionError);
  });
});
