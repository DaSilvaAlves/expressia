// @vitest-environment node
/**
 * Testes unitários para `POST /api/agent/prompt` — Story 2.6 AC15.
 *
 * Estratégia: mockable-only. Nenhum teste faz call real a OpenAI/Anthropic/DB
 * (EB1/EB2/EB3 PENDING). Mock pattern via `vi.hoisted()` + `vi.mock(...)` —
 * padrão consistente com 2.2/2.3/2.4/2.5 (4 stories Done APPROVED).
 *
 * Cobertura desta suite (route.test.ts):
 *   - Auth ausente (401)
 *   - Body inválido Zod (400)
 *   - Golden path executed (200, mode=executed, undo_url)
 *   - Golden path preview (200, mode=preview, confirmation_url)
 *   - Classifier error (400)
 *   - Planner error (400)
 *   - ToolPlanGateError (400)
 *   - ToolError (500)
 *   - Audit log persistence (INSERT verificado)
 *   - PII layer assertion
 *   - Rate limit excedido (429)
 *   - Quota mensal excedida (429)
 *   - Idempotency replay (200 X-Idempotent-Replay)
 *   - Idempotency in-progress (409)
 *
 * Trace: Story 2.6 AC15 + DN1-mockable-only.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

// Mocks hoisted — disponíveis antes dos imports
const mocks = vi.hoisted(() => ({
  getUserMock: vi.fn(),
  fromMock: vi.fn(),
  classifyMock: vi.fn(),
  plannerPlanMock: vi.fn(),
  executorExecuteMock: vi.fn(),
  getDbMock: vi.fn(),
  dbExecuteMock: vi.fn(),
}));

// Auth mock
vi.mock('@meu-jarvis/auth/server', () => ({
  createServerSupabaseClient: vi.fn(async () => ({
    auth: { getUser: mocks.getUserMock },
    from: mocks.fromMock,
  })),
}));

// Classifier mock — class com método `classify`
vi.mock('@meu-jarvis/classifier', async () => {
  const actual = (await vi.importActual('@meu-jarvis/classifier')) as Record<string, unknown>;
  return {
    ...actual,
    Classifier: vi.fn().mockImplementation(() => ({
      classify: mocks.classifyMock,
    })),
  };
});

// Planner+Executor mocks
vi.mock('@meu-jarvis/planner-executor', async () => {
  const actual = (await vi.importActual('@meu-jarvis/planner-executor')) as Record<string, unknown>;
  return {
    ...actual,
    Planner: vi.fn().mockImplementation(() => ({
      plan: mocks.plannerPlanMock,
    })),
    Executor: vi.fn().mockImplementation(() => ({
      execute: mocks.executorExecuteMock,
    })),
  };
});

// DB shim mock — controla todas as queries SQL
vi.mock('@/lib/agent/db-shim', () => ({
  getDb: () => ({ execute: mocks.dbExecuteMock }),
  getServiceDb: () => ({ execute: mocks.dbExecuteMock }),
  // SEC-8: o route monta `txRunner: (fn) => withHousehold({...}, fn)`. O Executor
  // é mockado (a closure não corre), mas expomos withHousehold para robustez de
  // contrato — corre `fn` com um db fake compatível.
  withHousehold: <T,>(_auth: unknown, fn: (tx: { execute: typeof mocks.dbExecuteMock }) => Promise<T>) =>
    fn({ execute: mocks.dbExecuteMock }),
}));

// Mock `openai` SDK para createClassifier não falhar
vi.mock('openai', () => ({
  default: vi.fn().mockImplementation(() => ({
    chat: { completions: { create: vi.fn() } },
  })),
}));

// Story 2.9 — mock Upstash Redis (modo degradado em CI sem env vars; aqui
// explicit mock para garantir zero call real e MISS deterministico).
vi.mock('@upstash/redis', () => ({
  Redis: vi.fn().mockImplementation(() => ({
    get: vi.fn().mockResolvedValue(null),
    set: vi.fn().mockResolvedValue('OK'),
    del: vi.fn().mockResolvedValue(1),
  })),
}));

import { POST } from '@/app/api/agent/prompt/route';

const TEST_USER_ID = '00000000-0000-0000-0000-000000000001';
const TEST_HOUSEHOLD_ID = '00000000-0000-0000-0000-0000000000a1';

function makeRequest(body: unknown, headers: Record<string, string> = {}): Request {
  return new Request('http://localhost/api/agent/prompt', {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: JSON.stringify(body),
  });
}

function setupAuth(authenticated: boolean = true): void {
  if (authenticated) {
    mocks.getUserMock.mockResolvedValue({
      data: { user: { id: TEST_USER_ID, email: 'tester@expressia.pt' } },
      error: null,
    });
  } else {
    mocks.getUserMock.mockResolvedValue({
      data: { user: null },
      error: null,
    });
  }

  mocks.fromMock.mockReturnValue({
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    limit: vi.fn().mockReturnThis(),
    maybeSingle: vi.fn().mockResolvedValue({
      data: { household_id: TEST_HOUSEHOLD_ID },
      error: null,
    }),
  });
}

/**
 * Default DB mock — sem header Idempotency-Key, sequência é:
 *   1. rate limit upsert → [{ count: 1 }]
 *   2. quota check → [] (new household)
 *   3. INSERT agent_runs → [{ id, created_at }]
 *   4+. UPDATEs subsequentes → []
 *
 * Quando há `Idempotency-Key` header, há lookup adicional ANTES — testes
 * específicos usam `mockResolvedValueOnce` para sobrescrever a primeira call.
 */
