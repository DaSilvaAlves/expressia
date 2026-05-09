// @vitest-environment node
/**
 * Testes do undo endpoint — Story 2.6 AC7 + D21.
 *
 * Cobertura:
 *   - 401 sem auth
 *   - 404 run não encontrado
 *   - 409 UNDO_INVALID_STATE (status != success)
 *   - 409 UNDO_ALREADY_REVERTED (status=reverted)
 *   - 409 UNDO_ALREADY_REVERTED (executed_at NOT NULL — row-level)
 *   - 409 UNDO_EXPIRED (TTL passou em todas as ops)
 *   - 200 sucesso (executa reverse ops + marca executed_at + reverted_at)
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  getUserMock: vi.fn(),
  fromMock: vi.fn(),
  dbExecuteMock: vi.fn(),
  serviceDbExecuteMock: vi.fn(),
}));

vi.mock('@meu-jarvis/auth/server', () => ({
  createServerSupabaseClient: vi.fn(async () => ({
    auth: { getUser: mocks.getUserMock },
    from: mocks.fromMock,
  })),
}));

vi.mock('@/lib/agent/db-shim', () => ({
  getDb: () => ({ execute: mocks.dbExecuteMock }),
  getServiceDb: () => ({ execute: mocks.serviceDbExecuteMock }),
}));

import { POST } from '@/app/api/agent/prompt/[runId]/undo/route';

const TEST_USER_ID = '00000000-0000-0000-0000-000000000001';
const TEST_HOUSEHOLD_ID = '00000000-0000-0000-0000-0000000000a1';
const RUN_ID = '00000000-0000-0000-0000-000000000bbb';

function makeRequest(): Request {
  return new Request(`http://localhost/api/agent/prompt/${RUN_ID}/undo`, {
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
}

beforeEach(() => {
  vi.clearAllMocks();
  setupAuth();
});

describe('POST /api/agent/prompt/[runId]/undo', () => {
  it('AC7 — 401 sem auth', async () => {
    mocks.getUserMock.mockResolvedValue({ data: { user: null }, error: null });
    const res = await POST(makeRequest() as never, makeContext());
    expect(res.status).toBe(401);
  });

  it('AC7 — 404 quando run não encontrado', async () => {
    mocks.dbExecuteMock.mockResolvedValue([]);
    const res = await POST(makeRequest() as never, makeContext());
    expect(res.status).toBe(404);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe('RUN_NOT_FOUND');
  });

  it('AC7 — 409 UNDO_INVALID_STATE quando status=failed', async () => {
    mocks.dbExecuteMock.mockResolvedValue([
      { id: RUN_ID, household_id: TEST_HOUSEHOLD_ID, status: 'failed' },
    ]);
    const res = await POST(makeRequest() as never, makeContext());
    expect(res.status).toBe(409);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe('UNDO_INVALID_STATE');
  });

  it('AC7 — 409 UNDO_ALREADY_REVERTED quando status=reverted', async () => {
    mocks.dbExecuteMock.mockResolvedValue([
      { id: RUN_ID, household_id: TEST_HOUSEHOLD_ID, status: 'reverted' },
    ]);
    const res = await POST(makeRequest() as never, makeContext());
    expect(res.status).toBe(409);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe('UNDO_ALREADY_REVERTED');
  });

  it('AC7 — 409 UNDO_EXPIRED quando todas as ops expiraram (sem ops válidas)', async () => {
    let callCount = 0;
    mocks.dbExecuteMock.mockImplementation(async () => {
      callCount++;
      if (callCount === 1) {
        return [{ id: RUN_ID, household_id: TEST_HOUSEHOLD_ID, status: 'success' }];
      }
      // Lookup com TTL filter → vazio
      if (callCount === 2) return [];
      // Verificar se há ops já executadas → todas null (expiradas)
      if (callCount === 3) return [{ executed_at: null }];
      return [];
    });
    const res = await POST(makeRequest() as never, makeContext());
    expect(res.status).toBe(409);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe('UNDO_EXPIRED');
  });

  it('AC7 — 409 UNDO_ALREADY_REVERTED quando algum executed_at NOT NULL (row-level)', async () => {
    let callCount = 0;
    mocks.dbExecuteMock.mockImplementation(async () => {
      callCount++;
      if (callCount === 1) {
        return [{ id: RUN_ID, household_id: TEST_HOUSEHOLD_ID, status: 'success' }];
      }
      if (callCount === 2) return []; // No active ops
      if (callCount === 3) return [{ executed_at: new Date().toISOString() }]; // Has executed
      return [];
    });
    const res = await POST(makeRequest() as never, makeContext());
    expect(res.status).toBe(409);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe('UNDO_ALREADY_REVERTED');
  });

  it('AC7 — 200 sucesso reverte ops via service_role + marca executed_at + reverted_at', async () => {
    const future = new Date(Date.now() + 30 * 1000).toISOString();
    let callCount = 0;
    mocks.dbExecuteMock.mockImplementation(async () => {
      callCount++;
      if (callCount === 1) {
        return [{ id: RUN_ID, household_id: TEST_HOUSEHOLD_ID, status: 'success' }];
      }
      // Active ops com TTL válido
      if (callCount === 2) {
        return [
          {
            id: 'rop-1',
            reverse_op: { kind: 'delete_row', table: 'tasks', id: 'task-1' },
            expires_at: future,
            executed_at: null,
          },
        ];
      }
      return [];
    });
    mocks.serviceDbExecuteMock.mockResolvedValue([]);

    const res = await POST(makeRequest() as never, makeContext());
    expect(res.status).toBe(200);
    const body = (await res.json()) as { reverted: boolean; run_id: string; ops_count: number };
    expect(body.reverted).toBe(true);
    expect(body.run_id).toBe(RUN_ID);
    expect(body.ops_count).toBe(1);
    // serviceDb deve ter sido chamado: 1× DELETE/UPDATE op + 1× UPDATE executed_at + 1× UPDATE reverted_at
    expect(mocks.serviceDbExecuteMock.mock.calls.length).toBeGreaterThanOrEqual(2);
  });

  it('AC7 — 200 sucesso com restore_row reverse op', async () => {
    const future = new Date(Date.now() + 30 * 1000).toISOString();
    let callCount = 0;
    mocks.dbExecuteMock.mockImplementation(async () => {
      callCount++;
      if (callCount === 1) {
        return [{ id: RUN_ID, household_id: TEST_HOUSEHOLD_ID, status: 'success' }];
      }
      if (callCount === 2) {
        return [
          {
            id: 'rop-2',
            reverse_op: {
              kind: 'restore_row',
              table: 'transactions',
              id: 'txn-1',
              snapshot: { amount: 100, description: 'old' },
            },
            expires_at: future,
            executed_at: null,
          },
        ];
      }
      return [];
    });
    mocks.serviceDbExecuteMock.mockResolvedValue([]);

    const res = await POST(makeRequest() as never, makeContext());
    expect(res.status).toBe(200);
    const body = (await res.json()) as { reverted: boolean };
    expect(body.reverted).toBe(true);
  });

  it('AC7 — 500 quando reverse op tabela não whitelisted (defesa SQL injection)', async () => {
    const future = new Date(Date.now() + 30 * 1000).toISOString();
    let callCount = 0;
    mocks.dbExecuteMock.mockImplementation(async () => {
      callCount++;
      if (callCount === 1) {
        return [{ id: RUN_ID, household_id: TEST_HOUSEHOLD_ID, status: 'success' }];
      }
      if (callCount === 2) {
        return [
          {
            id: 'rop-evil',
            reverse_op: { kind: 'delete_row', table: 'auth.users', id: 'evil' },
            expires_at: future,
            executed_at: null,
          },
        ];
      }
      return [];
    });
    mocks.serviceDbExecuteMock.mockResolvedValue([]);

    const res = await POST(makeRequest() as never, makeContext());
    expect(res.status).toBe(500);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe('INTERNAL_ERROR');
  });
});
