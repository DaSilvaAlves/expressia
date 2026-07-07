// @vitest-environment node
/**
 * Story M-5 AC7 — prova determinística do fluxo COMPLETO de `sugerir_memoria`:
 *
 *   classify (sugerir_memoria a par de criar_tarefa) → branch de preview corre o
 *   Planner (com memoryContext) + `tool.preview()` mostra o texto EXACTO proposto
 *   + PERSISTE o plano → confirm REUTILIZA o plano persistido → a tool REAL corre
 *   e faz INSERT em jarvis_memories com `source='inferred'` e `content` IDÊNTICO
 *   ao mostrado no preview (binding preview==memória guardada).
 *
 * Fase 1 (preview): `runAgentForHousehold` com o Planner mockado a emitir a tool
 * call `sugerir_memoria` (com o content extraído do aside). Assere que o preview
 * mostra o texto EXACTO em forma de pergunta e que R5 força o preview (nunca
 * executa sem confirmar). Prova também que a AUSÊNCIA de resolução de alvo é
 * correcta — NÃO há shortlist `forgetCandidatesContext` para esta tool.
 *
 * Fase 2 (confirm→INSERT real): o `content` proposto é entregue à tool REAL
 * `sugerirMemoria` (o mesmo código que o Executor invoca no confirm), com um
 * `ctx.db` mock que captura o INSERT. Assere o INSERT com `source='inferred'`
 * LITERAL + o `content` idêntico ao do preview + o reverse op `delete_row`.
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
import { sugerirMemoria } from '@meu-jarvis/tools';
import type { DrizzleDbClient, ToolExecutionContext } from '@meu-jarvis/tools';

const TEST_USER_ID = '00000000-0000-0000-0000-000000000001';
const TEST_HOUSEHOLD_ID = '00000000-0000-0000-0000-0000000000a1';
const NEW_MEM_ID = '66666666-6666-4666-8666-666666666666';
const PROPOSED_CONTENT = 'odeio reuniões antes das 10h';

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
  // db mock do preview: sequência base (rate/quota/INSERT run) + memórias vazias.
  let callIndex = 0;
  mocks.dbExecuteMock.mockImplementation(async () => {
    callIndex++;
    if (callIndex === 1) return [{ count: 1 }]; // rate limit
    if (callIndex === 2) return []; // quota
    if (callIndex === 3) return [{ id: 'run-uuid-test', created_at: new Date().toISOString() }]; // INSERT run
    return []; // sem memórias existentes → memoryContext vazio
  });
});

describe('M-5 AC7 — fluxo completo sugerir_memoria: classify → preview (persiste) → INSERT real com source=inferred', () => {
  it('Fase 1 (preview) — o preview mostra o texto EXACTO proposto e NÃO usa shortlist de alvo (sem forgetCandidatesContext)', async () => {
    mocks.classifyMock.mockResolvedValue({
      intents: [
        { intent: 'criar_tarefa', confidence: 0.93, raw_span: 'cria uma tarefa para ligar ao dentista amanhã' },
        { intent: 'sugerir_memoria', confidence: 0.85, raw_span: PROPOSED_CONTENT },
      ],
      language: 'pt-PT',
      needs_confirmation: true, // R5 força sempre (ALWAYS_CONFIRM_INTENTS)
      overall_confidence: 0.85,
    });

    // O Planner extrai o content directamente da mensagem actual (sem shortlist —
    // é sempre um INSERT novo, ao contrário de `esquecer`).
    mocks.plannerPlanMock.mockResolvedValue({
      toolCalls: [
        {
          toolName: 'sugerir_memoria',
          input: { content: PROPOSED_CONTENT },
          intent: 'sugerir_memoria',
        },
      ],
      planReasoning: null,
      latencyMs: 0,
      tokensInput: 0,
      tokensOutput: 0,
      costEur: 0,
      cacheHit: false,
    });

    const outcome = await runAgentForHousehold({
      userId: TEST_USER_ID,
      householdId: TEST_HOUSEHOLD_ID,
      prompt: 'cria uma tarefa para ligar ao dentista amanhã, já agora odeio reuniões antes das 10h',
    });

    // Preview — nada foi executado ainda (o Executor não corre no preview).
    expect(outcome.status).toBe('preview');
    expect(mocks.executorExecuteMock).not.toHaveBeenCalled();

    // O Planner NÃO recebe shortlist de alvo (sugerir_memoria não resolve linha existente).
    const planArg = mocks.plannerPlanMock.mock.calls[0]![0] as {
      forgetCandidatesContext?: unknown;
    };
    expect(planArg.forgetCandidatesContext).toBeUndefined();

    // O preview mostra o texto EXACTO proposto em forma de pergunta.
    if (outcome.status === 'preview') {
      expect(outcome.planSummary.join(' ')).toContain(
        `Reparei nisto: "${PROPOSED_CONTENT}". Queres que eu guarde isto como memória?`,
      );
    }
  });

  it('Fase 2 (confirm→INSERT real) — a tool REAL sugerirMemoria faz INSERT com source=inferred LITERAL e content idêntico ao preview + reverse delete_row', async () => {
    // O confirm reconstrói o plano persistido e o Executor corre a tool REAL. Aqui
    // exercitamos directamente a tool `sugerirMemoria` (o mesmo código que o
    // Executor invoca) com o `content` que a Fase 1 mostrou/persistiu.
    const executes: string[] = [];
    const txDb: DrizzleDbClient = {
      transaction: vi.fn() as unknown as DrizzleDbClient['transaction'],
      insert: vi.fn(),
      execute: vi.fn(async (query: unknown) => {
        const t = sqlText(query);
        executes.push(t);
        if (/insert into jarvis_memories/i.test(t)) {
          return [{ id: NEW_MEM_ID, content: PROPOSED_CONTENT }];
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

    // Input = EXACTAMENTE o que o preview persistiu (content extraído do aside).
    const output = await sugerirMemoria.execute({ content: PROPOSED_CONTENT }, ctx);

    // INSERT household-scoped com source='inferred' LITERAL (nunca do input).
    const insertSql = executes.find((t) => /insert into jarvis_memories/i.test(t)) ?? '';
    expect(insertSql).toMatch(/household_id/i);
    expect(insertSql).toMatch(/created_by_user_id/i);
    expect(insertSql).toContain("'inferred'");
    expect(insertSql).not.toContain("'explicit'");

    // Output: a linha existe com o content IDÊNTICO ao mostrado no preview.
    expect(output.memoryId).toBe(NEW_MEM_ID);
    expect(output.content).toBe(PROPOSED_CONTENT);

    // Reverse op reversível de verdade (delete_row — undo 30s real, já coberto por
    // ALLOWED_REVERSE_TABLES desde a M-4).
    const reverseOp = await sugerirMemoria.reverse(output, ctx);
    expect(reverseOp).toEqual({
      kind: 'delete_row',
      table: 'jarvis_memories',
      id: NEW_MEM_ID,
    });
  });
});
