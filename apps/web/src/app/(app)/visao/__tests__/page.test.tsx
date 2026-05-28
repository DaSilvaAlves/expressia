// @vitest-environment node
/**
 * Tests RSC `/visao` page.tsx (Story 5.6 AC1, AC2, AC7, AC9).
 *
 * Pattern: vi.hoisted + vi.mock (consistente com `financas/este-mes/__tests__/page.test.tsx`).
 * Cobre: redirect /entrar sem sessão; user válido → render header + grid; leitura
 * de widgets_enabled com fallback ao default quando row ausente; empty-state global
 * quando todos os agregados a zero; não-empty quando ≥ 1 widget tem dados.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  getUserMock: vi.fn(),
  redirectMock: vi.fn(),
  captureExceptionMock: vi.fn(),
  executeMock: vi.fn(),
  getTasksTodayMock: vi.fn(),
  getTasksOverdueMock: vi.fn(),
  getFinancesMonthMock: vi.fn(),
  getRecurrencesNextMock: vi.fn(),
  getAccountsBalanceMock: vi.fn(),
  getCalendarWeekMock: vi.fn(),
}));

vi.mock('@meu-jarvis/auth/server', () => ({
  createServerSupabaseClient: vi.fn(async () => ({
    auth: { getUser: mocks.getUserMock },
  })),
}));

vi.mock('next/navigation', () => ({
  redirect: mocks.redirectMock,
}));

vi.mock('@meu-jarvis/observability', () => ({
  captureException: mocks.captureExceptionMock,
}));

vi.mock('@/lib/agent/db-shim', () => ({
  getDb: () => ({ execute: mocks.executeMock }),
}));

vi.mock('@/lib/visao/queries', () => ({
  getTasksToday: mocks.getTasksTodayMock,
  getTasksOverdue: mocks.getTasksOverdueMock,
  getFinancesMonth: mocks.getFinancesMonthMock,
  getRecurrencesNext: mocks.getRecurrencesNextMock,
  getAccountsBalance: mocks.getAccountsBalanceMock,
  getCalendarWeek: mocks.getCalendarWeekMock,
}));

vi.mock('@/app/(app)/visao/_components/WidgetGrid', () => ({
  WidgetGrid: () => '<WidgetGrid>',
}));
vi.mock('@/app/(app)/visao/_components/VisaoEmptyState', () => ({
  VisaoEmptyState: () => '<VisaoEmptyState>',
}));
// Story 5.7 — Client Components de config mockados (o teste RSC invoca os
// componentes-função; estes usam hooks que não existem nesse contexto).
vi.mock('@/app/(app)/visao/_components/WidgetConfigHydrator', () => ({
  WidgetConfigHydrator: () => null,
}));
vi.mock('@/app/(app)/visao/_components/AddWidgetMenu', () => ({
  AddWidgetMenu: () => '<AddWidgetMenu>',
}));
vi.mock('@/app/(app)/visao/_components/WidgetConfigStatus', () => ({
  WidgetConfigStatus: () => null,
}));

const { default: VisaoPage } = await import('@/app/(app)/visao/page');

function stringifyTree(el: unknown): string {
  if (el == null || typeof el === 'boolean') return '';
  if (typeof el === 'string' || typeof el === 'number') return String(el);
  if (Array.isArray(el)) return el.map(stringifyTree).join('');
  const node = el as { type?: unknown; props?: Record<string, unknown> & { children?: unknown } };
  if (node && typeof node === 'object' && 'props' in node) {
    if (typeof node.type === 'function') {
      const rendered = (node.type as (props: unknown) => unknown)(node.props ?? {});
      return stringifyTree(rendered);
    }
    return stringifyTree(node.props?.children);
  }
  return '';
}

/** Defaults: 5 ON (briefing, tasks_today, finance_month, recurrences_next, tasks_overdue). */
function mockAggregatesNonEmpty() {
  mocks.getTasksTodayMock.mockResolvedValue({ count: 1, tasks: [] });
  mocks.getTasksOverdueMock.mockResolvedValue({ count: 0, tasks: [] });
  mocks.getFinancesMonthMock.mockResolvedValue({
    incomeTotal: 0,
    expenseTotal: 0,
    balance: 0,
    transactionCount: 0,
    currency: 'EUR',
  });
  mocks.getRecurrencesNextMock.mockResolvedValue({ count: 0, recurrences: [] });
  mocks.getAccountsBalanceMock.mockResolvedValue({
    totalBalanceCents: 0,
    accountCount: 0,
    currency: 'EUR',
  });
  mocks.getCalendarWeekMock.mockResolvedValue({ days: [] });
}

