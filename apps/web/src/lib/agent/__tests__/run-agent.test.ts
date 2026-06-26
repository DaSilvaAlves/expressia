// @vitest-environment node
/**
 * Testes de `runAgentForHousehold` — Story J-2 AC4 (pipeline desacoplado da
 * camada HTTP/Auth).
 *
 * Cobertura:
 *   - Happy path `executed` (confidence ≥ 0,70) → outcome status='executed'.
 *   - Happy path `preview` (confidence < 0,70) → outcome status='preview'.
 *   - Propagação de erros do pipeline (ClassifierError, PlannerError).
 *   - `supabase.auth.getUser()` NUNCA é chamado (spy) — a função recebe
 *     `{ userId, householdId }` directamente.
 *
 * Estratégia mockable-only (idêntica a route.test.ts): nenhum call real a
 * OpenAI/Anthropic/DB. Mock via `vi.hoisted()` + `vi.mock(...)`.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  getUserMock: vi.fn(),
  classifyMock: vi.fn(),
  plannerPlanMock: vi.fn(),
  executorExecuteMock: vi.fn(),
  dbExecuteMock: vi.fn(),
}));

// Auth mock — o spy `getUserMock` NUNCA deve ser chamado por runAgentForHousehold.
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
  default: vi.fn().mockImplementation(() => ({
    chat: { completions: { create: vi.fn() } },
  })),
}));

vi.mock('@upstash/redis', () => ({
  Redis: vi.fn().mockImplementation(() => ({
    get: vi.fn().mockResolvedValue(null),
    set: vi.fn().mockResolvedValue('OK'),
    del: vi.fn().mockResolvedValue(1),
  })),
}));

import { runAgentForHousehold } from '@/lib/agent/run-agent';

const TEST_USER_ID = '00000000-0000-0000-0000-000000000001';
const TEST_HOUSEHOLD_ID = '00000000-0000-0000-0000-0000000000a1';

/**
 * DB mock default — sequência (sem Idempotency-Key; lookupIdempotentRun não
 * toca na DB nesse caso):
 *   1. rate limit upsert → [{ count: 1 }]
 *   2. quota check → []
 *   3. INSERT agent_runs → [{ id, created_at }]
 *   4+. UPDATEs / SELECTs subsequentes → []
 */
