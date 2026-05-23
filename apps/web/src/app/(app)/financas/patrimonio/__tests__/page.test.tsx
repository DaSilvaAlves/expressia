// @vitest-environment node
/**
 * Tests RSC `/financas/patrimonio` page.tsx (Story 4.9 AC7).
 *
 * Pattern: vi.hoisted + vi.mock (consistente Stories 4.6/4.7/4.8).
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  getUserMock: vi.fn(),
  resolveHouseholdIdMock: vi.fn(),
  getAccountBalancesMock: vi.fn(),
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
vi.mock('@/lib/agent/db-shim', () => ({ getDb: () => ({ execute: vi.fn() }) }));
vi.mock('@/lib/api-helpers/auth', () => ({ resolveHouseholdId: mocks.resolveHouseholdIdMock }));
vi.mock('@/lib/finance/account-balances', () => ({
  getAccountBalances: mocks.getAccountBalancesMock,
}));
vi.mock('@/app/(app)/financas/_components/FinanceViewTabs', () => ({
  FinanceViewTabs: () => '<FinanceViewTabs>',
}));
vi.mock('@/app/(app)/financas/_components/FinanceEmptyState', () => ({
  FinanceEmptyState: ({ variant }: { variant: string }) => `<FinanceEmptyState:${variant}>`,
}));
vi.mock('@/app/(app)/financas/_components/NetWorthSummary', () => ({
  NetWorthSummary: ({ totalCents, accountCount }: { totalCents: number; accountCount: number }) =>
    `<NetWorthSummary:${totalCents}:${accountCount}>`,
}));
vi.mock('@/app/(app)/financas/_components/BankGroup', () => ({
  BankGroup: ({ group }: { group: { bankName: string | null } }) =>
    `<BankGroup:${group.bankName ?? 'null'}>`,
}));

const { default: PatrimonioPage } = await import('@/app/(app)/financas/patrimonio/page');

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

describe('/financas/patrimonio RSC page', () => {
  beforeEach(() => {
    Object.values(mocks).forEach((m) => m.mockReset());
  });

  it('redirect /entrar quando sem sessão', async () => {
    mocks.getUserMock.mockResolvedValue({ data: { user: null } });
    mocks.redirectMock.mockImplementation(() => {
      throw new Error('REDIRECT');
    });
    await expect(PatrimonioPage()).rejects.toThrow('REDIRECT');
  });

  it('renderiza error quando household não encontrado', async () => {
    mocks.getUserMock.mockResolvedValue({ data: { user: { id: 'u1' } } });
    mocks.resolveHouseholdIdMock.mockResolvedValue(null);
    expect(stringifyTree(await PatrimonioPage())).toContain('<FinanceEmptyState:error>');
  });

  it('renderiza no-results quando não há contas', async () => {
    mocks.getUserMock.mockResolvedValue({ data: { user: { id: 'u1' } } });
    mocks.resolveHouseholdIdMock.mockResolvedValue('h1');
    mocks.getAccountBalancesMock.mockResolvedValue({
      groups: [],
      totalCents: 0,
      accountCount: 0,
    });
    expect(stringifyTree(await PatrimonioPage())).toContain('<FinanceEmptyState:no-results>');
  });

  it('renderiza NetWorthSummary + um BankGroup por grupo quando há contas', async () => {
    mocks.getUserMock.mockResolvedValue({ data: { user: { id: 'u1' } } });
    mocks.resolveHouseholdIdMock.mockResolvedValue('h1');
    mocks.getAccountBalancesMock.mockResolvedValue({
      groups: [
        { bankName: 'BPI', accounts: [], subtotalCents: 1000 },
        { bankName: null, accounts: [], subtotalCents: 500 },
      ],
      totalCents: 1500,
      accountCount: 2,
    });
    const tree = stringifyTree(await PatrimonioPage());
    expect(tree).toContain('<NetWorthSummary:1500:2>');
    expect(tree).toContain('<BankGroup:BPI>');
    expect(tree).toContain('<BankGroup:null>');
  });

  it('renderiza error + captureException quando o helper falha', async () => {
    mocks.getUserMock.mockResolvedValue({ data: { user: { id: 'u1' } } });
    mocks.resolveHouseholdIdMock.mockResolvedValue('h1');
    mocks.getAccountBalancesMock.mockRejectedValue(new Error('db down'));
    expect(stringifyTree(await PatrimonioPage())).toContain('<FinanceEmptyState:error>');
    expect(mocks.captureExceptionMock).toHaveBeenCalled();
  });
});
