// @vitest-environment node
/**
 * Testes mockable-friendly — GET /api/tasks (Story 3.2 AC1 + AC6 + AC7 + AC8).
 *
 * Cobre: auth (401), validação filters (400), happy path com filters + cursor,
 * RLS leak prevention (Zod rejeita household_id em query).
 *
 * Pattern: vi.hoisted + vi.mock (Story 2.6 canonical).
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  getUserMock: vi.fn(),
  fromMock: vi.fn(),
  dbExecuteMock: vi.fn(),
}));

vi.mock('@meu-jarvis/auth/server', () => ({
  createServerSupabaseClient: vi.fn(async () => ({
    auth: { getUser: mocks.getUserMock },
    from: mocks.fromMock,
  })),
}));

vi.mock('@/lib/agent/db-shim', () => ({
  getDb: () => ({ execute: mocks.dbExecuteMock }),
  getServiceDb: () => ({ execute: mocks.dbExecuteMock }),
  // SEC-2: o handler GET passou a envolver `listTasksHelper` em `withHousehold`.
  // O mock injecta um `tx` equivalente (apenas `execute` é exercido pelo helper).
  withHousehold: (
    _auth: { userId: string; householdId: string },
    fn: (tx: { execute: typeof mocks.dbExecuteMock }) => unknown,
  ) => fn({ execute: mocks.dbExecuteMock }),
}));

import { NextRequest } from 'next/server';

const { GET } = await import('@/app/api/tasks/route');

function makeReq(url: string) {
  return new NextRequest(new Request(url));
}

function householdMemberChain(householdId: string | null) {
  return {
    select: vi.fn().mockReturnValue({
      eq: vi.fn().mockReturnValue({
        limit: vi.fn().mockReturnValue({
          maybeSingle: vi.fn().mockResolvedValue({
            data: householdId ? { household_id: householdId } : null,
            error: null,
          }),
        }),
      }),
    }),
  };
}

describe('GET /api/tasks', () => {
  beforeEach(() => {
    mocks.getUserMock.mockReset();
    mocks.fromMock.mockReset();
    mocks.dbExecuteMock.mockReset();
  });

  it('401 AUTH_REQUIRED se sem auth', async () => {
    mocks.getUserMock.mockResolvedValue({ data: { user: null }, error: null });
    const res = await GET(makeReq('http://localhost/api/tasks'));
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.error.code).toBe('AUTH_REQUIRED');
  });

  it('404 HOUSEHOLD_NOT_FOUND se user sem membership', async () => {
    mocks.getUserMock.mockResolvedValue({ data: { user: { id: 'u1' } }, error: null });
    mocks.fromMock.mockReturnValue(householdMemberChain(null));
    const res = await GET(makeReq('http://localhost/api/tasks'));
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.error.code).toBe('HOUSEHOLD_NOT_FOUND');
  });

  it('400 VALIDATION_ERROR se status filter inválido', async () => {
    mocks.getUserMock.mockResolvedValue({ data: { user: { id: 'u1' } }, error: null });
    mocks.fromMock.mockReturnValue(householdMemberChain('h1'));
    const res = await GET(makeReq('http://localhost/api/tasks?status=invalid'));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error.code).toBe('VALIDATION_ERROR');
  });

  it('400 VALIDATION_ERROR se cursor malformado', async () => {
    mocks.getUserMock.mockResolvedValue({ data: { user: { id: 'u1' } }, error: null });
    mocks.fromMock.mockReturnValue(householdMemberChain('h1'));
    const res = await GET(makeReq('http://localhost/api/tasks?cursor=garbage'));
    expect(res.status).toBe(400);
  });

  it('200 happy path retorna tasks + next_cursor null se under limit', async () => {
    mocks.getUserMock.mockResolvedValue({
      data: { user: { id: '00000000-0000-0000-0000-000000000001' } },
      error: null,
    });
    mocks.fromMock.mockReturnValue(householdMemberChain('00000000-0000-0000-0000-000000000002'));
    mocks.dbExecuteMock.mockResolvedValue([
      { id: 't1', title: 'Tarefa 1', due_date: '2026-05-20', status: 'todo' },
    ]);
    const res = await GET(makeReq('http://localhost/api/tasks'));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.tasks).toHaveLength(1);
    expect(body.next_cursor).toBeNull();
  });

  it('200 retorna next_cursor quando limit+1 rows', async () => {
    mocks.getUserMock.mockResolvedValue({
      data: { user: { id: '00000000-0000-0000-0000-000000000001' } },
      error: null,
    });
    mocks.fromMock.mockReturnValue(householdMemberChain('00000000-0000-0000-0000-000000000002'));
    const rows = Array.from({ length: 51 }, (_, i) => ({
      id: `t${i}`,
      title: `Tarefa ${i}`,
      due_date: '2026-05-20',
      status: 'todo',
    }));
    mocks.dbExecuteMock.mockResolvedValue(rows);
    const res = await GET(makeReq('http://localhost/api/tasks'));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.tasks).toHaveLength(50);
    expect(body.next_cursor).not.toBeNull();
  });

  it('200 aceita filters compostos (status + priority + due_date_from)', async () => {
    mocks.getUserMock.mockResolvedValue({
      data: { user: { id: '00000000-0000-0000-0000-000000000001' } },
      error: null,
    });
    mocks.fromMock.mockReturnValue(householdMemberChain('00000000-0000-0000-0000-000000000002'));
    mocks.dbExecuteMock.mockResolvedValue([]);
    const res = await GET(makeReq('http://localhost/api/tasks?status=todo&priority=high&due_date_from=2026-05-01'));
    expect(res.status).toBe(200);
    expect(mocks.dbExecuteMock).toHaveBeenCalled();
  });

  it('500 INTERNAL_ERROR se DB throws', async () => {
    mocks.getUserMock.mockResolvedValue({
      data: { user: { id: '00000000-0000-0000-0000-000000000001' } },
      error: null,
    });
    mocks.fromMock.mockReturnValue(householdMemberChain('00000000-0000-0000-0000-000000000002'));
    mocks.dbExecuteMock.mockRejectedValue(new Error('connection lost'));
    const res = await GET(makeReq('http://localhost/api/tasks'));
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.error.code).toBe('INTERNAL_ERROR');
    expect(body.error.message).toContain('Erro ao listar tarefas');
  });

  it('mensagem 401 está em PT-PT (CON3)', async () => {
    mocks.getUserMock.mockResolvedValue({ data: { user: null }, error: null });
    const res = await GET(makeReq('http://localhost/api/tasks'));
    const body = await res.json();
    expect(body.error.message).toMatch(/Sessão|inicie sessão/i);
  });

  // Story 3.3 — sort param (DP5-3.3 A backend extension)

  it('200 sort=due_date_asc (default) usa ORDER BY due_date asc nulls last', async () => {
    mocks.getUserMock.mockResolvedValue({
      data: { user: { id: '00000000-0000-0000-0000-000000000001' } },
      error: null,
    });
    mocks.fromMock.mockReturnValue(householdMemberChain('00000000-0000-0000-0000-000000000002'));
    mocks.dbExecuteMock.mockResolvedValue([]);
    const res = await GET(makeReq('http://localhost/api/tasks?sort=due_date_asc'));
    expect(res.status).toBe(200);
    expect(mocks.dbExecuteMock).toHaveBeenCalled();
    const sqlArg = mocks.dbExecuteMock.mock.calls[0]![0];
    const sqlText = JSON.stringify(sqlArg);
    expect(sqlText).toMatch(/due_date asc nulls last/i);
  });

  it('200 sort=created_at_desc gera ORDER BY created_at desc', async () => {
    mocks.getUserMock.mockResolvedValue({
      data: { user: { id: '00000000-0000-0000-0000-000000000001' } },
      error: null,
    });
    mocks.fromMock.mockReturnValue(householdMemberChain('00000000-0000-0000-0000-000000000002'));
    mocks.dbExecuteMock.mockResolvedValue([]);
    const res = await GET(makeReq('http://localhost/api/tasks?sort=created_at_desc'));
    expect(res.status).toBe(200);
    const sqlText = JSON.stringify(mocks.dbExecuteMock.mock.calls[0]![0]);
    expect(sqlText).toMatch(/created_at desc/i);
  });

  it('200 sort=priority_desc gera CASE expression', async () => {
    mocks.getUserMock.mockResolvedValue({
      data: { user: { id: '00000000-0000-0000-0000-000000000001' } },
      error: null,
    });
    mocks.fromMock.mockReturnValue(householdMemberChain('00000000-0000-0000-0000-000000000002'));
    mocks.dbExecuteMock.mockResolvedValue([]);
    const res = await GET(makeReq('http://localhost/api/tasks?sort=priority_desc'));
    expect(res.status).toBe(200);
    const sqlText = JSON.stringify(mocks.dbExecuteMock.mock.calls[0]![0]);
    // Story 3.6 T6.0: colunas prefixadas com tasks. para desambiguar do JOIN tags.
    expect(sqlText).toMatch(/case tasks\.priority/i);
    expect(sqlText).toMatch(/high/i);
  });

  it('200 sort=title_asc gera ORDER BY title asc', async () => {
    mocks.getUserMock.mockResolvedValue({
      data: { user: { id: '00000000-0000-0000-0000-000000000001' } },
      error: null,
    });
    mocks.fromMock.mockReturnValue(householdMemberChain('00000000-0000-0000-0000-000000000002'));
    mocks.dbExecuteMock.mockResolvedValue([]);
    const res = await GET(makeReq('http://localhost/api/tasks?sort=title_asc'));
    expect(res.status).toBe(200);
    const sqlText = JSON.stringify(mocks.dbExecuteMock.mock.calls[0]![0]);
    expect(sqlText).toMatch(/title asc/i);
  });

  it('400 VALIDATION_ERROR se sort inválido', async () => {
    mocks.getUserMock.mockResolvedValue({
      data: { user: { id: '00000000-0000-0000-0000-000000000001' } },
      error: null,
    });
    mocks.fromMock.mockReturnValue(householdMemberChain('00000000-0000-0000-0000-000000000002'));
    const res = await GET(makeReq('http://localhost/api/tasks?sort=bogus'));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error.code).toBe('VALIDATION_ERROR');
  });
});