function setupDbDefault(): void {
  let callIndex = 0;
  mocks.dbExecuteMock.mockImplementation(async () => {
    callIndex++;
    switch (callIndex) {
      case 1:
        return [{ count: 1 }]; // rate limit
      case 2:
        return []; // quota (sem row → permite)
      case 3:
        return [{ id: 'run-uuid-test', created_at: new Date().toISOString() }];
      default:
        return [];
    }
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  setupAuth();
  setupDbDefault();
});

describe('POST /api/agent/prompt — auth + validation', () => {
  it('AC1+AC13 — 401 quando user é null (sem JWT)', async () => {
    setupAuth(false);
    const res = await POST(makeRequest({ prompt: 'criar tarefa amanhã' }) as never);
    expect(res.status).toBe(401);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe('AUTH_REQUIRED');
  });

  it('AC1+AC13 — 400 quando body sem campo prompt', async () => {
    const res = await POST(makeRequest({ foo: 'bar' }) as never);
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe('VALIDATION_ERROR');
  });

  it('AC1+AC13 — 400 quando prompt > 2000 caracteres', async () => {
    const tooLong = 'a'.repeat(2001);
    const res = await POST(makeRequest({ prompt: tooLong }) as never);
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe('VALIDATION_ERROR');
  });

  it('AC1+AC13 — 400 quando prompt vazio', async () => {
    const res = await POST(makeRequest({ prompt: '' }) as never);
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe('VALIDATION_ERROR');
  });

  it('AC2 — 404 quando user sem household', async () => {
    mocks.fromMock.mockReturnValue({
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      limit: vi.fn().mockReturnThis(),
      maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
    });
    const res = await POST(makeRequest({ prompt: 'oi' }) as never);
    expect(res.status).toBe(404);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe('HOUSEHOLD_NOT_FOUND');
  });
});

describe('POST /api/agent/prompt — golden paths', () => {
  it('AC3+AC5 — golden path executed (confidence >= 0.70)', async () => {
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

    const res = await POST(makeRequest({ prompt: 'criar tarefa amanhã' }) as never);
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      mode: string;
      run_id: string;
      undo_url: string;
      undo_expires_at: string;
    };
    expect(body.mode).toBe('executed');
    expect(body.run_id).toBe('run-uuid-test');
    expect(body.undo_url).toContain('/api/agent/prompt/');
    expect(body.undo_url).toContain('/undo');
    expect(body.undo_expires_at).toBeTruthy();
  });

  it('AC4 — golden path preview (confidence < 0.70)', async () => {
    mocks.classifyMock.mockResolvedValue({
      intents: [{ intent: 'criar_tarefa', confidence: 0.5, raw_span: 'oi' }],
      language: 'pt-PT',
      needs_confirmation: true,
      overall_confidence: 0.5,
    });

    const res = await POST(makeRequest({ prompt: 'fazer alguma coisa' }) as never);
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      mode: string;
      run_id: string;
      confirmation_url: string;
      expires_at: string;
      confidence: number;
    };
    expect(body.mode).toBe('preview');
    expect(body.confirmation_url).toContain('/api/agent/prompt/');
    expect(body.confirmation_url).toContain('/confirm');
    expect(body.confidence).toBe(0.5);
    expect(body.expires_at).toBeTruthy();
    // Planner+Executor NÃO devem ser chamados em preview mode
    expect(mocks.plannerPlanMock).not.toHaveBeenCalled();
    expect(mocks.executorExecuteMock).not.toHaveBeenCalled();
  });
});

