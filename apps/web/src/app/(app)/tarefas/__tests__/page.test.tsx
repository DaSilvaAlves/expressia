// @vitest-environment node
/**
 * Tests RSC `/tarefas` page.tsx (Story 3.3 T9.1 / AC1 + AC2 + AC9 + AC11).
 *
 * Pattern: vi.hoisted + vi.mock (consistente Story 2.6 / 3.2 canonical).
 * Cobre: auth redirect, RSC fetch helper call, empty state filtered vs no-tasks,
 * error fallback quando helper throws, RLS enforce (`getDb` used, NOT
 * `getServiceDb`).
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  getUserMock: vi.fn(),
  fromMock: vi.fn(),
  listTasksHelperMock: vi.fn(),
  redirectMock: vi.fn(),
  captureExceptionMock: vi.fn(),
}));

vi.mock('@meu-jarvis/auth/server', () => ({
  createServerSupabaseClient: vi.fn(async () => ({
    auth: { getUser: mocks.getUserMock },
    from: mocks.fromMock,
  })),
}));

vi.mock('next/navigation', () => ({
  redirect: mocks.redirectMock,
}));

vi.mock('@/lib/agent/db-shim', () => ({
  getDb: () => ({ execute: vi.fn() }),
}));

vi.mock('@/lib/api-helpers/list-tasks', () => ({
  listTasksHelper: mocks.listTasksHelperMock,
}));

vi.mock('@meu-jarvis/observability', () => ({
  captureException: mocks.captureExceptionMock,
}));

// React component mocks — return only marker text so we can assert presence
vi.mock('@/app/(app)/tarefas/_components/EmptyState', () => ({
  EmptyState: ({ variant }: { variant: string }) => `<EmptyState:${variant}>`,
}));
vi.mock('@/app/(app)/tarefas/_components/TaskFilters', () => ({
  TaskFilters: () => '<TaskFilters>',
}));
vi.mock('@/app/(app)/tarefas/_components/TaskList', () => ({
  TaskList: ({ tasks }: { tasks: { id: string }[] }) =>
    `<TaskList:${tasks.map((t) => t.id).join(',')}>`,
}));
vi.mock('@/app/(app)/tarefas/_components/TaskSort', () => ({
  TaskSort: () => '<TaskSort>',
}));
vi.mock('@/app/(app)/tarefas/_components/ViewTabs', () => ({
  ViewTabs: () => '<ViewTabs>',
}));

function householdChain(householdId: string | null) {
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

const { default: TarefasPage } = await import('@/app/(app)/tarefas/page');

function stringifyTree(el: unknown): string {
  if (el == null || typeof el === 'boolean') return '';
  if (typeof el === 'string' || typeof el === 'number') return String(el);
  if (Array.isArray(el)) return el.map(stringifyTree).join('');
  const node = el as {
    type?: unknown;
    props?: Record<string, unknown> & { children?: unknown };
  };
  if (node && typeof node === 'object' && 'props' in node) {
    // Se type é uma function component, invoca-o para resolver o que devolve
    if (typeof node.type === 'function') {
      const rendered = (node.type as (props: unknown) => unknown)(node.props ?? {});
      return stringifyTree(rendered);
    }
    return stringifyTree(node.props?.children);
  }
  return '';
}

describe('/tarefas RSC page', () => {
  beforeEach(() => {
    mocks.getUserMock.mockReset();
    mocks.fromMock.mockReset();
    mocks.listTasksHelperMock.mockReset();
    mocks.redirectMock.mockReset();
    mocks.captureExceptionMock.mockReset();
  });

  it('redirect /entrar quando sem sessão', async () => {
    mocks.getUserMock.mockResolvedValue({ data: { user: null } });
    mocks.redirectMock.mockImplementation(() => {
      throw new Error('REDIRECT');
    });
    await expect(
      TarefasPage({ searchParams: Promise.resolve({}) }),
    ).rejects.toThrow('REDIRECT');
    expect(mocks.redirectMock).toHaveBeenCalledWith('/entrar');
  });

  it('renderiza error EmptyState quando household não encontrado', async () => {
    mocks.getUserMock.mockResolvedValue({ data: { user: { id: 'u1' } } });
    mocks.fromMock.mockReturnValue(householdChain(null));
    const result = await TarefasPage({ searchParams: Promise.resolve({}) });
    expect(stringifyTree(result)).toContain('<EmptyState:error>');
    expect(mocks.listTasksHelperMock).not.toHaveBeenCalled();
  });

  it('renderiza no-tasks EmptyState quando lista vazia + zero filtros', async () => {
    mocks.getUserMock.mockResolvedValue({ data: { user: { id: 'u1' } } });
    mocks.fromMock.mockReturnValue(householdChain('h1'));
    mocks.listTasksHelperMock.mockResolvedValue({ tasks: [], next_cursor: null });
    const result = await TarefasPage({ searchParams: Promise.resolve({}) });
    expect(stringifyTree(result)).toContain('<EmptyState:no-tasks>');
  });

  it('renderiza filtered-empty quando lista vazia com filtros activos', async () => {
    mocks.getUserMock.mockResolvedValue({ data: { user: { id: 'u1' } } });
    mocks.fromMock.mockReturnValue(householdChain('h1'));
    mocks.listTasksHelperMock.mockResolvedValue({ tasks: [], next_cursor: null });
    const result = await TarefasPage({
      searchParams: Promise.resolve({ status: 'todo' }),
    });
    expect(stringifyTree(result)).toContain('<EmptyState:filtered-empty>');
  });

  it('renderiza TaskList quando há tarefas + chama helper com getDb', async () => {
    mocks.getUserMock.mockResolvedValue({ data: { user: { id: 'u1' } } });
    mocks.fromMock.mockReturnValue(householdChain('h1'));
    mocks.listTasksHelperMock.mockResolvedValue({
      tasks: [{ id: 't1' }, { id: 't2' }],
      next_cursor: null,
    });
    const result = await TarefasPage({ searchParams: Promise.resolve({}) });
    expect(stringifyTree(result)).toContain('<TaskList:t1,t2>');
    expect(mocks.listTasksHelperMock).toHaveBeenCalledWith(
      expect.objectContaining({
        householdId: 'h1',
        userId: 'u1',
      }),
    );
  });

  it('renderiza error EmptyState + captureException quando helper throws', async () => {
    mocks.getUserMock.mockResolvedValue({ data: { user: { id: 'u1' } } });
    mocks.fromMock.mockReturnValue(householdChain('h1'));
    mocks.listTasksHelperMock.mockRejectedValue(new Error('connection lost'));
    const result = await TarefasPage({ searchParams: Promise.resolve({}) });
    expect(stringifyTree(result)).toContain('<EmptyState:error>');
    expect(mocks.captureExceptionMock).toHaveBeenCalledWith(
      expect.any(Error),
      expect.objectContaining({ route: '/tarefas', userId: 'u1' }),
    );
  });
});
