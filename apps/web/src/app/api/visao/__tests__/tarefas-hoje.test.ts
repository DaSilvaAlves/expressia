// @vitest-environment node
/**
 * Testes — GET /api/visao/tarefas-hoje (Story 5.5 AC1 + AC9).
 *
 * Cobre: 401 sem sessão, 200 com dados, 200 sem dados.
 * Pattern: vi.hoisted + vi.mock canónico (Story 4.3 / Story 3.2).
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
}));

const { GET } = await import('@/app/api/visao/tarefas-hoje/route');

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

describe('GET /api/visao/tarefas-hoje', () => {
  beforeEach(() => {
    mocks.getUserMock.mockReset();
    mocks.fromMock.mockReset();
    mocks.dbExecuteMock.mockReset();
  });

  it('401 AUTH_REQUIRED se sem sessão', async () => {
    mocks.getUserMock.mockResolvedValue({ data: { user: null }, error: null });
    const res = await GET();
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.error.code).toBe('AUTH_REQUIRED');
  });

  it('200 com tarefas do dia', async () => {
    authed();
    mocks.dbExecuteMock.mockResolvedValue([
      {
        id: '00000000-0000-0000-0000-0000000000a1',
        title: 'Pagar luz',
        status: 'todo',
        priority: 'high',
        due_time: '09:00',
      },
      {
        id: '00000000-0000-0000-0000-0000000000a2',
        title: 'Comprar pão',
        status: 'doing',
        priority: 'low',
        due_time: null,
      },
    ]);
    const res = await GET();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.count).toBe(2);
    expect(body.tasks).toHaveLength(2);
    expect(body.tasks[0].title).toBe('Pagar luz');
    expect(body.tasks[0].dueTime).toBe('09:00');
    expect(body.tasks[1].dueTime).toBeNull();
  });

  it('200 com lista vazia quando não há tarefas hoje', async () => {
    authed();
    mocks.dbExecuteMock.mockResolvedValue([]);
    const res = await GET();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.count).toBe(0);
    expect(body.tasks).toEqual([]);
  });
});