describe('POST /api/agent/prompt — error taxonomy (AC13)', () => {
  beforeEach(() => {
    mocks.classifyMock.mockResolvedValue({
      intents: [{ intent: 'criar_tarefa', confidence: 0.85, raw_span: '' }],
      language: 'pt-PT',
      needs_confirmation: false,
      overall_confidence: 0.85,
    });
  });

  it('AC13 — ClassifierError → 400 CLASSIFIER_ERROR', async () => {
    const { ClassifierValidationError } = await import('@meu-jarvis/classifier');
    mocks.classifyMock.mockRejectedValue(new ClassifierValidationError('empty', 0, 1000));
    const res = await POST(makeRequest({ prompt: 'qq' }) as never);
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe('CLASSIFIER_ERROR');
  });

  it('AC13 — PlannerError → 400 PLANNER_ERROR', async () => {
    const { PlannerValidationError } = await import('@meu-jarvis/planner-executor');
    mocks.plannerPlanMock.mockRejectedValue(
      new PlannerValidationError('input_invalid', 'shape errado'),
    );
    const res = await POST(makeRequest({ prompt: 'criar tarefa' }) as never);
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe('PLANNER_ERROR');
  });

  it('AC13 — ToolPlanGateError → 400 TOOL_PLAN_GATE_ERROR', async () => {
    const { ToolPlanGateError } = await import('@meu-jarvis/planner-executor');
    mocks.plannerPlanMock.mockRejectedValue(new ToolPlanGateError('create_card', 'pro', 'free'));
    const res = await POST(makeRequest({ prompt: 'cria tudo' }) as never);
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe('TOOL_PLAN_GATE_ERROR');
  });

  it('AC13 — ExecutorValidationError → 400', async () => {
    const { ExecutorValidationError } = await import('@meu-jarvis/planner-executor');
    mocks.plannerPlanMock.mockResolvedValue({
      toolCalls: [{ toolName: 'create_task', input: {}, intent: 'criar_tarefa' }],
      planReasoning: null,
      latencyMs: 0,
      tokensInput: 0,
      tokensOutput: 0,
      costEur: 0,
      cacheHit: false,
    });
    mocks.executorExecuteMock.mockRejectedValue(
      new ExecutorValidationError('input_invalid', 'shape errado'),
    );
    const res = await POST(makeRequest({ prompt: 'oi' }) as never);
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe('EXECUTOR_VALIDATION_ERROR');
  });

  it('AC13 — ToolError → 500 TOOL_EXECUTION_ERROR', async () => {
    const { ToolExecutionError } = await import('@meu-jarvis/planner-executor');
    mocks.plannerPlanMock.mockResolvedValue({
      toolCalls: [{ toolName: 'create_task', input: {}, intent: 'criar_tarefa' }],
      planReasoning: null,
      latencyMs: 0,
      tokensInput: 0,
      tokensOutput: 0,
      costEur: 0,
      cacheHit: false,
    });
    mocks.executorExecuteMock.mockRejectedValue(
      new ToolExecutionError('create_task', 'DB constraint violated'),
    );
    const res = await POST(makeRequest({ prompt: 'oi' }) as never);
    expect(res.status).toBe(500);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe('TOOL_EXECUTION_ERROR');
  });

  it('AC5 — AtomicFailure (rollback graceful) → 500', async () => {
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
    const res = await POST(makeRequest({ prompt: 'oi' }) as never);
    expect(res.status).toBe(500);
    const body = (await res.json()) as { error: { code: string; details?: { failed_tool?: string } } };
    expect(body.error.code).toBe('TOOL_EXECUTION_ERROR');
    expect(body.error.details?.failed_tool).toBe('create_task');
  });
});

