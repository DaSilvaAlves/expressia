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
  // SEC-1-F3: resolveHouseholdId() faz `.from('household_members')` via PostgREST.
  mocks.fromMock.mockReturnValue({
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    limit: vi.fn().mockReturnThis(),
    maybeSingle: vi
      .fn()
      .mockResolvedValue({ data: { household_id: TEST_HOUSEHOLD_ID }, error: null }),
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

  it('SEC-1-F3 — a lookup de agent_runs carrega o household autenticado como parâmetro bound', async () => {
    mocks.dbExecuteMock.mockResolvedValue([]);
    await POST(makeRequest() as never, makeContext());
    // 1ª (e única) call = lookup de agent_runs filtrado por household_id.
    const sqlObj = mocks.dbExecuteMock.mock.calls[0]![0];
    expect(boundParamValues(sqlObj)).toContain(TEST_HOUSEHOLD_ID);
  });

  it('SEC-1-F3 — 404 RUN_NOT_FOUND cross-household: service_role nunca aplica reverse ops', async () => {
    // Run pertence ao household A; o utilizador autenticado é do household B.
    // A query filtra household_id = B → 0 rows → 404. Sem o filtro, o membro
    // de B reverteria mutações reais de A via service_role.
    mocks.dbExecuteMock.mockResolvedValue([]); // 0 rows (filtro household_id)
    const res = await POST(makeRequest() as never, makeContext());
    expect(res.status).toBe(404);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe('RUN_NOT_FOUND');
    // Nenhuma op aplicada via service_role.
    expect(mocks.serviceDbExecuteMock).not.toHaveBeenCalled();
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
    // Nem sequer toca na DB de runs nem no service_role.
    expect(mocks.dbExecuteMock).not.toHaveBeenCalled();
    expect(mocks.serviceDbExecuteMock).not.toHaveBeenCalled();
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

  it('Story 2.14 FIX-1 — reinsert_row de tasks re-insere a row eliminada com id original', async () => {
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
            id: 'rop-reinsert-task',
            reverse_op: {
              kind: 'reinsert_row',
              table: 'tasks',
              id: 'task-deleted-1',
              snapshot: {
                household_id: TEST_HOUSEHOLD_ID,
                title: "tarefa apagada O'Brien",
                priority: 'high',
                status: 'todo',
                is_recurrence_template: false,
                completed_at: null,
              },
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

    // O engine deve emitir um INSERT em tasks com o id original + colunas snake_case.
    const insertCall = mocks.serviceDbExecuteMock.mock.calls.find((call) => {
      const flat = JSON.stringify(call[0] ?? {});
      return /insert into tasks/i.test(flat);
    });
    expect(insertCall).toBeDefined();
    const flat = JSON.stringify(insertCall![0] ?? {});
    expect(flat).toMatch(/insert into tasks \(id, household_id, title/i);
    expect(flat).toContain('task-deleted-1'); // id original preservado
    expect(flat).toContain("O''Brien"); // string com apóstrofe escapada
    expect(flat).toMatch(/is_recurrence_template/); // boolean coluna
    expect(flat).toMatch(/completed_at/); // coluna com valor NULL
  });

  it('Story 2.14 FIX-1 / PO-FIX-2 — reinsert_row de transactions re-insere com kind (enum) + transaction_date', async () => {
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
            id: 'rop-reinsert-tx',
            reverse_op: {
              kind: 'reinsert_row',
              table: 'transactions',
              id: 'txn-deleted-1',
              snapshot: {
                household_id: TEST_HOUSEHOLD_ID,
                created_by_user_id: TEST_USER_ID,
                account_id: 'acc-1',
                card_id: null,
                category_id: 'cat-1',
                amount_cents: 1200,
                currency: 'EUR',
                kind: 'expense', // enum — re-inserido como valor literal
                description: 'almoço',
                transaction_date: '2026-06-22', // date — re-inserido como literal string
                payment_method: 'card',
                installment_id: null,
                is_projected: false,
                created_at: '2026-06-22T13:00:00Z',
              },
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
    const body = (await res.json()) as { reverted: boolean; ops_count: number };
    expect(body.reverted).toBe(true);
    expect(body.ops_count).toBe(1);

    // PO-FIX-2: o INSERT em transactions deve incluir kind (enum) e transaction_date.
    const insertCall = mocks.serviceDbExecuteMock.mock.calls.find((call) => {
      const flat = JSON.stringify(call[0] ?? {});
      return /insert into transactions/i.test(flat);
    });
    expect(insertCall).toBeDefined();
    const flat = JSON.stringify(insertCall![0] ?? {});
    expect(flat).toContain('txn-deleted-1'); // id original
    expect(flat).toMatch(/kind/); // coluna enum presente
    expect(flat).toContain('expense'); // valor enum
    expect(flat).toMatch(/transaction_date/); // coluna date presente
    expect(flat).toContain('2026-06-22'); // valor date
    expect(flat).toContain('1200'); // amount_cents numérico
    expect(flat).toMatch(/values \(/i);
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

  // ── Story 2.8 AC11 — Audit log INSERT tests ────────────────────────────

  it('AC11 (i) — 200 sucesso ALSO inserts audit_log row com action=agent_run_reverted', async () => {
    const future = new Date(Date.now() + 30 * 1000).toISOString();
    let dbCallCount = 0;
    mocks.dbExecuteMock.mockImplementation(async () => {
      dbCallCount++;
      if (dbCallCount === 1) {
        return [{ id: RUN_ID, household_id: TEST_HOUSEHOLD_ID, status: 'success' }];
      }
      if (dbCallCount === 2) {
        return [
          {
            id: 'rop-1',
            reverse_op: { kind: 'delete_row', table: 'tasks', id: 'task-1' },
            expires_at: future,
            executed_at: null,
          },
          {
            id: 'rop-2',
            reverse_op: { kind: 'delete_row', table: 'tasks', id: 'task-2' },
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

    // Verificar que serviceDb foi chamado com query INSERT audit_log com action correcto.
    const allServiceCalls = mocks.serviceDbExecuteMock.mock.calls;
    const auditCall = allServiceCalls.find((call) => {
      const queryArg = call[0] as { queryChunks?: unknown[] } | undefined;
      const flat = JSON.stringify(queryArg ?? {});
      return /insert into audit_log/i.test(flat) && /agent_run_reverted/.test(flat);
    });
    expect(auditCall).toBeDefined();
    const flat = JSON.stringify(auditCall![0] ?? {});
    expect(flat).toMatch(/agent_runs/); // entity_table
    expect(flat).toMatch(/ops_count/); // before_state contém ops_count
    expect(flat).toMatch(/reverted_at/); // after_state contém reverted_at
  });

  it('AC11 (ii) — audit_log INSERT failure NÃO aborta undo flow (response continua 200)', async () => {
    const future = new Date(Date.now() + 30 * 1000).toISOString();
    let dbCallCount = 0;
    mocks.dbExecuteMock.mockImplementation(async () => {
      dbCallCount++;
      if (dbCallCount === 1) {
        return [{ id: RUN_ID, household_id: TEST_HOUSEHOLD_ID, status: 'success' }];
      }
      if (dbCallCount === 2) {
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

    // serviceDb: reverse ops + UPDATE agent_runs OK; INSERT audit_log THROW.
    let serviceCallCount = 0;
    mocks.serviceDbExecuteMock.mockImplementation(async (queryArg) => {
      serviceCallCount++;
      const flat = JSON.stringify(queryArg ?? {});
      if (/insert into audit_log/i.test(flat)) {
        throw new Error('audit_log permission denied (simulated)');
      }
      return [];
    });

    const res = await POST(makeRequest() as never, makeContext());
    expect(res.status).toBe(200); // flow undo NÃO aborta — audit é não-fatal
    const body = (await res.json()) as { reverted: boolean; ops_count: number };
    expect(body.reverted).toBe(true);
    expect(body.ops_count).toBe(1);
    // Confirmar que houve tentativa de INSERT no audit_log antes do erro.
    expect(serviceCallCount).toBeGreaterThanOrEqual(3); // reverse op + UPDATE run + INSERT audit (throw)
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
