// @vitest-environment node
/**
 * Testes RSC `/tarefas/kanban/page.tsx` (Story 3.4 AC1).
 *
 * Cobre: auth redirect, fetch helper + columns, empty state (0 colunas), error fallback.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { boundParamValues } from '@/lib/finance/__tests__/_sql-bound-params';

const mocks = vi.hoisted(() => ({
  getUserMock: vi.fn(),
  fromMock: vi.fn(),
  listTasksHelperMock: vi.fn(),
  dbExecuteMock: vi.fn(),
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
  getDb: () => ({ execute: mocks.dbExecuteMock }),
  // SEC-6 — `withHousehold` executa o callback com o fake db (a 2.ª rede real é
  // provada pelo gate de aplicação `db-test`).
  withHousehold: (_auth: unknown, fn: (tx: unknown) => unknown) =>
    fn({ execute: mocks.dbExecuteMock }),
}));

vi.mock('@/lib/api-helpers/list-tasks', () => ({
  listTasksHelper: mocks.listTasksHelperMock,
}));

vi.mock('@meu-jarvis/observability', () => ({
  captureException: mocks.captureExceptionMock,
}));

vi.mock('@/app/(app)/tarefas/_components/EmptyState', () => ({
  EmptyState: ({ variant }: { variant: string }) => `<EmptyState:${variant}>`,
}));
vi.mock('@/app/(app)/tarefas/_components/ViewTabs', () => ({
  ViewTabs: () => '<ViewTabs>',
}));
// Componente client com useState — o walker RSC executa componentes como funções,
// pelo que tem de ser mockado (mesmo fix do A1 em financas/variaveis).
vi.mock('@/app/(app)/tarefas/_components/NewTaskButton', () => ({
  NewTaskButton: () => '<NewTaskButton>',
}));
vi.mock('@/app/(app)/tarefas/kanban/_components/KanbanBoardClient', () => ({
  KanbanBoardClient: ({ initialColumns }: { initialColumns: { id: string }[] }) =>
    `<KanbanBoardClient:${initialColumns.map((c) => c.id).join(',')}>`,
}));
vi.mock('@/app/(app)/tarefas/_components/TagFilterSelect', () => ({
  TagFilterSelect: () => '<TagFilterSelect>',
}));

const USER_UUID = '00000000-0000-0000-0000-000000000001';
const HOUSEHOLD_UUID = '00000000-0000-0000-0000-000000000002';

function authedAsOwner() {
  mocks.getUserMock.mockResolvedValue({ data: { user: { id: USER_UUID } } });
  mocks.fromMock.mockReturnValue({
    select: () => ({
      eq: () => ({
        limit: () => ({
          maybeSingle: () => Promise.resolve({ data: { household_id: HOUSEHOLD_UUID }, error: null }),
        }),
      }),
    }),
  });
}

beforeEach(() => {
  mocks.getUserMock.mockReset();
  mocks.fromMock.mockReset();
  mocks.dbExecuteMock.mockReset();
  mocks.listTasksHelperMock.mockReset();
  mocks.redirectMock.mockReset();
  mocks.captureExceptionMock.mockReset();
});

function stringifyTree(el: unknown): string {
  if (el == null || typeof el === 'boolean') return '';
  if (typeof el === 'string' || typeof el === 'number') return String(el);
  if (Array.isArray(el)) return el.map(stringifyTree).join('');
  const node = el as {
    type?: unknown;
    props?: Record<string, unknown> & { children?: unknown };
  };
  if (node && typeof node === 'object' && 'props' in node) {
    if (typeof node.type === 'function') {
      const rendered = (node.type as (props: unknown) => unknown)(node.props ?? {});
      return stringifyTree(rendered);
    }
    return stringifyTree(node.props?.children);
  }
  return '';
}

describe('TarefasKanbanPage RSC', () => {
  it('renderiza board com colunas e tasks', async () => {
    authedAsOwner();
    mocks.dbExecuteMock.mockResolvedValue([
      {
        id: 'c1',
        name: 'A fazer',
        sort_order: 0,
        color: '#6B7280',
        is_done_column: 'false',
      },
      {
        id: 'c2',
        name: 'Em curso',
        sort_order: 1,
        color: '#6B7280',
        is_done_column: 'false',
      },
    ]);
    mocks.listTasksHelperMock.mockResolvedValue({
      tasks: [],
      next_cursor: null,
    });

    const { default: TarefasKanbanPage } = await import('@/app/(app)/tarefas/kanban/page');
    const result = await TarefasKanbanPage({
      searchParams: Promise.resolve({}),
    });
    const tree = stringifyTree(result);
    expect(tree).toContain('KanbanBoardClient');
    // A5 — o botão "+ Nova" deixou de ser disabled hardcoded e abre o NewTaskModal.
    expect(tree).toContain('<NewTaskButton>');
  });

  it('mostra "Configura pelo menos uma coluna" quando 0 colunas', async () => {
    authedAsOwner();
    mocks.dbExecuteMock.mockResolvedValue([]);
    mocks.listTasksHelperMock.mockResolvedValue({
      tasks: [],
      next_cursor: null,
    });

    const { default: TarefasKanbanPage } = await import('@/app/(app)/tarefas/kanban/page');
    const result = await TarefasKanbanPage({
      searchParams: Promise.resolve({}),
    });
    expect(stringifyTree(result)).toContain('Configura pelo menos uma coluna');
  });

  it('error fetch retorna EmptyState variant=error', async () => {
    authedAsOwner();
    mocks.dbExecuteMock.mockRejectedValue(new Error('db down'));
    mocks.listTasksHelperMock.mockRejectedValue(new Error('db down'));

    const { default: TarefasKanbanPage } = await import('@/app/(app)/tarefas/kanban/page');
    const result = await TarefasKanbanPage({
      searchParams: Promise.resolve({}),
    });
    expect(stringifyTree(result)).toContain('EmptyState:error');
    expect(mocks.captureExceptionMock).toHaveBeenCalled();
  });

  // SEC-6 AC9.2 — regressão de leak (mandatória): a query `kanban_columns` tinha
  // leak cross-household (sem filtro `household_id`). Este teste asserta que o
  // `household_id` autenticado é interpolado como parâmetro bound (1.ª rede). Se
  // alguém remover o filtro no futuro, este teste falha — o leak não reabre em silêncio.
  it('SEC-6 — query kanban_columns filtra household_id com parâmetro bound (1.ª rede)', async () => {
    authedAsOwner();
    mocks.dbExecuteMock.mockResolvedValue([]);
    mocks.listTasksHelperMock.mockResolvedValue({ tasks: [], next_cursor: null });

    const { default: TarefasKanbanPage } = await import('@/app/(app)/tarefas/kanban/page');
    await TarefasKanbanPage({ searchParams: Promise.resolve({}) });

    // A 1.ª chamada a `execute()` é a query `kanban_columns` (1.º item do Promise.all).
    const kanbanSql = mocks.dbExecuteMock.mock.calls[0]?.[0];
    expect(kanbanSql).toBeDefined();
    expect(boundParamValues(kanbanSql)).toContain(HOUSEHOLD_UUID);
  });
});
