// @vitest-environment node
/**
 * Tests RSC `/financas/variaveis` page.tsx (Story 4.7 AC6).
 *
 * Pattern: vi.hoisted + vi.mock (consistente Story 4.6 page.test.tsx).
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  getUserMock: vi.fn(),
  resolveHouseholdIdMock: vi.fn(),
  listVariableTransactionsMock: vi.fn(),
  getVariableTxFilterOptionsMock: vi.fn(),
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
vi.mock('@/lib/finance/list-variable-transactions', () => ({
  listVariableTransactions: mocks.listVariableTransactionsMock,
  getVariableTxFilterOptions: mocks.getVariableTxFilterOptionsMock,
}));
vi.mock('@/app/(app)/financas/_components/FinanceViewTabs', () => ({
  FinanceViewTabs: () => '<FinanceViewTabs>',
}));
vi.mock('@/app/(app)/financas/_components/FinanceEmptyState', () => ({
  FinanceEmptyState: ({ variant }: { variant: string }) => `<FinanceEmptyState:${variant}>`,
}));
vi.mock('@/app/(app)/financas/_components/VariableTxFilters', () => ({
  VariableTxFilters: () => '<VariableTxFilters>',
}));
vi.mock('@/app/(app)/financas/_components/VariableTxList', () => ({
  VariableTxList: ({ rows }: { rows: { id: string }[] }) =>
    `<VariableTxList:${rows.map((r) => r.id).join(',')}>`,
}));

const { default: VariaveisPage } = await import('@/app/(app)/financas/variaveis/page');

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

const OPTIONS = { categories: [], accounts: [], cards: [] };

describe('/financas/variaveis RSC page', () => {
  beforeEach(() => {
    Object.values(mocks).forEach((m) => m.mockReset());
  });

  it('redirect /entrar quando sem sessão', async () => {
    mocks.getUserMock.mockResolvedValue({ data: { user: null } });
    mocks.redirectMock.mockImplementation(() => {
      throw new Error('REDIRECT');
    });
    await expect(VariaveisPage({ searchParams: Promise.resolve({}) })).rejects.toThrow('REDIRECT');
  });

  it('renderiza error quando household não encontrado', async () => {
    mocks.getUserMock.mockResolvedValue({ data: { user: { id: 'u1' } } });
    mocks.resolveHouseholdIdMock.mockResolvedValue(null);
    const result = await VariaveisPage({ searchParams: Promise.resolve({}) });
    expect(stringifyTree(result)).toContain('<FinanceEmptyState:error>');
  });

  it('renderiza a lista quando há transacções', async () => {
    mocks.getUserMock.mockResolvedValue({ data: { user: { id: 'u1' } } });
    mocks.resolveHouseholdIdMock.mockResolvedValue('h1');
    mocks.listVariableTransactionsMock.mockResolvedValue({
      rows: [{ id: 't1' }, { id: 't2' }],
      nextCursor: null,
    });
    mocks.getVariableTxFilterOptionsMock.mockResolvedValue(OPTIONS);
    const result = await VariaveisPage({ searchParams: Promise.resolve({}) });
    expect(stringifyTree(result)).toContain('<VariableTxList:t1,t2>');
    // SEC-4 AC8 — ambos os helpers chamados com o householdId resolvido (1.ª rede).
    expect(mocks.listVariableTransactionsMock).toHaveBeenCalledWith(
      expect.objectContaining({ householdId: 'h1' }),
    );
    expect(mocks.getVariableTxFilterOptionsMock).toHaveBeenCalledWith(
      expect.objectContaining({ householdId: 'h1' }),
    );
  });

  it('renderiza no-results quando lista vazia', async () => {
    mocks.getUserMock.mockResolvedValue({ data: { user: { id: 'u1' } } });
    mocks.resolveHouseholdIdMock.mockResolvedValue('h1');
    mocks.listVariableTransactionsMock.mockResolvedValue({ rows: [], nextCursor: null });
    mocks.getVariableTxFilterOptionsMock.mockResolvedValue(OPTIONS);
    const result = await VariaveisPage({ searchParams: Promise.resolve({}) });
    expect(stringifyTree(result)).toContain('<FinanceEmptyState:no-results>');
  });

  it('renderiza error + captureException quando o helper falha', async () => {
    mocks.getUserMock.mockResolvedValue({ data: { user: { id: 'u1' } } });
    mocks.resolveHouseholdIdMock.mockResolvedValue('h1');
    mocks.listVariableTransactionsMock.mockRejectedValue(new Error('db down'));
    mocks.getVariableTxFilterOptionsMock.mockResolvedValue(OPTIONS);
    const result = await VariaveisPage({ searchParams: Promise.resolve({}) });
    expect(stringifyTree(result)).toContain('<FinanceEmptyState:error>');
    expect(mocks.captureExceptionMock).toHaveBeenCalled();
  });
});
