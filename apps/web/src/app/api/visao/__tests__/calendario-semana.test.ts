// @vitest-environment node
/**
 * Testes — GET /api/visao/calendario-semana (Story 5.5 AC6 + AC9).
 *
 * Cobre: 401, 200 com tarefas em vários dias, 200 sem tarefas (7 dias com 0).
 * Usa `vi.setSystemTime` para tornar a semana determinística.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

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

const { GET } = await import('@/app/api/visao/calendario-semana/route');

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

describe('GET /api/visao/calendario-semana', () => {
  beforeEach(() => {
    mocks.getUserMock.mockReset();
    mocks.fromMock.mockReset();
    mocks.dbExecuteMock.mockReset();
    // Âncora determinística: 2026-05-28 ao meio-dia UTC (=13:00 Lisbon CEST).
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-05-28T12:00:00Z'));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('401 AUTH_REQUIRED se sem sessão', async () => {
    mocks.getUserMock.mockResolvedValue({ data: { user: null }, error: null });
    const res = await GET();
    expect(res.status).toBe(401);
  });

  it('200 sempre devolve 7 dias (zero tarefas → 7 buckets vazios)', async () => {
    authed();
    mocks.dbExecuteMock.mockResolvedValue([]);
    const res = await GET();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.days).toHaveLength(7);
    // dia 0 = hoje em Lisbon (2026-05-28 já é dia em Lisbon ao meio-dia UTC).
    expect(body.days[0].date).toBe('2026-05-28');
    expect(body.days[6].date).toBe('2026-06-03');
    for (const day of body.days) {
      expect(day.taskCount).toBe(0);
      expect(day.tasks).toEqual([]);
    }
  });

  it('200 agrupa tarefas pelo dia correcto', async () => {
    authed();
    mocks.dbExecuteMock.mockResolvedValue([
      {
        id: '00000000-0000-0000-0000-0000000000d1',
        title: 'Reunião',
        priority: 'high',
        due_date: '2026-05-28',
        due_time: '10:00',
      },
      {
        id: '00000000-0000-0000-0000-0000000000d2',
        title: 'Tomar café',
        priority: 'low',
        due_date: '2026-05-28',
        due_time: null,
      },
      {
        id: '00000000-0000-0000-0000-0000000000d3',
        title: 'Médico',
        priority: 'medium',
        due_date: '2026-05-30',
        due_time: '15:30',
      },
    ]);
    const res = await GET();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.days).toHaveLength(7);
    const day0 = body.days.find((d: { date: string }) => d.date === '2026-05-28');
    const day2 = body.days.find((d: { date: string }) => d.date === '2026-05-30');
    expect(day0.taskCount).toBe(2);
    expect(day0.tasks[0].title).toBe('Reunião');
    expect(day2.taskCount).toBe(1);
    expect(day2.tasks[0].dueTime).toBe('15:30');
  });
});
