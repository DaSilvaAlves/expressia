// @vitest-environment node
/**
 * Tests RSC `/financas/este-mes` page.tsx (Story 4.6 AC9, AC1+AC5+AC6).
 *
 * Pattern: vi.hoisted + vi.mock (consistente Story 3.3 page.test.tsx).
 * Cobre: auth redirect, household não encontrado, render com movimentos,
 * empty state sem movimentos, error fallback + captureException.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  getUserMock: vi.fn(),
  resolveHouseholdIdMock: vi.fn(),
  getMonthSummaryMock: vi.fn(),
  getMonthProjectionMock: vi.fn(),
  redirectMock: vi.fn(),
  captureExceptionMock: vi.fn(),
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
  withSpan: (_name: unknown, _attrs: unknown, fn: (span: unknown) => unknown) =>
    fn({ setAttribute: vi.fn() }),
}));

vi.mock('@/lib/agent/db-shim', () => ({
  getDb: () => ({ execute: vi.fn() }),
}));

vi.mock('@/lib/api-helpers/auth', () => ({
  resolveHouseholdId: mocks.resolveHouseholdIdMock,
}));

vi.mock('@/lib/finance/month-summary', () => ({
  getMonthSummary: mocks.getMonthSummaryMock,
}));

vi.mock('@/lib/finance/month-projection', () => ({
  getMonthProjection: mocks.getMonthProjectionMock,
}));

// Component mocks — marker text para asserção de presença.
vi.mock('@/app/(app)/financas/_components/FinanceViewTabs', () => ({
  FinanceViewTabs: () => '<FinanceViewTabs>',
}));
vi.mock('@/app/(app)/financas/_components/FinanceEmptyState', () => ({
  FinanceEmptyState: ({ variant }: { variant: string }) => `<FinanceEmptyState:${variant}>`,
}));
vi.mock('@/app/(app)/financas/_components/MonthNavigation', () => ({
  MonthNavigation: () => '<MonthNavigation>',
}));
vi.mock('@/app/(app)/financas/_components/MonthTotalsCard', () => ({
  MonthTotalsCard: () => '<MonthTotalsCard>',
}));
vi.mock('@/app/(app)/financas/_components/CategoryBreakdown', () => ({
  CategoryBreakdown: () => '<CategoryBreakdown>',
}));
vi.mock('@/app/(app)/financas/_components/DayBreakdown', () => ({
  DayBreakdown: () => '<DayBreakdown>',
}));
vi.mock('@/app/(app)/financas/_components/ProjectionPanel', () => ({
  ProjectionPanel: () => '<ProjectionPanel>',
}));

const { default: FinancasEsteMesPage } = await import('@/app/(app)/financas/este-mes/page');

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

const EMPTY_SUMMARY = {
  totalIncomeCents: 0,
  totalExpenseCents: 0,
  netCents: 0,
  byCategory: [],
  byDay: [],
};

const SUMMARY_WITH_DATA = {
  totalIncomeCents: 250000,
  totalExpenseCents: 88000,
  netCents: 162000,
  byCategory: [
    { categoryId: 'c1', categoryName: 'Supermercado', kind: 'expense', totalCents: 88000, txCount: 4 },
  ],
  byDay: [{ day: '2026-05-10', expenseCents: 88000, incomeCents: 250000 }],
};

const PROJECTION = {
  windowEnd: '2026-06-21',
  items: [],
  projectedIncomeCents: 0,
  projectedExpenseCents: 0,
};

describe('/financas/este-mes RSC page', () => {
  beforeEach(() => {
    mocks.getUserMock.mockReset();
    mocks.resolveHouseholdIdMock.mockReset();
    mocks.getMonthSummaryMock.mockReset();
    mocks.getMonthProjectionMock.mockReset();
    mocks.redirectMock.mockReset();
    mocks.captureExceptionMock.mockReset();
  });

  it('redirect /entrar quando sem sessão', async () => {
    mocks.getUserMock.mockResolvedValue({ data: { user: null } });
    mocks.redirectMock.mockImplementation(() => {
      throw new Error('REDIRECT');
    });
    await expect(
      FinancasEsteMesPage({ searchParams: Promise.resolve({}) }),
    ).rejects.toThrow('REDIRECT');
    expect(mocks.redirectMock).toHaveBeenCalledWith('/entrar');
  });

  it('renderiza error quando household não encontrado', async () => {
    mocks.getUserMock.mockResolvedValue({ data: { user: { id: 'u1' } } });
    mocks.resolveHouseholdIdMock.mockResolvedValue(null);
    const result = await FinancasEsteMesPage({ searchParams: Promise.resolve({}) });
    expect(stringifyTree(result)).toContain('<FinanceEmptyState:error>');
    expect(mocks.getMonthSummaryMock).not.toHaveBeenCalled();
  });

  it('renderiza totais + breakdowns quando há movimentos', async () => {
    mocks.getUserMock.mockResolvedValue({ data: { user: { id: 'u1' } } });
    mocks.resolveHouseholdIdMock.mockResolvedValue('h1');
    mocks.getMonthSummaryMock.mockResolvedValue(SUMMARY_WITH_DATA);
    mocks.getMonthProjectionMock.mockResolvedValue(PROJECTION);
    const result = await FinancasEsteMesPage({ searchParams: Promise.resolve({}) });
    const tree = stringifyTree(result);
    expect(tree).toContain('<MonthTotalsCard>');
    expect(tree).toContain('<CategoryBreakdown>');
    expect(tree).toContain('<DayBreakdown>');
  });

  it('renderiza no-movements quando o mês não tem transacções reais', async () => {
    mocks.getUserMock.mockResolvedValue({ data: { user: { id: 'u1' } } });
    mocks.resolveHouseholdIdMock.mockResolvedValue('h1');
    mocks.getMonthSummaryMock.mockResolvedValue(EMPTY_SUMMARY);
    mocks.getMonthProjectionMock.mockResolvedValue(PROJECTION);
    const result = await FinancasEsteMesPage({ searchParams: Promise.resolve({}) });
    expect(stringifyTree(result)).toContain('<FinanceEmptyState:no-movements>');
  });

  it('renderiza error + captureException quando getMonthSummary falha', async () => {
    mocks.getUserMock.mockResolvedValue({ data: { user: { id: 'u1' } } });
    mocks.resolveHouseholdIdMock.mockResolvedValue('h1');
    mocks.getMonthSummaryMock.mockRejectedValue(new Error('connection lost'));
    const result = await FinancasEsteMesPage({ searchParams: Promise.resolve({}) });
    expect(stringifyTree(result)).toContain('<FinanceEmptyState:error>');
    expect(mocks.captureExceptionMock).toHaveBeenCalledWith(
      expect.any(Error),
      expect.objectContaining({ route: '/financas/este-mes', userId: 'u1' }),
    );
  });
});