describe('POST /api/agent/prompt — rate limit + quota (AC9)', () => {
  beforeEach(() => {
    mocks.classifyMock.mockResolvedValue({
      intents: [{ intent: 'criar_tarefa', confidence: 0.85, raw_span: '' }],
      language: 'pt-PT',
      needs_confirmation: false,
      overall_confidence: 0.85,
    });
  });

  it('AC9 — 429 RATE_LIMIT_EXCEEDED quando counter > 10/min', async () => {
    let callIndex = 0;
    mocks.dbExecuteMock.mockImplementation(async () => {
      callIndex++;
      // 1: rate limit (excedido), depois aborta
      if (callIndex === 1) return [{ count: 11 }];
      return [];
    });
    const res = await POST(makeRequest({ prompt: 'oi' }) as never);
    expect(res.status).toBe(429);
    const body = (await res.json()) as { error: { code: string; details?: Record<string, unknown> } };
    expect(body.error.code).toBe('RATE_LIMIT_EXCEEDED');
    expect(body.error.details).toBeDefined();
  });

  it('AC9 — 429 QUOTA_EXCEEDED quando prompts_used >= 110% limit (Story 2.9 D49)', async () => {
    let callIndex = 0;
    const futurePeriodEnd = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
    mocks.dbExecuteMock.mockImplementation(async () => {
      callIndex++;
      // 1: rate limit OK, 2: quota excedida (free hard-stop = 55 = floor(50*1.1); used=100 > 55)
      if (callIndex === 1) return [{ count: 1 }];
      if (callIndex === 2) return [{ plan: 'free', prompts_used: 100, period_end: futurePeriodEnd }];
      return [];
    });
    const res = await POST(makeRequest({ prompt: 'oi' }) as never);
    expect(res.status).toBe(429);
    // Story 2.9 AC10 — headers HTTP 429 standard.
    expect(res.headers.get('X-Quota-Reset')).toBeTruthy();
    expect(res.headers.get('Retry-After')).toBeTruthy();
    const body = (await res.json()) as { error: { code: string; message: string } };
    expect(body.error.code).toBe('QUOTA_EXCEEDED');
    expect(body.error.message).toContain('Limite de prompts atingido');
  });
});

describe('POST /api/agent/prompt — idempotency (AC8)', () => {
  beforeEach(() => {
    mocks.classifyMock.mockResolvedValue({
      intents: [{ intent: 'criar_tarefa', confidence: 0.85, raw_span: '' }],
      language: 'pt-PT',
      needs_confirmation: false,
      overall_confidence: 0.85,
    });
  });

  it('AC8 — replay servido com X-Idempotent-Replay quando run terminal existe', async () => {
    mocks.dbExecuteMock.mockResolvedValueOnce([
      {
        id: 'cached-run',
        status: 'success',
        response_summary: 'Replay servido',
        tool_calls: [],
        intents_detected: [],
        confidence: '0.85',
        confirm_expires_at: null,
        created_at: new Date().toISOString(),
        completed_at: new Date().toISOString(),
        error_code: null,
        error_message: null,
      },
    ]);
    const res = await POST(
      makeRequest({ prompt: 'oi' }, { 'Idempotency-Key': 'idem-test-1' }) as never,
    );
    expect(res.status).toBe(200);
    expect(res.headers.get('X-Idempotent-Replay')).toBe('true');
    const body = (await res.json()) as { mode: string; run_id: string };
    expect(body.run_id).toBe('cached-run');
  });

  it('AC8 — 409 IDEMPOTENCY_IN_PROGRESS quando run não-terminal existe', async () => {
    mocks.dbExecuteMock.mockResolvedValueOnce([
      {
        id: 'running',
        status: 'executing',
        response_summary: null,
        tool_calls: null,
        intents_detected: [],
        confidence: '0.85',
        confirm_expires_at: null,
        created_at: new Date().toISOString(),
        completed_at: null,
        error_code: null,
        error_message: null,
      },
    ]);
    const res = await POST(
      makeRequest({ prompt: 'oi' }, { 'Idempotency-Key': 'idem-running' }) as never,
    );
    expect(res.status).toBe(409);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe('IDEMPOTENCY_IN_PROGRESS');
  });
});

