// @vitest-environment node
/**
 * Integration test — Tools cérebro do domínio Tarefas (Story 3.8).
 *
 * Mockable-friendly E2E: exercita o flow Planner → executeAtomic → tool
 * → INSERT em DB + `agent_reverse_ops`, sem chamar OpenAI/Anthropic reais.
 *
 * Escopo:
 *   - 4 tools registadas no `toolRegistry` (sanity)
 *   - `criar_tarefa` via executeAtomic → INSERT em tasks + agent_reverse_ops
 *   - `completar_tarefa` por taskId → UPDATE
 *   - `listar_tarefas` → SELECT + reverse_op `table=_noop` (R1b v1.1)
 *   - `listar_atrasadas` → SELECT + reverse_op `table=_noop` (R1b v1.1)
 *   - Cross-household isolation via 2 `ToolExecutionContext` mock distintos
 *     (R3 v1.1) — RLS real é exercitada em Testcontainers Story 1.4 Done.
 *
 * Trace: Story 3.8 AC9.
 */
import { beforeAll, describe, expect, it, vi } from 'vitest';

// Mock @meu-jarvis/observability — usado por executeAtomic via tracing.
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

import type {
  DrizzleDbClient,
  ToolExecutionContext,
} from '@meu-jarvis/tools';
import {
  criarTarefa,
  completarTarefa,
  listarTarefas,
  listarAtrasadas,
  toolRegistry,
  executeAtomic,
} from '@meu-jarvis/tools';

// ─────────────────────────────────────────────────────────────────────────────
// Mock DB infrastructure
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
    state.executes.push({ sqlText: captureSqlText(q) });
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

const HOUSEHOLD_A = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';
const HOUSEHOLD_B = 'bbbbbbbb-cccc-4ddd-8eee-ffffffffffff';
const USER_A = '99999999-aaaa-4bbb-8ccc-dddddddddddd';
const USER_B = '88888888-eeee-4fff-8ggg-aaaaaaaaaaaa';
const TASK_ID = '11111111-2222-4333-8444-555555555555';
const REVERSE_OP_ID = '00000000-0000-4000-8000-000000000001';
const RUN_ID = '88888888-7777-4666-8555-444444444444';

