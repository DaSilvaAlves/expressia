// @vitest-environment node
/**
 * Tests RSC `/financas/recorrentes` page.tsx (Story 4.7 AC6).
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  getUserMock: vi.fn(),
  resolveHouseholdIdMock: vi.fn(),
  listRecurrencesMock: vi.fn(),
  redirectMock: vi.fn(),
  captureExceptionMock: vi.fn(),
}));

vi.mock('@meu-jarvis/auth/server', () => ({
  createServerSupabaseClient: vi.fn(async () => ({ auth: { getUser: mocks.getUserMock } })),
}));
vi.mock('next/navigation', () => ({ redirect: mocks.redirectMock }));
vi.mock('@meu-jarvis/observability', () => ({
  captureException: mocks.captureExceptionMock,
  withSpan: (_n: unknown, _a: unknown, fn: () => unknown) => fn(),
}));
vi.mock('@/lib/agent/db-shim', () => ({
  withHousehold: (_auth: unknown, fn: (tx: unknown) => unknown) => fn({ execute: vi.fn() }),
}));
vi.mock('@/lib/api-helpers/auth', () => ({ resolveHouseholdId: mocks.resolveHouseholdIdMock }));
vi.mock('@/lib/finance/list-recurrences', () => ({
  listRecurrences: mocks.listRecurrencesMock,
}));
vi.mock('@/app/(app)/financas/_components/FinanceViewTabs', () => ({
  FinanceViewTabs: () => '<FinanceViewTabs>',
}));
vi.mock('@/app/(app)/financas/_components/FinanceEmptyState', () => ({
  FinanceEmptyState: ({ variant }: { variant: string }) => `<FinanceEmptyState:${variant}>`,
}));
vi.mock('@/app/(app)/financas/_components/RecurrenceFilters', () => ({
  RecurrenceFilters: () => '<RecurrenceFilters>',
}));
vi.mock('@/app/(app)/financas/_components/RecurrenceList', () => ({
  RecurrenceList: ({ rows }: { rows: { id: string }[] }) =>
    `<RecurrenceList:${rows.map((r) => r.id).join(',')}>`,
}));

const { default: RecorrentesPage } = await import('@/app/(app)/financas/recorrentes/page');

function stringifyTree(el: unknown): string {
  if (el == null || typeof el === 'boolean') return '';
  if (typeof el === 'string' || typeof el === 'number') return String(el);
  if (Array.isArray(el)) return el.map(stringifyTree).join('');
  const node = el as { type?: unknown; props?: Record<string, unknown> & { children?: unknown } };
  if (node && typeof node === 'object' && 'props' in node) {
    if (typeof node.type === 'function') {
      return stringifyTree((node.type as (p: unknown) => unknown)(node.props ?? {}));
    }
    return stringifyTree(node.props?.children);
  }
  return '';
}

describe('/financas/recorrentes RSC page', () => {
  beforeEach(() => {
    Object.values(mocks).forEach((m) => m.mockReset());
  });

  it('redirect /entrar quando sem sessão', async () => {
    mocks.getUserMock.mockResolvedValue({ data: { user: null } });
    mocks.redirectMock.mockImplementation(() => {
      throw new Error('REDIRECT');
    });
    await expect(RecorrentesPage({ searchParams: Promise.resolve({}) })).rejects.toThrow(
      'REDIRECT',
    );
  });

  it('renderiza a lista quando há recorrências', async () => {
    mocks.getUserMock.mockResolvedValue({ data: { user: { id: 'u1' } } });
    mocks.resolveHouseholdIdMock.mockResolvedValue('h1');
    mocks.listRecurrencesMock.mockResolvedValue({ rows: [{ id: 'r1' }, { id: 'r2' }] });
    const result = await RecorrentesPage({ searchParams: Promise.resolve({}) });
    expect(stringifyTree(result)).toContain('<RecurrenceList:r1,r2>');
    // SEC-4 AC8 — helper chamado com o householdId resolvido (1.ª rede).
    expect(mocks.listRecurrencesMock).toHaveBeenCalledWith(
      expect.objectContaining({ householdId: 'h1' }),
    );
  });

  it('renderiza no-results quando lista vazia', async () => {
    mocks.getUserMock.mockResolvedValue({ data: { user: { id: 'u1' } } });
    mocks.resolveHouseholdIdMock.mockResolvedValue('h1');
    mocks.listRecurrencesMock.mockResolvedValue({ rows: [] });
    const result = await RecorrentesPage({ searchParams: Promise.resolve({}) });
    expect(stringifyTree(result)).toContain('<FinanceEmptyState:no-results>');
  });

  it('renderiza error + captureException quando o helper falha', async () => {
    mocks.getUserMock.mockResolvedValue({ data: { user: { id: 'u1' } } });
    mocks.resolveHouseholdIdMock.mockResolvedValue('h1');
    mocks.listRecurrencesMock.mockRejectedValue(new Error('db down'));
    const result = await RecorrentesPage({ searchParams: Promise.resolve({}) });
    expect(stringifyTree(result)).toContain('<FinanceEmptyState:error>');
    expect(mocks.captureExceptionMock).toHaveBeenCalled();
  });
});