function mockAggregatesAllEmpty() {
  mocks.getTasksTodayMock.mockResolvedValue({ count: 0, tasks: [] });
  mocks.getTasksOverdueMock.mockResolvedValue({ count: 0, tasks: [] });
  mocks.getFinancesMonthMock.mockResolvedValue({
    incomeTotal: 0,
    expenseTotal: 0,
    balance: 0,
    transactionCount: 0,
    currency: 'EUR',
  });
  mocks.getRecurrencesNextMock.mockResolvedValue({ count: 0, recurrences: [] });
  mocks.getAccountsBalanceMock.mockResolvedValue({
    totalBalanceCents: 0,
    accountCount: 0,
    currency: 'EUR',
  });
  mocks.getCalendarWeekMock.mockResolvedValue({ days: [] });
}

describe('/visao RSC page', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Por defeito, a row de prefs não existe → fallback DEFAULT_WIDGETS_ENABLED.
    mocks.executeMock.mockResolvedValue([]);
  });

  it('redirect /entrar quando sem sessão (AC1)', async () => {
    mocks.getUserMock.mockResolvedValue({ data: { user: null } });
    mocks.redirectMock.mockImplementation(() => {
      throw new Error('REDIRECT');
    });
    await expect(VisaoPage()).rejects.toThrow('REDIRECT');
    expect(mocks.redirectMock).toHaveBeenCalledWith('/entrar');
  });

  it('user válido → header de saudação + WidgetGrid (AC1, AC2)', async () => {
    mocks.getUserMock.mockResolvedValue({
      data: { user: { id: 'u1', email: 'eurico@expressia.pt', user_metadata: {} } },
    });
    mockAggregatesNonEmpty();
    const result = await VisaoPage();
    const tree = stringifyTree(result);
    expect(tree).toContain('Eurico'); // nome resolvido do email
    expect(tree).toContain('Hoje é');
    expect(tree).toContain('<WidgetGrid>');
    expect(tree).not.toContain('<VisaoEmptyState>');
  });

  it('usa user_metadata.name no header quando presente (AC2)', async () => {
    mocks.getUserMock.mockResolvedValue({
      data: { user: { id: 'u1', email: 'x@y.pt', user_metadata: { name: 'João' } } },
    });
    mockAggregatesNonEmpty();
    const tree = stringifyTree(await VisaoPage());
    expect(tree).toContain('João');
  });

  it('empty-state global quando todos os agregados a zero (AC7)', async () => {
    mocks.getUserMock.mockResolvedValue({
      data: { user: { id: 'u1', email: 'x@y.pt', user_metadata: {} } },
    });
    mockAggregatesAllEmpty();
    const tree = stringifyTree(await VisaoPage());
    expect(tree).toContain('<VisaoEmptyState>');
    expect(tree).not.toContain('<WidgetGrid>');
  });

  it('fallback gracioso ao default quando a leitura de prefs falha (AC1.c)', async () => {
    mocks.getUserMock.mockResolvedValue({
      data: { user: { id: 'u1', email: 'x@y.pt', user_metadata: {} } },
    });
    // 1ª chamada (readWidgetsEnabled) rejeita; aggregates resolvem não-vazio.
    mocks.executeMock.mockRejectedValueOnce(new Error('prefs read failed'));
    mockAggregatesNonEmpty();
    const tree = stringifyTree(await VisaoPage());
    // Não crasha — renderiza o grid com o default.
    expect(tree).toContain('<WidgetGrid>');
    expect(mocks.captureExceptionMock).toHaveBeenCalled();
  });

  it('valida widgets_enabled com WidgetsEnabledSchema (lê row existente)', async () => {
    mocks.getUserMock.mockResolvedValue({
      data: { user: { id: 'u1', email: 'x@y.pt', user_metadata: {} } },
    });
    mocks.executeMock.mockResolvedValueOnce([
      {
        widgets_enabled: {
          briefing: true,
          tasks_today: true,
          finance_month: false,
          recurrences_next: false,
          tasks_overdue: false,
          accounts_balance: false,
          calendar_week: false,
        },
      },
    ]);
    mocks.getTasksTodayMock.mockResolvedValue({ count: 3, tasks: [] });
    const tree = stringifyTree(await VisaoPage());
    expect(tree).toContain('<WidgetGrid>');
    // finance_month OFF → o agregado não deve ser consultado na heurística empty.
    expect(mocks.getFinancesMonthMock).not.toHaveBeenCalled();
  });
});
