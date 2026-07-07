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

  it('SEND-PREVIEW-1 (J-7) — envio reutiliza o plano persistido do preview (NÃO re-planeia)', async () => {
    const future = new Date(Date.now() + 60 * 1000).toISOString();
    let callIndex = 0;
    mocks.dbExecuteMock.mockImplementation(async () => {
      callIndex++;
      if (callIndex === 1) {
        return [
          {
            id: RUN_ID,
            household_id: TEST_HOUSEHOLD_ID,
            user_id: TEST_USER_ID,
            status: 'pending_preview',
            confirm_expires_at: future,
            intents_detected: [{ intent: 'enviar_email', confidence: 0.92, raw_span: 'manda email' }],
            // Plano persistido no preview (o rascunho que o utilizador reviu).
            tool_calls: [
              {
                toolName: 'enviar_email',
                input: { to: 'euricojsalves@gmail.com', subject: 'Reunião', body: 'Olá.' },
                intent: 'enviar_email',
              },
            ],
            trace_id: 't1',
          },
        ];
      }
      return [];
    });
    mocks.executorExecuteMock.mockResolvedValue({
      success: true,
      results: [
        {
          toolName: 'enviar_email',
          output: { id: 'm1', threadId: 'th1', to: 'euricojsalves@gmail.com' },
          reverseOpId: 'r1',
        },
      ],
    });

    const res = await POST(makeRequest() as never, makeContext());
    expect(res.status).toBe(200);
    const body = (await res.json()) as { mode: string; summary: string };
    expect(body.mode).toBe('executed');
    // Binding preview==envio: o Planner NÃO re-corre; o Executor recebe o plano do preview.
    expect(mocks.plannerPlanMock).not.toHaveBeenCalled();
    expect(mocks.executorExecuteMock).toHaveBeenCalled();
    const execArg = mocks.executorExecuteMock.mock.calls[0]![0] as {
      plan: { toolCalls: Array<{ toolName: string; input: Record<string, unknown> }> };
    };
    expect(execArg.plan.toolCalls[0]!.toolName).toBe('enviar_email');
    expect(execArg.plan.toolCalls[0]!.input.to).toBe('euricojsalves@gmail.com');
    // UNDO-MISLEAD-1: summary honesto — sem promessa de reversão.
    expect(body.summary).toContain('não podem ser recuperados');
    expect(body.summary).not.toMatch(/reverter/i);
  });

  it('J-8 — responder_email reutiliza o plano persistido do preview (binding preview==envio, NÃO re-planeia)', async () => {
    const future = new Date(Date.now() + 60 * 1000).toISOString();
    let callIndex = 0;
    mocks.dbExecuteMock.mockImplementation(async () => {
      callIndex++;
      if (callIndex === 1) {
        return [
          {
            id: RUN_ID,
            household_id: TEST_HOUSEHOLD_ID,
            user_id: TEST_USER_ID,
            status: 'pending_preview',
            confirm_expires_at: future,
            intents_detected: [
              { intent: 'responder_email', confidence: 0.92, raw_span: 'responde ao Pedro' },
            ],
            // Plano persistido no preview: o rascunho da resposta (threadId/messageId
            // já resolvidos), EXACTAMENTE o que o utilizador reviu.
            tool_calls: [
              {
                toolName: 'responder_email',
                input: {
                  threadId: 'thr-1',
                  messageId: '<a@mail>',
                  to: 'pedro@example.com',
                  subject: 'Jantar',
                  body: 'Confirmo que vou.',
                },
                intent: 'responder_email',
              },
            ],
            trace_id: 't1',
          },
        ];
      }
      return [];
    });
    mocks.executorExecuteMock.mockResolvedValue({
      success: true,
      results: [
        {
          toolName: 'responder_email',
          output: { id: 'm1', threadId: 'thr-1', to: 'pedro@example.com' },
          reverseOpId: 'r1',
        },
      ],
    });

    const res = await POST(makeRequest() as never, makeContext());
    expect(res.status).toBe(200);
    const body = (await res.json()) as { mode: string; summary: string };
    expect(body.mode).toBe('executed');
    // Binding preview==envio: o Planner NÃO re-corre; o Executor recebe o plano do preview.
    expect(mocks.plannerPlanMock).not.toHaveBeenCalled();
    expect(mocks.executorExecuteMock).toHaveBeenCalled();
    const execArg = mocks.executorExecuteMock.mock.calls[0]![0] as {
      plan: { toolCalls: Array<{ toolName: string; input: Record<string, unknown> }> };
    };
    expect(execArg.plan.toolCalls[0]!.toolName).toBe('responder_email');
    expect(execArg.plan.toolCalls[0]!.input.threadId).toBe('thr-1');
    expect(execArg.plan.toolCalls[0]!.input.to).toBe('pedro@example.com');
    // UNDO-MISLEAD-1: summary honesto — sem promessa de reversão.
    expect(body.summary).toContain('não podem ser recuperados');
    expect(body.summary).not.toMatch(/reverter/i);
  });

  it('M-4 — esquecer reutiliza o plano persistido do preview (binding preview==memória, NÃO re-planeia) + undo REAL', async () => {
    const future = new Date(Date.now() + 60 * 1000).toISOString();
    const MEM_ID = '44444444-4444-4444-4444-444444444444';
    let callIndex = 0;
    mocks.dbExecuteMock.mockImplementation(async () => {
      callIndex++;
      if (callIndex === 1) {
        return [
          {
            id: RUN_ID,
            household_id: TEST_HOUSEHOLD_ID,
            user_id: TEST_USER_ID,
            status: 'pending_preview',
            confirm_expires_at: future,
            intents_detected: [
              { intent: 'esquecer', confidence: 0.92, raw_span: 'esquece que odeio reuniões' },
            ],
            // Plano persistido no preview: a memória EXACTA que o utilizador viu.
            tool_calls: [
              {
                toolName: 'esquecer',
                input: { memoryId: MEM_ID, content: 'odeio reuniões antes das 10h' },
                intent: 'esquecer',
              },
            ],
            trace_id: 't1',
          },
        ];
      }
      return [];
    });
    mocks.executorExecuteMock.mockResolvedValue({
      success: true,
      results: [
        {
          toolName: 'esquecer',
          output: {
            memoryId: MEM_ID,
            content: 'odeio reuniões antes das 10h',
            snapshot: {
              household_id: TEST_HOUSEHOLD_ID,
              created_by_user_id: TEST_USER_ID,
              content: 'odeio reuniões antes das 10h',
              source: 'explicit',
              created_at: '2026-07-01T09:30:00.000Z',
            },
          },
          reverseOpId: 'r1',
        },
      ],
    });

    const res = await POST(makeRequest() as never, makeContext());
    expect(res.status).toBe(200);
    const body = (await res.json()) as { mode: string; summary: string };
    expect(body.mode).toBe('executed');
    // Binding preview==memória: o Planner NÃO re-corre; o Executor recebe o plano do preview.
    expect(mocks.plannerPlanMock).not.toHaveBeenCalled();
    expect(mocks.executorExecuteMock).toHaveBeenCalled();
    const execArg = mocks.executorExecuteMock.mock.calls[0]![0] as {
      plan: { toolCalls: Array<{ toolName: string; input: Record<string, unknown> }> };
    };
    expect(execArg.plan.toolCalls[0]!.toolName).toBe('esquecer');
    expect(execArg.plan.toolCalls[0]!.input.memoryId).toBe(MEM_ID);
    // Undo É real (esquecer NÃO é irreversível) — summary promete reversão 30s.
    expect(body.summary).toMatch(/reverter/i);
    expect(body.summary).not.toContain('não podem ser recuperados');
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
