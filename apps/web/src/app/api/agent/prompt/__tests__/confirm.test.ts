// @vitest-environment node
/**
 * Testes do confirm endpoint — Story 2.6 AC6 + D20.
 *
 * Cobertura:
 *   - 401 sem auth
 *   - 404 run não encontrado
 *   - 409 CONFIRM_INVALID_STATE (status != pending_preview)
 *   - 409 CONFIRM_EXPIRED (TTL passou)
 *   - 200 sucesso (re-executa Planner+Executor)
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  getUserMock: vi.fn(),
  fromMock: vi.fn(),
  plannerPlanMock: vi.fn(),
  executorExecuteMock: vi.fn(),
  dbExecuteMock: vi.fn(),
}));

vi.mock('@meu-jarvis/auth/server', () => ({
  createServerSupabaseClient: vi.fn(async () => ({
    auth: { getUser: mocks.getUserMock },
    from: mocks.fromMock,
  })),
}));

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
}));

import { POST } from '@/app/api/agent/prompt/[runId]/confirm/route';

const TEST_USER_ID = '00000000-0000-0000-0000-000000000001';
const TEST_HOUSEHOLD_ID = '00000000-0000-0000-0000-0000000000a1';
const RUN_ID = '00000000-0000-0000-0000-000000000aaa';

function makeRequest(): Request {
  return new Request(`http://localhost/api/agent/prompt/${RUN_ID}/confirm`, {
    method: 'POST',
  });
}

function makeContext() {
  return { params: Promise.resolve({ runId: RUN_ID }) };
}

function setupAuth(): void {
  mocks.getUserMock.mockResolvedValue({
    data: { user: { id: TEST_USER_ID, email: 'tester@expressia.pt' } },
    error: null,
  });
  mocks.fromMock.mockReturnValue({
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    limit: vi.fn().mockReturnThis(),
    maybeSingle: vi.fn().mockResolvedValue({ data: { household_id: TEST_HOUSEHOLD_ID }, error: null }),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  setupAuth();
});

describe('POST /api/agent/prompt/[runId]/confirm', () => {
  it('AC6 — 401 sem sessão', async () => {
    mocks.getUserMock.mockResolvedValue({ data: { user: null }, error: null });
    const res = await POST(makeRequest() as never, makeContext());
    expect(res.status).toBe(401);
  });

  it('AC6 — 404 quando run não encontrado', async () => {
    mocks.dbExecuteMock.mockResolvedValue([]);
    const res = await POST(makeRequest() as never, makeContext());
    expect(res.status).toBe(404);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe('RUN_NOT_FOUND');
  });

  it('AC6 — 409 CONFIRM_INVALID_STATE quando status != pending_preview', async () => {
    mocks.dbExecuteMock.mockResolvedValue([
      {
        id: RUN_ID,
        household_id: TEST_HOUSEHOLD_ID,
        user_id: TEST_USER_ID,
        status: 'success',
        confirm_expires_at: null,
        intents_detected: [],
        trace_id: 't1',
      },
    ]);
    const res = await POST(makeRequest() as never, makeContext());
    expect(res.status).toBe(409);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe('CONFIRM_INVALID_STATE');
  });

  it('AC6 — 409 CONFIRM_EXPIRED quando TTL passou', async () => {
    const expired = new Date(Date.now() - 1000).toISOString();
    mocks.dbExecuteMock.mockResolvedValue([
      {
        id: RUN_ID,
        household_id: TEST_HOUSEHOLD_ID,
        user_id: TEST_USER_ID,
        status: 'pending_preview',
        confirm_expires_at: expired,
        intents_detected: [{ intent: 'criar_tarefa', confidence: 0.5, raw_span: '' }],
        trace_id: 't1',
      },
    ]);
    const res = await POST(makeRequest() as never, makeContext());
    expect(res.status).toBe(409);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe('CONFIRM_EXPIRED');
  });

  it('AC6 — 200 sucesso re-executa Planner+Executor', async () => {
    const future = new Date(Date.now() + 60 * 1000).toISOString();
    let callIndex = 0;
    mocks.dbExecuteMock.mockImplementation(async () => {
      callIndex++;
      // Primeira call: lookup run em pending_preview
      if (callIndex === 1) {
        return [
          {
            id: RUN_ID,
            household_id: TEST_HOUSEHOLD_ID,
            user_id: TEST_USER_ID,
            status: 'pending_preview',
            confirm_expires_at: future,
            intents_detected: [{ intent: 'criar_tarefa', confidence: 0.5, raw_span: 'qq' }],
            trace_id: 't1',
          },
        ];
      }
      // Subsequentes UPDATEs (Planner/Executor) → vazio é OK
      return [];
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
      results: [{ toolName: 'create_task', output: { id: 't1' }, reverseOpId: 'r1' }],
    });

    const res = await POST(makeRequest() as never, makeContext());
    expect(res.status).toBe(200);
    const body = (await res.json()) as { mode: string; undo_url: string };
    expect(body.mode).toBe('executed');
    expect(body.undo_url).toContain('/undo');
    expect(mocks.plannerPlanMock).toHaveBeenCalled();
    expect(mocks.executorExecuteMock).toHaveBeenCalled();
  });
});