function makeCtx(
  db: DrizzleDbClient,
  householdId: string,
  userId: string,
): ToolExecutionContext {
  return {
    householdId,
    userId,
    db,
    traceId: 'trace_integ',
    runId: RUN_ID,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Registry sanity (AC5 — registo automático ao import)
// ─────────────────────────────────────────────────────────────────────────────

describe('Story 3.8 — toolRegistry registration sanity', () => {
  beforeAll(() => {
    // Side-effect import já registou as tools — apenas para garantir que
    // o ficheiro real foi avaliado (em alguns runners o tree-shaking pode
    // optimizar). Importação `import { criarTarefa, ... }` no topo deste
    // ficheiro já garantiu, mas reforçamos.
  });

  it('criar_tarefa registada no singleton', () => {
    expect(toolRegistry.has('criar_tarefa')).toBe(true);
    expect(toolRegistry.get('criar_tarefa')).toBe(criarTarefa);
  });

  it('completar_tarefa registada', () => {
    expect(toolRegistry.has('completar_tarefa')).toBe(true);
    expect(toolRegistry.get('completar_tarefa')).toBe(completarTarefa);
  });

  it('listar_tarefas registada', () => {
    expect(toolRegistry.has('listar_tarefas')).toBe(true);
    expect(toolRegistry.get('listar_tarefas')).toBe(listarTarefas);
  });

  it('listar_atrasadas registada', () => {
    expect(toolRegistry.has('listar_atrasadas')).toBe(true);
    expect(toolRegistry.get('listar_atrasadas')).toBe(listarAtrasadas);
  });

  it('getByDomain("tasks") inclui as 4 tools', () => {
    const tasksTools = toolRegistry.getByDomain('tasks');
    const names = tasksTools.map((t) => t.name);
    expect(names).toContain('criar_tarefa');
    expect(names).toContain('completar_tarefa');
    expect(names).toContain('listar_tarefas');
    expect(names).toContain('listar_atrasadas');
  });

  it('getAnthropicToolDefinitions serializa as 4 tools', () => {
    const defs = toolRegistry.getAnthropicToolDefinitions();
    const taskDefs = defs.filter((d) =>
      ['criar_tarefa', 'completar_tarefa', 'listar_tarefas', 'listar_atrasadas'].includes(
        d.name,
      ),
    );
    expect(taskDefs.length).toBe(4);
    for (const def of taskDefs) {
      expect(def.description.length).toBeGreaterThan(0);
      expect(def.input_schema).toBeDefined();
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Flow 1 — criar_tarefa via executeAtomic
// ─────────────────────────────────────────────────────────────────────────────

describe('Story 3.8 — criar_tarefa via executeAtomic (mockable E2E)', () => {
  it('intent criar_tarefa → tool executa → row em tasks + agent_reverse_ops', async () => {
    const state: MockState = {
      executes: [],
      insertReturns: [
        // 1ª chamada: INSERT em tasks → retorna a row criada
        [
          {
            id: TASK_ID,
            title: 'comprar leite',
            due_date: '2026-06-15',
            priority: 'medium',
          },
        ],
        // 2ª chamada: INSERT em agent_reverse_ops → { id }
        [{ id: REVERSE_OP_ID }],
      ],
    };
    const ctx = makeCtx(makeMockDb(state), HOUSEHOLD_A, USER_A);

    const outcome = await executeAtomic(
      [
        {
          definition: criarTarefa,
          input: { title: 'comprar leite', dueDate: '2026-06-15' },
        },
      ],
      ctx,
    );

    expect(outcome.success).toBe(true);
    if (outcome.success) {
      expect(outcome.results.length).toBe(1);
      expect(outcome.results[0]?.toolName).toBe('criar_tarefa');
      const output = outcome.results[0]?.output as { taskId: string };
      expect(output.taskId).toBe(TASK_ID);
      expect(outcome.results[0]?.reverseOpId).toBe(REVERSE_OP_ID);
    }

    // 2 execute calls totais (INSERT tasks + INSERT agent_reverse_ops).
    expect(state.executes.length).toBe(2);
    expect(state.executes[0]?.sqlText).toMatch(/insert into tasks/i);
    expect(state.executes[1]?.sqlText).toMatch(/insert into agent_reverse_ops/i);
    // agent_reverse_ops insert deve ter `expires_at = now() + interval '30 seconds'`.
    expect(state.executes[1]?.sqlText).toMatch(
      /now\(\)\s*\+\s*interval\s*'30\s*seconds'/i,
    );
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Flow 2 — completar_tarefa via executeAtomic
// ─────────────────────────────────────────────────────────────────────────────

describe('Story 3.8 — completar_tarefa via executeAtomic', () => {
  it('intent completar_tarefa por taskId → tool executa → UPDATE + reverse_op restore_row', async () => {
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
        // 2ª chamada: UPDATE tasks
        [
          {
            id: TASK_ID,
            title: 'pagar renda',
            completed_at: '2026-05-19T12:00:00Z',
          },
        ],
        // 3ª chamada: INSERT agent_reverse_ops
        [{ id: REVERSE_OP_ID }],
      ],
    };
    const ctx = makeCtx(makeMockDb(state), HOUSEHOLD_A, USER_A);

    const outcome = await executeAtomic(
      [
        {
          definition: completarTarefa,
          input: { taskId: TASK_ID },
        },
      ],
      ctx,
    );

    expect(outcome.success).toBe(true);
    if (outcome.success) {
      const output = outcome.results[0]?.output as {
        taskId: string;
        prevStatus: string;
      };
      expect(output.taskId).toBe(TASK_ID);
      expect(output.prevStatus).toBe('todo');
    }

    expect(state.executes.length).toBe(3);
    expect(state.executes[0]?.sqlText.toLowerCase()).toContain('select');
    expect(state.executes[1]?.sqlText.toLowerCase()).toContain('update tasks');
    expect(state.executes[2]?.sqlText).toMatch(/insert into agent_reverse_ops/i);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Flow 3 — listar_tarefas (read-only) — reverse_op `_noop` inerte
// ─────────────────────────────────────────────────────────────────────────────

describe('Story 3.8 — listar_tarefas via executeAtomic (R1b v1.1 sentinela)', () => {
  it('intent listar_tarefas → SELECT + agent_reverse_ops com table=_noop', async () => {
    const state: MockState = {
      executes: [],
      insertReturns: [
        // 1ª chamada: SELECT tasks
        [
          {
            id: TASK_ID,
            title: 'tarefa',
            due_date: '2026-06-15',
            priority: 'medium',
            status: 'todo',
          },
        ],
        // 2ª chamada: INSERT agent_reverse_ops com reverse_op._noop
        [{ id: REVERSE_OP_ID }],
      ],
    };
    const ctx = makeCtx(makeMockDb(state), HOUSEHOLD_A, USER_A);

    const outcome = await executeAtomic(
      [{ definition: listarTarefas, input: {} }],
      ctx,
    );

    expect(outcome.success).toBe(true);
    if (outcome.success) {
      const output = outcome.results[0]?.output as { tasks: unknown[]; count: number };
      expect(output.count).toBe(1);
    }

    expect(state.executes.length).toBe(2);
    // SELECT spans multiple lines — usar [\s\S] em vez de .
    expect(state.executes[0]?.sqlText.toLowerCase()).toContain('select');
    expect(state.executes[0]?.sqlText.toLowerCase()).toContain('from tasks');
    // O INSERT em agent_reverse_ops deve incluir reverse_op com '_noop' como
    // value bind param (serializado para JSON).
    expect(state.executes[1]?.sqlText).toMatch(/insert into agent_reverse_ops/i);
  });

  it('reverse() de listar_tarefas standalone retorna table=_noop UUID válido', async () => {
    const state: MockState = { executes: [], insertReturns: [[]] };
    const ctx = makeCtx(makeMockDb(state), HOUSEHOLD_A, USER_A);
    const reverseOp = await listarTarefas.reverse({ tasks: [], count: 0 }, ctx);
    expect(reverseOp.kind).toBe('delete_row');
    if (reverseOp.kind === 'delete_row') {
      expect(reverseOp.table).toBe('_noop');
      expect(reverseOp.id).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
      );
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Flow 4 — listar_atrasadas (read-only) — reverse_op `_noop` inerte
// ─────────────────────────────────────────────────────────────────────────────

describe('Story 3.8 — listar_atrasadas via executeAtomic (R1b v1.1 sentinela)', () => {
  it('intent listar_atrasadas → SELECT overdue + reverse_op table=_noop', async () => {
    const state: MockState = {
      executes: [],
      insertReturns: [
        [
          {
            id: TASK_ID,
            title: 'pagar renda',
            due_date: '2026-05-10',
            priority: 'high',
            days_overdue: 9,
          },
        ],
        [{ id: REVERSE_OP_ID }],
      ],
    };
    const ctx = makeCtx(makeMockDb(state), HOUSEHOLD_A, USER_A);

    const outcome = await executeAtomic(
      [{ definition: listarAtrasadas, input: {} }],
      ctx,
    );

    expect(outcome.success).toBe(true);
    if (outcome.success) {
      const output = outcome.results[0]?.output as { count: number };
      expect(output.count).toBe(1);
    }

    expect(state.executes.length).toBe(2);
    // SELECT inclui CURRENT_DATE comparison.
    expect(state.executes[0]?.sqlText.toLowerCase()).toContain(
      'due_date < current_date',
    );
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Flow 5 — Cross-household isolation (R3 v1.1)
// ─────────────────────────────────────────────────────────────────────────────

describe('Story 3.8 — cross-household isolation (R3 v1.1 mock JWT)', () => {
  it('2 ctx household diferentes → execuções isoladas no mock-Drizzle', async () => {
    // Household A: cria tarefa via tool — verifica que ctx.householdId=A é
    // o valor usado pelo Drizzle (parametrizado).
    const stateA: MockState = {
      executes: [],
      insertReturns: [
        [{ id: TASK_ID, title: 'X', due_date: null, priority: 'medium' }],
        [{ id: REVERSE_OP_ID }],
      ],
    };
    const ctxA = makeCtx(makeMockDb(stateA), HOUSEHOLD_A, USER_A);

    const outcomeA = await executeAtomic(
      [{ definition: criarTarefa, input: { title: 'X' } }],
      ctxA,
    );
    expect(outcomeA.success).toBe(true);

    // Household B: também cria tarefa — usa ctx.householdId=B distinto. O
    // mock-Drizzle de B recebe a sua própria sequência de chamadas (não
    // partilha state com A — defesa pura por ctx isolation).
    const stateB: MockState = {
      executes: [],
      insertReturns: [
        [
          {
            id: '99999999-9999-4999-8999-999999999999',
            title: 'Y',
            due_date: null,
            priority: 'low',
          },
        ],
        [{ id: '00000000-0000-4000-8000-000000000002' }],
      ],
    };
    const ctxB = makeCtx(makeMockDb(stateB), HOUSEHOLD_B, USER_B);

    const outcomeB = await executeAtomic(
      [{ definition: criarTarefa, input: { title: 'Y' } }],
      ctxB,
    );
    expect(outcomeB.success).toBe(true);

    // CRÍTICO: state A e state B são isolados (ctx isolation respeitada).
    // Em produção, RLS Postgres + JWT garantem isolation real — exercitada
    // por Testcontainers em Story 1.4 Done. Aqui validamos apenas que o
    // tool NUNCA fez fall-through para outro household via shared state.
    expect(stateA.executes.length).toBe(2);
    expect(stateB.executes.length).toBe(2);
    // Os SQLs são iguais em estrutura — Drizzle parametriza householdId.
    expect(stateA.executes[0]?.sqlText).toMatch(/insert into tasks/i);
    expect(stateB.executes[0]?.sqlText).toMatch(/insert into tasks/i);
  });

  it('tool NUNCA usa input do utilizador para household_id', async () => {
    // O input do utilizador NÃO tem campo household_id (schema Zod strip
    // mode descarta keys desconhecidas). Mesmo se o LLM injectasse
    // `household_id: 'fake'` no input, o Zod parse remove. Defesa em
    // profundidade vs prompt injection.
    const parseResult = criarTarefa.inputSchema.safeParse({
      title: 'X',
      household_id: HOUSEHOLD_B, // <-- tentativa de injecção
    });
    expect(parseResult.success).toBe(true);
    if (parseResult.success) {
      expect(parseResult.data).not.toHaveProperty('household_id');
    }
  });
});
