// @vitest-environment node
/**
 * Tests RSC `/financas/cartoes` page.tsx (Story 4.8 AC7).
 *
 * Pattern: vi.hoisted + vi.mock (consistente Stories 4.6/4.7).
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  getUserMock: vi.fn(),
  resolveHouseholdIdMock: vi.fn(),
  getCardStatementsMock: vi.fn(),
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
vi.mock('@/lib/finance/list-card-statements', () => ({
  getCardStatements: mocks.getCardStatementsMock,
}));
vi.mock('@/app/(app)/financas/_components/FinanceViewTabs', () => ({
  FinanceViewTabs: () => '<FinanceViewTabs>',
}));
vi.mock('@/app/(app)/financas/_components/FinanceEmptyState', () => ({
  FinanceEmptyState: ({ variant }: { variant: string }) => `<FinanceEmptyState:${variant}>`,
}));
vi.mock('@/app/(app)/financas/_components/CardStatementCard', () => ({
  CardStatementCard: ({ card }: { card: { id: string } }) => `<CardStatementCard:${card.id}>`,
}));
// Client component (useState) — não executável no walker RSC deste teste (A3).
vi.mock('@/app/(app)/financas/_components/NewCardButton', () => ({
  NewCardButton: () => '<NewCardButton>',
}));

const { default: CartoesPage } = await import('@/app/(app)/financas/cartoes/page');

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

describe('/financas/cartoes RSC page', () => {
  beforeEach(() => {
    Object.values(mocks).forEach((m) => m.mockReset());
  });

  it('redirect /entrar quando sem sessão', async () => {
    mocks.getUserMock.mockResolvedValue({ data: { user: null } });
    mocks.redirectMock.mockImplementation(() => {
      throw new Error('REDIRECT');
    });
    await expect(CartoesPage()).rejects.toThrow('REDIRECT');
  });

  it('renderiza error quando household não encontrado', async () => {
    mocks.getUserMock.mockResolvedValue({ data: { user: { id: 'u1' } } });
    mocks.resolveHouseholdIdMock.mockResolvedValue(null);
    expect(stringifyTree(await CartoesPage())).toContain('<FinanceEmptyState:error>');
  });

  it('renderiza um CardStatementCard por cartão', async () => {
    mocks.getUserMock.mockResolvedValue({ data: { user: { id: 'u1' } } });
    mocks.resolveHouseholdIdMock.mockResolvedValue('h1');
    mocks.getCardStatementsMock.mockResolvedValue({ cards: [{ id: 'c1' }, { id: 'c2' }] });
    const tree = stringifyTree(await CartoesPage());
    expect(tree).toContain('<CardStatementCard:c1>');
    expect(tree).toContain('<CardStatementCard:c2>');
    // A3 — o botão "+ Novo" (client) é renderizado no header.
    expect(tree).toContain('<NewCardButton>');
    // SEC-4 AC8 — helper chamado com o householdId resolvido (1.ª rede).
    expect(mocks.getCardStatementsMock).toHaveBeenCalledWith(
      expect.objectContaining({ householdId: 'h1' }),
    );
  });

  it('renderiza no-results quando não há cartões', async () => {
    mocks.getUserMock.mockResolvedValue({ data: { user: { id: 'u1' } } });
    mocks.resolveHouseholdIdMock.mockResolvedValue('h1');
    mocks.getCardStatementsMock.mockResolvedValue({ cards: [] });
    expect(stringifyTree(await CartoesPage())).toContain('<FinanceEmptyState:no-results>');
  });

  it('renderiza error + captureException quando o helper falha', async () => {
    mocks.getUserMock.mockResolvedValue({ data: { user: { id: 'u1' } } });
    mocks.resolveHouseholdIdMock.mockResolvedValue('h1');
    mocks.getCardStatementsMock.mockRejectedValue(new Error('db down'));
    expect(stringifyTree(await CartoesPage())).toContain('<FinanceEmptyState:error>');
    expect(mocks.captureExceptionMock).toHaveBeenCalled();
  });
});