function setupDbDefault(): void {
  let callIndex = 0;
  mocks.dbExecuteMock.mockImplementation(async () => {
    callIndex++;
    switch (callIndex) {
      case 1:
        return [{ count: 1 }]; // rate limit
      case 2:
        return []; // quota
      case 3:
        return [{ id: 'run-uuid-test', created_at: new Date().toISOString() }]; // INSERT
      default:
        return [];
    }
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  setupDbDefault();
});

describe('runAgentForHousehold — happy paths', () => {
  it('AC4 — executed path (confidence ≥ 0,70) devolve status=executed kind=pipeline', async () => {
    mocks.classifyMock.mockResolvedValue({
      intents: [{ intent: 'criar_tarefa', confidence: 0.85, raw_span: 'criar tarefa' }],
      language: 'pt-PT',
      needs_confirmation: false,
      overall_confidence: 0.85,
    });
    mocks.plannerPlanMock.mockResolvedValue({
      toolCalls: [{ toolName: 'create_task', input: { title: 'X' }, intent: 'criar_tarefa' }],
      planReasoning: null,
      latencyMs: 100,
      tokensInput: 50,
      tokensOutput: 20,
      costEur: 0.0001,
      cacheHit: false,
    });
    mocks.executorExecuteMock.mockResolvedValue({
      success: true,
      results: [{ toolName: 'create_task', output: { id: 'task-1' }, reverseOpId: 'rop-1' }],
    });

    const outcome = await runAgentForHousehold({
      userId: TEST_USER_ID,
      householdId: TEST_HOUSEHOLD_ID,
      prompt: 'criar tarefa amanhã',
    });

    expect(outcome.status).toBe('executed');
    if (outcome.status === 'executed' && outcome.kind === 'pipeline') {
      expect(outcome.runId).toBe('run-uuid-test');
      expect(outcome.undoExpiresAt).toBeTruthy();
      expect(outcome.summary).toContain('1 operação');
    } else {
      throw new Error('esperado executed/pipeline');
    }
    // AC4 — auth NUNCA chamado.
    expect(mocks.getUserMock).not.toHaveBeenCalled();
  });

  it('AC4 — preview path (confidence < 0,70) devolve status=preview sem chamar Planner/Executor', async () => {
    mocks.classifyMock.mockResolvedValue({
      intents: [{ intent: 'criar_tarefa', confidence: 0.5, raw_span: 'oi' }],
      language: 'pt-PT',
      needs_confirmation: true,
      overall_confidence: 0.5,
    });

    const outcome = await runAgentForHousehold({
      userId: TEST_USER_ID,
      householdId: TEST_HOUSEHOLD_ID,
      prompt: 'fazer alguma coisa',
    });

    expect(outcome.status).toBe('preview');
    if (outcome.status === 'preview') {
      expect(outcome.confidence).toBe(0.5);
      expect(outcome.expiresAt).toBeTruthy();
      expect(Array.isArray(outcome.planSummary)).toBe(true);
    }
    expect(mocks.plannerPlanMock).not.toHaveBeenCalled();
    expect(mocks.executorExecuteMock).not.toHaveBeenCalled();
    expect(mocks.getUserMock).not.toHaveBeenCalled();
  });
});

describe('runAgentForHousehold — propagação de erros', () => {
  it('AC4 — ClassifierError é propagado (throw) com runId anexado', async () => {
    const { ClassifierValidationError } = await import('@meu-jarvis/classifier');
    mocks.classifyMock.mockRejectedValue(new ClassifierValidationError('empty', 0, 1000));

    await expect(
      runAgentForHousehold({
        userId: TEST_USER_ID,
        householdId: TEST_HOUSEHOLD_ID,
        prompt: 'qq',
      }),
    ).rejects.toMatchObject({ runId: 'run-uuid-test' });

    expect(mocks.getUserMock).not.toHaveBeenCalled();
  });

  it('AC4 — PlannerError é propagado (throw)', async () => {
    mocks.classifyMock.mockResolvedValue({
      intents: [{ intent: 'criar_tarefa', confidence: 0.85, raw_span: '' }],
      language: 'pt-PT',
      needs_confirmation: false,
      overall_confidence: 0.85,
    });
    const { PlannerValidationError } = await import('@meu-jarvis/planner-executor');
    mocks.plannerPlanMock.mockRejectedValue(
      new PlannerValidationError('input_invalid', 'shape errado'),
    );

    await expect(
      runAgentForHousehold({
        userId: TEST_USER_ID,
        householdId: TEST_HOUSEHOLD_ID,
        prompt: 'criar tarefa',
      }),
    ).rejects.toBeInstanceOf(PlannerValidationError);

    expect(mocks.getUserMock).not.toHaveBeenCalled();
  });
});

describe('runAgentForHousehold — guard multi-intent Calendar (Story J-5 AC14)', () => {
  it('AC14 — intents mistos (calendar + tarefa) → preview sem executar tools', async () => {
    mocks.classifyMock.mockResolvedValue({
      intents: [
        { intent: 'criar_evento_calendario', confidence: 0.9, raw_span: 'marca reunião sexta' },
        { intent: 'criar_tarefa', confidence: 0.9, raw_span: 'e regista a renda' },
      ],
      language: 'pt-PT',
      needs_confirmation: false,
      overall_confidence: 0.9,
    });

    const outcome = await runAgentForHousehold({
      userId: TEST_USER_ID,
      householdId: TEST_HOUSEHOLD_ID,
      prompt: 'marca reunião E regista a renda',
    });

    expect(outcome.status).toBe('preview');
    if (outcome.status === 'preview') {
      expect(outcome.planSummary.join(' ')).toMatch(/calend[áa]rio/i);
    }
    // Nenhuma tool executada — Planner/Executor nem chegam a correr.
    expect(mocks.plannerPlanMock).not.toHaveBeenCalled();
    expect(mocks.executorExecuteMock).not.toHaveBeenCalled();
  });

  it('AC14 — apenas calendar puro (sem mix) → prossegue para o Planner', async () => {
    mocks.classifyMock.mockResolvedValue({
      intents: [
        { intent: 'criar_evento_calendario', confidence: 0.9, raw_span: 'marca reunião sexta' },
      ],
      language: 'pt-PT',
      needs_confirmation: false,
      overall_confidence: 0.9,
    });
    mocks.plannerPlanMock.mockResolvedValue({
      toolCalls: [
        { toolName: 'criar_evento_calendario', input: {}, intent: 'criar_evento_calendario' },
      ],
      planReasoning: null,
      latencyMs: 0,
      tokensInput: 0,
      tokensOutput: 0,
      costEur: 0,
      cacheHit: false,
    });
    mocks.executorExecuteMock.mockResolvedValue({
      success: true,
      results: [{ toolName: 'criar_evento_calendario', output: { eventId: 'evt' }, reverseOpId: 'rop' }],
    });

    const outcome = await runAgentForHousehold({
      userId: TEST_USER_ID,
      householdId: TEST_HOUSEHOLD_ID,
      prompt: 'marca reunião sexta às 15h',
    });

    expect(outcome.status).toBe('executed');
    // O guard NÃO bloqueia pedidos de calendar puros.
    expect(mocks.plannerPlanMock).toHaveBeenCalled();
  });
});

describe('runAgentForHousehold — rollback', () => {
  it('AC5 — rollback graceful (executor success:false) lança AtomicExecutionError', async () => {
    mocks.classifyMock.mockResolvedValue({
      intents: [{ intent: 'criar_tarefa', confidence: 0.85, raw_span: '' }],
      language: 'pt-PT',
      needs_confirmation: false,
      overall_confidence: 0.85,
    });
    mocks.plannerPlanMock.mockResolvedValue({
      toolCalls: [{ toolName: 'create_task', input: {}, intent: 'criar_tarefa' }],
      planReasoning: null,
      latencyMs: 0,
      tokensInput: 0,
      tokensOutput: 0,
      costEur: 0,
      cacheHit: false,
    });
    const { ToolExecutionError } = await import('@meu-jarvis/planner-executor');
    mocks.executorExecuteMock.mockResolvedValue({
      success: false,
      failedToolName: 'create_task',
      error: new ToolExecutionError('create_task', 'falhou'),
      rolledBack: true,
    });

    const { AtomicExecutionError } = await import('@/lib/agent/run-agent');
    await expect(
      runAgentForHousehold({
        userId: TEST_USER_ID,
        householdId: TEST_HOUSEHOLD_ID,
        prompt: 'oi',
      }),
    ).rejects.toBeInstanceOf(AtomicExecutionError);
  });
});
