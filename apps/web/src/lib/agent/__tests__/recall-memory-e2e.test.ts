// @vitest-environment node
/**
 * Story M-6 AC7 — prova determinística do fluxo COMPLETO de `listar_memorias`:
 *
 *   classify (listar_memorias — read-only) → o plano salta preview→confirm
 *   (mesmo com always_preview=true) → a tool REAL corre o SELECT em
 *   jarvis_memories → `buildSummaryText`/`renderReadToolResults` devolve o texto
 *   formatado com o conteúdo EXACTO das memórias seed (não o resumo genérico
 *   "Executei N operação(ões)…").
 *
 * Fase 1 (routing read-only): `runAgentForHousehold` com o Planner mockado a
 * emitir a tool call `listar_memorias` e o Executor mockado a devolver o output
 * real-shaped `{ memories, count }`. Assere que o outcome é `executed`
 * read-only (nunca preview, mesmo com always_preview=true) e que o summary é a
 * lista formatada das memórias.
 *
 * Fase 2 (tool REAL → render): a tool REAL `listarMemorias` corre com um `ctx.db`
 * mock que devolve as rows seed; o `output` é entregue a `renderReadToolResults`
 * (o mesmo caminho de `buildSummaryText`) — prova o binding SELECT→render com o
 * conteúdo exacto.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  getUserMock: vi.fn(),
  classifyMock: vi.fn(),
  plannerPlanMock: vi.fn(),
  executorExecuteMock: vi.fn(),
  dbExecuteMock: vi.fn(),
  resolveReplyCandidatesMock: vi.fn(),
}));

vi.mock('@/lib/agent/tools/gmail/resolve-reply-target', async () => {
  const actual = (await vi.importActual(
    '@/lib/agent/tools/gmail/resolve-reply-target',
  )) as Record<string, unknown>;
  return { ...actual, resolveReplyCandidates: mocks.resolveReplyCandidatesMock };
});

vi.mock('@meu-jarvis/auth/server', () => ({
  createServerSupabaseClient: vi.fn(async () => ({
    auth: { getUser: mocks.getUserMock },
    from: vi.fn(),
  })),
}));

vi.mock('@meu-jarvis/classifier', async () => {
  const actual = (await vi.importActual('@meu-jarvis/classifier')) as Record<string, unknown>;
  return {
    ...actual,
    Classifier: vi.fn().mockImplementation(() => ({ classify: mocks.classifyMock })),
  };
});

vi.mock('@meu-jarvis/planner-executor', async () => {
  const actual = (await vi.importActual('@meu-jarvis/planner-executor')) as Record<string, unknown>;
  return {
    ...actual,
    Planner: vi.fn().mockImplementation(() => ({ plan: mocks.plannerPlanMock })),
    Executor: vi.fn().mockImplementation(() => ({ execute: mocks.executorExecuteMock })),
  };
});

vi.mock('@/lib/agent/db-shim', () => ({
  getDb: () => ({ execute: mocks.dbExecuteMock }),
  getServiceDb: () => ({ execute: mocks.dbExecuteMock }),
  withHousehold: <T,>(_auth: unknown, fn: (tx: { execute: typeof mocks.dbExecuteMock }) => Promise<T>) =>
    fn({ execute: mocks.dbExecuteMock }),
}));

vi.mock('openai', () => ({
  default: vi.fn().mockImplementation(() => ({ chat: { completions: { create: vi.fn() } } })),
}));

vi.mock('@upstash/redis', () => ({
  Redis: vi.fn().mockImplementation(() => ({
    get: vi.fn().mockResolvedValue(null),
    set: vi.fn().mockResolvedValue('OK'),
    del: vi.fn().mockResolvedValue(1),
  })),
}));

import { runAgentForHousehold } from '@/lib/agent/run-agent';
import { renderReadToolResults } from '@/lib/agent/format-results';
import { listarMemorias } from '@meu-jarvis/tools';
import type { DrizzleDbClient, ToolExecutionContext } from '@meu-jarvis/tools';

const TEST_USER_ID = '00000000-0000-0000-0000-000000000001';
const TEST_HOUSEHOLD_ID = '00000000-0000-0000-0000-0000000000a1';

const SEED_MEMORIES = [
  { content: 'odeio reuniões antes das 10h', created_at: '2026-07-07T09:00:00.000Z' },
  { content: 'prefiro café sem açúcar', created_at: '2026-07-06T09:00:00.000Z' },
];

function sqlText(arg: unknown): string {
  const chunks = (arg as { queryChunks?: unknown[] })?.queryChunks;
  if (!Array.isArray(chunks)) return '';
  return chunks
    .map((c) => {
      const value = (c as { value?: unknown })?.value;
      if (Array.isArray(value)) return value.join('');
      return typeof value === 'string' ? value : '';
    })
    .join(' ');
}

beforeEach(() => {
  vi.clearAllMocks();
  // Sequência base + always_preview=true (para provar que a leitura salta o
  // preview mesmo assim). As memórias existentes (memoryContext) devolvem [].
  let callIndex = 0;
  mocks.dbExecuteMock.mockImplementation(async (arg: unknown) => {
    callIndex++;
    if (callIndex === 1) return [{ count: 1 }]; // rate limit
    if (callIndex === 2) return []; // quota
    if (callIndex === 3) return [{ id: 'run-uuid-test', created_at: new Date().toISOString() }]; // INSERT run
    if (sqlText(arg).includes('user_prefs')) return [{ always_preview: true }];
    return []; // memoryContext (jarvis_memories) vazio no preview-context
  });
});

describe('M-6 AC7 — fluxo completo listar_memorias: classify → read-only (salta preview) → render das memórias', () => {
  it('Fase 1 (routing) — plano [listar_memorias] executa (não preview) mesmo com always_preview=true e o summary lista as memórias', async () => {
    mocks.classifyMock.mockResolvedValue({
      intents: [
        { intent: 'listar_memorias', confidence: 0.92, raw_span: 'o que sabes sobre mim?' },
      ],
      language: 'pt-PT',
      needs_confirmation: false,
      overall_confidence: 0.92,
    });
    mocks.plannerPlanMock.mockResolvedValue({
      toolCalls: [{ toolName: 'listar_memorias', input: {}, intent: 'listar_memorias' }],
      planReasoning: null,
      latencyMs: 0,
      tokensInput: 0,
      tokensOutput: 0,
      costEur: 0,
      cacheHit: false,
    });
    // O Executor mockado devolve o output REAL-shaped da tool `{ memories, count }`.
    mocks.executorExecuteMock.mockResolvedValue({
      success: true,
      results: [
        {
          toolName: 'listar_memorias',
          output: {
            memories: SEED_MEMORIES.map((m) => ({ content: m.content, createdAt: m.created_at })),
            count: SEED_MEMORIES.length,
          },
          reverseOpId: 'rop-noop',
        },
      ],
    });

    const outcome = await runAgentForHousehold({
      userId: TEST_USER_ID,
      householdId: TEST_HOUSEHOLD_ID,
      prompt: 'o que sabes sobre mim?',
    });

    // Read-only salta preview→confirm mesmo com always_preview=true.
    expect(outcome.status).toBe('executed');
    if (outcome.status === 'executed' && outcome.kind === 'pipeline') {
      expect(outcome.readOnly).toBe(true);
      // O summary é a lista formatada das memórias — NÃO "Executei N operações".
      expect(outcome.summary).toBe(
        'Tenho 2 memórias guardadas:\n1. odeio reuniões antes das 10h\n2. prefiro café sem açúcar',
      );
      expect(outcome.summary).not.toContain('Executei');
    } else {
      throw new Error('esperado executed/pipeline read-only');
    }
  });

  it('Fase 2 (tool REAL → render) — a tool listarMemorias faz SELECT household-scoped e o output rende o texto exacto', async () => {
    const executes: string[] = [];
    const txDb: DrizzleDbClient = {
      transaction: vi.fn() as unknown as DrizzleDbClient['transaction'],
      insert: vi.fn(),
      execute: vi.fn(async (query: unknown) => {
        const t = sqlText(query);
        executes.push(t);
        if (/from\s+public\.jarvis_memories/i.test(t)) {
          return SEED_MEMORIES;
        }
        return [];
      }) as unknown as DrizzleDbClient['execute'],
    };

    const ctx: ToolExecutionContext = {
      householdId: TEST_HOUSEHOLD_ID,
      userId: TEST_USER_ID,
      db: txDb,
      traceId: 'trace-e2e',
      runId: 'run-uuid-test',
    };

    const output = await listarMemorias.execute({}, ctx);

    // SELECT household-scoped em public.jarvis_memories (RLS 1.ª rede explícita).
    const selectSql = executes.find((t) => /from\s+public\.jarvis_memories/i.test(t)) ?? '';
    expect(selectSql).toMatch(/household_id/i);
    expect(selectSql).toMatch(/order by created_at desc/i);

    // O output real da tool, entregue ao mesmo renderizador que buildSummaryText usa.
    expect(output.count).toBe(2);
    const rendered = renderReadToolResults([{ toolName: 'listar_memorias', output }]);
    expect(rendered).toBe(
      'Tenho 2 memórias guardadas:\n1. odeio reuniões antes das 10h\n2. prefiro café sem açúcar',
    );
  });
});
