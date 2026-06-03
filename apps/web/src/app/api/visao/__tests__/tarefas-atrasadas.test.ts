// @vitest-environment node
/**
 * Testes — GET /api/visao/tarefas-atrasadas (Story 5.5 AC2 + AC9).
 *
 * Cobre: 401, 200 com dados (2-query pattern: count + lista), 200 sem dados.
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
  // SEC-6 — `withHousehold` executa o callback com o fake db (a transação real é
  // provada pelo gate de aplicação `db-test`, não aqui).
  withHousehold: (_auth: unknown, fn: (tx: unknown) => unknown) =>
    fn({ execute: mocks.dbExecuteMock }),
}));

const { GET } = await import('@/app/api/visao/tarefas-atrasadas/route');

function memberChain(householdId: string | null) {
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

function authed() {
  mocks.getUserMock.mockResolvedValue({
    data: { user: { id: '00000000-0000-0000-0000-000000000001' } },
    error: null,
  });
  mocks.fromMock.mockReturnValue(memberChain('00000000-0000-0000-0000-000000000002'));
}

describe('GET /api/visao/tarefas-atrasadas', () => {
  beforeEach(() => {
    mocks.getUserMock.mockReset();
    mocks.fromMock.mockReset();
    mocks.dbExecuteMock.mockReset();
  });

  it('401 AUTH_REQUIRED se sem sessão', async () => {
    mocks.getUserMock.mockResolvedValue({ data: { user: null }, error: null });
    const res = await GET();
    expect(res.status).toBe(401);
  });

  it('200 com tarefas atrasadas (count separado da lista)', async () => {
    authed();
    // 1ª chamada: COUNT — devolve total real (pode exceder LIMIT).
    mocks.dbExecuteMock.mockResolvedValueOnce([{ total: 25 }]);
    // 2ª chamada: SELECT lista (limit 20).
    mocks.dbExecuteMock.mockResolvedValueOnce([
      {
        id: '00000000-0000-0000-0000-0000000000b1',
        title: 'Renovar contrato',
        status: 'todo',
        priority: 'high',
        due_date: '2026-05-20',
        due_time: null,
      },
      {
        id: '00000000-0000-0000-0000-0000000000b2',
        title: 'Marcação dentista',
        status: 'doing',
        priority: 'medium',
        due_date: '2026-05-25',
        due_time: '14:30',
      },
    ]);
    const res = await GET();
    expect(res.status).toBe(200);
    const body = await res.json();
    // count vem do COUNT(*) (25), não do tamanho da lista (2)
    expect(body.count).toBe(25);
    expect(body.tasks).toHaveLength(2);
    expect(body.tasks[0].dueDate).toBe('2026-05-20');
    expect(body.tasks[1].dueTime).toBe('14:30');
  });

  it('200 com 0 tarefas atrasadas', async () => {
    authed();
    mocks.dbExecuteMock.mockResolvedValueOnce([{ total: 0 }]);
    mocks.dbExecuteMock.mockResolvedValueOnce([]);
    const res = await GET();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.count).toBe(0);
    expect(body.tasks).toEqual([]);
  });
});