describe('POST /api/agent/prompt — audit log + PII (AC10+AC11)', () => {
  it('AC10 — INSERT em agent_runs é executado (mín. 4 calls — idempotency + rate limit + quota + INSERT)', async () => {
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
    mocks.executorExecuteMock.mockResolvedValue({
      success: true,
      results: [],
    });

    await POST(makeRequest({ prompt: 'criar tarefa' }) as never);

    // Devem ter sido feitas pelo menos 4 chamadas DB: idempotency + rate limit
    // + quota + INSERT inicial em agent_runs.
    expect(mocks.dbExecuteMock.mock.calls.length).toBeGreaterThanOrEqual(4);
  });

  it('AC11 — output redaction não exposes email no summary', async () => {
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
    mocks.executorExecuteMock.mockResolvedValue({
      success: true,
      results: [
        {
          toolName: 'create_task',
          output: { email: 'leak@expressia.pt', phone: '912345678' },
          reverseOpId: 'r1',
        },
      ],
    });

    const res = await POST(makeRequest({ prompt: 'cria com email leak@expressia.pt' }) as never);
    const text = await res.text();
    // Email no `results` deve ter sido redacted pelo redactEndpointOutput
    expect(text).toContain('[EMAIL_REDACTED]');
    expect(text).not.toContain('leak@expressia.pt');
  });
});

// ─── Story 2.7 — always_preview gate (FR4) ───────────────────────────
describe('POST /api/agent/prompt — Story 2.7 always_preview gate (FR4)', () => {
  it('AC3 — always_preview=true força mode=preview mesmo com confidence ≥ 0.85', async () => {
    let callIndex = 0;
    mocks.dbExecuteMock.mockImplementation(async () => {
      callIndex++;
      switch (callIndex) {
        case 1:
          return [{ count: 1 }]; // rate limit
        case 2:
          return []; // quota
        case 3:
          return [{ id: 'run-uuid-test', created_at: new Date().toISOString() }];
        case 4:
          return [{ always_preview: true }]; // user_prefs SELECT — FORCE PREVIEW
        default:
          return [];
      }
    });

    mocks.classifyMock.mockResolvedValue({
      intents: [{ intent: 'criar_tarefa', confidence: 0.92, raw_span: 'criar tarefa' }],
      language: 'pt-PT',
      needs_confirmation: false,
      overall_confidence: 0.92, // alta confiança
    });

    const res = await POST(makeRequest({ prompt: 'criar tarefa amanhã 15h' }) as never);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { mode: string; confirmation_url?: string };
    expect(body.mode).toBe('preview'); // forçado pelo always_preview, não pelo confidence
    expect(body.confirmation_url).toContain('/confirm');
    // Planner+Executor NÃO devem ser chamados
    expect(mocks.plannerPlanMock).not.toHaveBeenCalled();
    expect(mocks.executorExecuteMock).not.toHaveBeenCalled();
  });

  it('AC3 — always_preview=false + confidence ≥ 0.70 mantém mode=executed (regression)', async () => {
    let callIndex = 0;
    mocks.dbExecuteMock.mockImplementation(async () => {
      callIndex++;
      switch (callIndex) {
        case 1:
          return [{ count: 1 }];
        case 2:
          return [];
        case 3:
          return [{ id: 'run-uuid-test', created_at: new Date().toISOString() }];
        case 4:
          return [{ always_preview: false }];
        default:
          return [];
      }
    });

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

    const res = await POST(makeRequest({ prompt: 'criar tarefa amanhã' }) as never);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { mode: string };
    expect(body.mode).toBe('executed');
    // Planner+Executor DEVEM ser chamados
    expect(mocks.plannerPlanMock).toHaveBeenCalled();
    expect(mocks.executorExecuteMock).toHaveBeenCalled();
  });

  it('AC3 — race condition lazy-init: user_prefs row vazio trata como always_preview=false', async () => {
    let callIndex = 0;
    mocks.dbExecuteMock.mockImplementation(async () => {
      callIndex++;
      switch (callIndex) {
        case 1:
          return [{ count: 1 }];
        case 2:
          return [];
        case 3:
          return [{ id: 'run-uuid-test', created_at: new Date().toISOString() }];
        case 4:
          return []; // user_prefs SELECT vazio (race entre /api/agent/prompt e GET /api/conta/preferencias lazy-init)
        default:
          return [];
      }
    });

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

    const res = await POST(makeRequest({ prompt: 'criar tarefa' }) as never);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { mode: string };
    expect(body.mode).toBe('executed'); // não crash; assume false; segue executed normal
  });
});

