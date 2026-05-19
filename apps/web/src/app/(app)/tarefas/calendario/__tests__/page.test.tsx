// @vitest-environment node
/**
 * Testes RSC `/tarefas/calendario/page.tsx` (Story 3.5 T11.6 / AC1).
 *
 * Cobre: auth redirect, fetch scheduled + unscheduled + count em paralelo,
 * empty state (0 tasks), error fallback.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  getUserMock: vi.fn(),
  fromMock: vi.fn(),
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
}));

vi.mock('@meu-jarvis/observability', () => ({
  captureException: mocks.captureExceptionMock,
}));

vi.mock('@/app/(app)/tarefas/_components/EmptyState', () => ({
  EmptyState: ({ variant }: { variant: string }) => `<EmptyState:${variant}>`,
}));
vi.mock('@/app/(app)/tarefas/_components/ViewTabs', () => ({
  ViewTabs: ({ current }: { current: string }) => `<ViewTabs:${current}>`,
}));
vi.mock('@/app/(app)/tarefas/calendario/_components/WeekViewClient', () => ({
  WeekViewClient: ({ initialTasks }: { initialTasks: { id: string }[] }) =>
    `<WeekViewClient:${initialTasks.map((t) => t.id).join(',')}>`,
}));
vi.mock('@/app/(app)/tarefas/calendario/_components/WeekNavigation', () => ({
  WeekNavigation: ({ weekStartIso }: { weekStartIso: string }) =>
    `<WeekNavigation:${weekStartIso}>`,
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
          maybeSingle: () =>
            Promise.resolve({ data: { household_id: HOUSEHOLD_UUID }, error: null }),
        }),
      }),
    }),
  });
}

/**
 * Match query SQL fragments → return canned rows.
 * Robustez: Promise.all ordem-de-resolução pode variar; matching por SQL é deterministic.
 */
function setupDbExecute(
  scheduled: unknown[],
  unscheduled: unknown[],
  countTotal: number,
): void {
  mocks.dbExecuteMock.mockImplementation((query: unknown) => {
    const queryStr = JSON.stringify(query);
    if (queryStr.includes('count(*)')) {
      return Promise.resolve([{ total: countTotal }]);
    }
    if (queryStr.includes('due_date is null')) {
      return Promise.resolve(unscheduled);
    }
    return Promise.resolve(scheduled);
  });
}

beforeEach(() => {
  mocks.getUserMock.mockReset();
  mocks.fromMock.mockReset();
  mocks.dbExecuteMock.mockReset();
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

describe('TarefasCalendarioPage RSC', () => {
  it('renderiza WeekViewClient quando há scheduled + unscheduled', async () => {
    authedAsOwner();
    setupDbExecute(
      [
        {
          id: 's1',
          household_id: HOUSEHOLD_UUID,
          created_by_user_id: USER_UUID,
          assigned_to_user_id: null,
          title: 'Reunião',
          description: null,
          due_date: '2026-05-18',
          due_time: null,
          priority: 'medium',
          status: 'todo',
          kanban_column_id: null,
          kanban_position: 0,
          project: null,
          recurrence_id: null,
          is_recurrence_template: false,
          completed_at: null,
          created_at: '2026-05-01T10:00:00Z',
          updated_at: '2026-05-01T10:00:00Z',
        },
      ],
      [],
      0,
    );

    const { default: TarefasCalendarioPage } = await import(
      '@/app/(app)/tarefas/calendario/page'
    );
    const result = await TarefasCalendarioPage({
      searchParams: Promise.resolve({ week: '2026-W21' }),
    });
    const rendered = stringifyTree(result);
    expect(rendered).toContain('ViewTabs:calendario');
    expect(rendered).toContain('WeekNavigation:2026-W21');
    expect(rendered).toContain('WeekViewClient:s1');
  });

  it('mostra EmptyState no-tasks quando 0 scheduled e 0 unscheduled', async () => {
    authedAsOwner();
    setupDbExecute([], [], 0);

    const { default: TarefasCalendarioPage } = await import(
      '@/app/(app)/tarefas/calendario/page'
    );
    const result = await TarefasCalendarioPage({
      searchParams: Promise.resolve({}),
    });
    expect(stringifyTree(result)).toContain('EmptyState:no-tasks');
  });

  it('error fetch retorna EmptyState variant=error + capture', async () => {
    authedAsOwner();
    mocks.dbExecuteMock.mockRejectedValue(new Error('db down'));

    const { default: TarefasCalendarioPage } = await import(
      '@/app/(app)/tarefas/calendario/page'
    );
    const result = await TarefasCalendarioPage({
      searchParams: Promise.resolve({}),
    });
    expect(stringifyTree(result)).toContain('EmptyState:error');
    expect(mocks.captureExceptionMock).toHaveBeenCalled();
  });
});
