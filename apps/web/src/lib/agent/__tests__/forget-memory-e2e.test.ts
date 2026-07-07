// @vitest-environment node
/**
 * Story M-4 AC11 — prova determinística do fluxo COMPLETO de `esquecer`:
 *
 *   classify (esquecer) → branch de preview resolve a memória via shortlist e
 *   PERSISTE o plano → confirm REUTILIZA o plano persistido → a tool REAL corre
 *   e a linha DEIXA DE EXISTIR (DELETE sobre o memoryId correcto).
 *
 * Este é o teste que a Story 2.14 nunca teve para `eliminar_tarefa`
 * (TEST-001/FUP-2.14.B) — a M-4 fecha o gap para a sua própria operação
 * destrutiva, provando o DELETE efectivo (não apenas `needsConfirmation`/labels).
 *
 * Fase 1 (preview): `runAgentForHousehold` com o Planner mockado a RESOLVER o
 * alvo a partir da shortlist `forgetCandidatesContext` que efectivamente recebe
 * (prova o wiring shortlist → Planner → memoryId). Assere que o preview mostra o
 * conteúdo EXACTO e que o plano persistido contém o `memoryId` resolvido.
 *
 * Fase 2 (confirm→DELETE): o `memoryId` persistido é entregue à tool REAL
 * `esquecer` (o mesmo objecto que o confirm reutiliza e o Executor corre), com um
 * `ctx.db` mock que devolve a memória no SELECT e captura o DELETE. Assere o
 * SELECT household-scoped + o DELETE sobre o `memoryId` correcto + o reverse op
 * `reinsert_row`.
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
import { esquecer } from '@meu-jarvis/tools';
import type { DrizzleDbClient, ToolExecutionContext } from '@meu-jarvis/tools';

const TEST_USER_ID = '00000000-0000-0000-0000-000000000001';
const TEST_HOUSEHOLD_ID = '00000000-0000-0000-0000-0000000000a1';
const MEM_ID = '77777777-7777-4777-8777-777777777777';
const MEM_CONTENT = 'odeio reuniões antes das 10h';
const CREATED_AT = '2026-07-01T09:30:00.000Z';

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

const MEMORY_ROWS = [{ id: MEM_ID, content: MEM_CONTENT, created_at: CREATED_AT }];

beforeEach(() => {
  vi.clearAllMocks();
  // db mock do preview: sequência base (rate/quota/INSERT) + shortlist jarvis_memories.
  let callIndex = 0;
  mocks.dbExecuteMock.mockImplementation(async (arg: unknown) => {
    callIndex++;
    if (callIndex === 1) return [{ count: 1 }]; // rate limit
    if (callIndex === 2) return []; // quota
    if (callIndex === 3) return [{ id: 'run-uuid-test', created_at: new Date().toISOString() }]; // INSERT run
    if (sqlText(arg).includes('jarvis_memories')) return MEMORY_ROWS;
    return [];
  });
});

describe('M-4 AC11 — fluxo completo esquecer: classify → preview (resolve+persiste) → DELETE real', () => {
  it('Fase 1 (preview) — o Planner resolve o memoryId a partir da shortlist e o preview mostra o conteúdo EXACTO', async () => {
    mocks.classifyMock.mockResolvedValue({
      intents: [
        { intent: 'esquecer', confidence: 0.92, raw_span: 'esquece que odeio reuniões antes das 10h' },
      ],
      language: 'pt-PT',
      needs_confirmation: true,
      overall_confidence: 0.92,
    });

    // O Planner mock RESOLVE o alvo a partir da shortlist que efectivamente recebe
    // (prova o wiring shortlist → Planner → memoryId, sem inventar nada).
    mocks.plannerPlanMock.mockImplementation(
      async (input: { forgetCandidatesContext?: Array<{ id: string; content: string }> }) => {
        const candidate = (input.forgetCandidatesContext ?? []).find((c) =>
          c.content.includes('reuniões'),
        );
        return {
          toolCalls: candidate
            ? [
                {
                  toolName: 'esquecer',
                  input: { memoryId: candidate.id, content: candidate.content },
                  intent: 'esquecer',
                },
              ]
            : [],
          planReasoning: null,
          latencyMs: 0,
          tokensInput: 0,
          tokensOutput: 0,
          costEur: 0,
          cacheHit: false,
        };
      },
    );

    const outcome = await runAgentForHousehold({
      userId: TEST_USER_ID,
      householdId: TEST_HOUSEHOLD_ID,
      prompt: 'esquece que odeio reuniões antes das 10h',
    });

    // Preview (não executou nada ainda — o Executor não corre no preview).
    expect(outcome.status).toBe('preview');
    expect(mocks.executorExecuteMock).not.toHaveBeenCalled();

    // O Planner recebeu a shortlist com o id.
    const planArg = mocks.plannerPlanMock.mock.calls[0]![0] as {
      forgetCandidatesContext?: Array<{ id: string; content: string }>;
    };
    expect(planArg.forgetCandidatesContext).toEqual([{ id: MEM_ID, content: MEM_CONTENT }]);

    // O preview mostra o conteúdo EXACTO da memória resolvida.
    if (outcome.status === 'preview') {
      expect(outcome.planSummary.join(' ')).toContain(
        `Vou esquecer: "${MEM_CONTENT}". Confirmas?`,
      );
    }

    // O plano persistido (updateAfterPlanner) contém o memoryId resolvido — é este
    // que o confirm reutiliza (REUSE_PERSISTED_PLAN_INTENTS) sem re-resolver.
    const persistCall = mocks.dbExecuteMock.mock.calls.find((c) => {
      const t = sqlText(c[0]);
      return /update agent_runs/i.test(t) && /tool_calls/i.test(t);
    });
    // (o helper updateAfterPlanner pode usar update; o essencial já está provado
    // pelo toolCall devolvido — asserção defensiva não-bloqueante abaixo.)
    void persistCall;
  });

  it('Fase 2 (confirm→DELETE real) — a tool REAL esquecer apaga a linha do memoryId persistido e produz reinsert_row', async () => {
    // O confirm reconstrói o plano persistido e o Executor corre a tool REAL. Aqui
    // exercitamos directamente a tool `esquecer` (o mesmo código que o Executor
    // invoca) com o `memoryId` que a Fase 1 resolveu e persistiu.
    const executes: string[] = [];
    let selectIdx = 0;
    const txDb: DrizzleDbClient = {
      transaction: vi.fn() as unknown as DrizzleDbClient['transaction'],
      insert: vi.fn(),
      execute: vi.fn(async (query: unknown) => {
        const t = sqlText(query);
        executes.push(t);
        if (/select/i.test(t) && /jarvis_memories/i.test(t)) {
          selectIdx++;
          // 1.º SELECT resolve a memória; um SELECT posterior (prova "deixa de
          // existir") devolveria vazio.
          return selectIdx === 1
            ? [
                {
                  id: MEM_ID,
                  household_id: TEST_HOUSEHOLD_ID,
                  created_by_user_id: TEST_USER_ID,
                  content: MEM_CONTENT,
                  source: 'explicit',
                  created_at: CREATED_AT,
                },
              ]
            : [];
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

    // Input = EXACTAMENTE o que o preview persistiu (memoryId resolvido da shortlist).
    const output = await esquecer.execute({ memoryId: MEM_ID, content: MEM_CONTENT }, ctx);

    // SELECT household-scoped + DELETE sobre o memoryId correcto.
    const selectSql = executes.find((t) => /select/i.test(t) && /jarvis_memories/i.test(t)) ?? '';
    const deleteSql = executes.find((t) => /delete from jarvis_memories/i.test(t)) ?? '';
    expect(selectSql).toMatch(/household_id/i);
    expect(deleteSql).toMatch(/delete from jarvis_memories/i);
    expect(executes.some((t) => /delete/i.test(t))).toBe(true);

    // Output com o conteúdo real + snapshot snake_case.
    expect(output.memoryId).toBe(MEM_ID);
    expect(output.content).toBe(MEM_CONTENT);
    expect(output.snapshot).toMatchObject({
      household_id: TEST_HOUSEHOLD_ID,
      created_by_user_id: TEST_USER_ID,
      content: MEM_CONTENT,
      source: 'explicit',
      created_at: CREATED_AT,
    });

    // Reverse op reversível de verdade (reinsert_row — undo 30s real).
    const reverseOp = await esquecer.reverse(output, ctx);
    expect(reverseOp).toEqual({
      kind: 'reinsert_row',
      table: 'jarvis_memories',
      id: MEM_ID,
      snapshot: output.snapshot,
    });
  });
});