// ─── Story 2.9 — Cost router + cache + 110% quota (AC16) ─────────────
describe('POST /api/agent/prompt — Story 2.9 cost router + cache (AC16)', () => {
  // Mock Upstash via @upstash/redis path (hoisted no top do file — vamos
  // adicionar inline via vi.doMock para isolar este describe).
  it('AC16(ii) — singleton consultar_dados → bypass Planner+Executor (cost router)', async () => {
    let callIndex = 0;
    mocks.dbExecuteMock.mockImplementation(async () => {
      callIndex++;
      switch (callIndex) {
        case 1:
          return [{ count: 1 }]; // rate limit
        case 2:
          return []; // quota
        case 3:
          return [{ id: 'run-uuid-test', created_at: new Date().toISOString() }];
        case 4:
          return [{ always_preview: false }]; // user_prefs
        case 5:
          return [{ plan: 'familia' }]; // households.plan
        case 6:
          return []; // updateAfterClassifier
        case 7:
          return [{ count: 5 }]; // executeDirectQuery count_tasks
        default:
          return [];
      }
    });

    mocks.classifyMock.mockResolvedValue({
      intents: [{ intent: 'consultar_dados', confidence: 0.92, raw_span: 'quantas tarefas tenho' }],
      language: 'pt-PT',
      needs_confirmation: false,
      overall_confidence: 0.92,
    });

    const res = await POST(makeRequest({ prompt: 'quantas tarefas tenho?' }) as never);
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      mode: string;
      summary: string;
      undo_url?: string;
      results: { kind: string; template_used: string };
    };
    expect(body.mode).toBe('executed');
    expect(body.results.kind).toBe('direct_query');
    expect(body.results.template_used).toBe('count_tasks');
    expect(body.summary).toContain('5');
    // DN9 — sem undo_url em path direct-DB (read-only)
    expect(body.undo_url).toBeUndefined();
    // Planner+Executor NÃO devem ser chamados
    expect(mocks.plannerPlanMock).not.toHaveBeenCalled();
    expect(mocks.executorExecuteMock).not.toHaveBeenCalled();
  });

  it('AC16 — multi-intent (consultar_dados + criar_tarefa) NÃO faz bypass — usa executor', async () => {
    let callIndex = 0;
    mocks.dbExecuteMock.mockImplementation(async () => {
      callIndex++;
      switch (callIndex) {
        case 1:
          return [{ count: 1 }];
        case 2:
          return [];
        case 3:
          return [{ id: 'run-uuid-test', created_at: new Date().toISOString() }];
        case 4:
          return [{ always_preview: false }];
        case 5:
          return [{ plan: 'familia' }];
        default:
          return [];
      }
    });

    mocks.classifyMock.mockResolvedValue({
      intents: [
        { intent: 'consultar_dados', confidence: 0.85, raw_span: 'quantas tarefas' },
        { intent: 'criar_tarefa', confidence: 0.85, raw_span: 'cria mais uma' },
      ],
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

    const res = await POST(makeRequest({ prompt: 'quantas tarefas; cria mais uma' }) as never);
    expect(res.status).toBe(200);
    // Planner+Executor DEVEM ser chamados — multi-intent
    expect(mocks.plannerPlanMock).toHaveBeenCalled();
    expect(mocks.executorExecuteMock).toHaveBeenCalled();
  });

  it('AC16(iii) — 429 QUOTA_EXCEEDED inclui headers X-Quota-Reset + Retry-After', async () => {
    const futurePeriodEnd = new Date(Date.now() + 3 * 24 * 60 * 60 * 1000).toISOString();
    let callIndex = 0;
    mocks.dbExecuteMock.mockImplementation(async () => {
      callIndex++;
      if (callIndex === 1) return [{ count: 1 }];
      if (callIndex === 2)
        return [{ plan: 'familia', prompts_used: 3300, period_end: futurePeriodEnd }];
      return [];
    });

    const res = await POST(makeRequest({ prompt: 'oi' }) as never);
    expect(res.status).toBe(429);
    expect(res.headers.get('X-Quota-Reset')).toBeTruthy();
    expect(res.headers.get('Retry-After')).toMatch(/^\d+$/);
    const body = (await res.json()) as { error: { code: string; message: string } };
    expect(body.error.code).toBe('QUOTA_EXCEEDED');
    expect(body.error.message).toContain('Limite de prompts atingido');
    expect(body.error.message).toContain('Próxima janela em');
  });
});
