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
  // SEC-8: confirm/route monta `txRunner: (fn) => withHousehold({ userId: run.user_id,
  // householdId: run.household_id }, fn)`. Executor é mockado (closure não corre),
  // mas expomos withHousehold para robustez de contrato.
  withHousehold: <T,>(_auth: unknown, fn: (tx: { execute: typeof mocks.dbExecuteMock }) => Promise<T>) =>
    fn({ execute: mocks.dbExecuteMock }),
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

  it('SEC-1-F3 — a lookup de agent_runs carrega o household autenticado como parâmetro bound', async () => {
    mocks.dbExecuteMock.mockResolvedValue([]);
    await POST(makeRequest() as never, makeContext());
    const sqlObj = mocks.dbExecuteMock.mock.calls[0]![0];
    expect(boundParamValues(sqlObj)).toContain(TEST_HOUSEHOLD_ID);
  });

  it('SEC-1-F3 — 404 RUN_NOT_FOUND cross-household: Planner/Executor nunca executam', async () => {
    // Run pertence ao household A; utilizador autenticado é do household B.
    // A query filtra household_id = B → 0 rows → 404. Sem o filtro, o membro
    // de B executaria mutações reais de A (Planner+Executor).
    mocks.dbExecuteMock.mockResolvedValue([]);
    const res = await POST(makeRequest() as never, makeContext());
    expect(res.status).toBe(404);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe('RUN_NOT_FOUND');
    expect(mocks.plannerPlanMock).not.toHaveBeenCalled();
    expect(mocks.executorExecuteMock).not.toHaveBeenCalled();
  });

  it('SEC-1-F3 — 404 quando o utilizador não tem household activo', async () => {
    mocks.fromMock.mockReturnValue({
      select: vi.fn().mockReturnThis(),
      eq: vi.fn().mockReturnThis(),
      limit: vi.fn().mockReturnThis(),
      maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
    });
    const res = await POST(makeRequest() as never, makeContext());
    expect(res.status).toBe(404);
    expect(mocks.dbExecuteMock).not.toHaveBeenCalled();
    expect(mocks.plannerPlanMock).not.toHaveBeenCalled();
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

/**
 * Extrai recursivamente os valores dos parâmetros bound de um objecto `SQL` do
 * Drizzle — prova que o `household_id` autenticado é interpolado como parâmetro
 * (isolamento app-enforced SEC-1-F3).
 */
function boundParamValues(sqlObj: unknown): unknown[] {
  const out: unknown[] = [];
  const walkChunks = (chunks: unknown): void => {
    if (!Array.isArray(chunks)) return;
    for (const chunk of chunks) {
      if (chunk != null && typeof chunk === 'object') {
        const obj = chunk as Record<string, unknown>;
        if ('queryChunks' in obj) walkChunks(obj.queryChunks);
      } else {
        out.push(chunk);
      }
    }
  };
  if (sqlObj != null && typeof sqlObj === 'object' && 'queryChunks' in (sqlObj as object)) {
    walkChunks((sqlObj as { queryChunks: unknown }).queryChunks);
  }
  return out;
}
