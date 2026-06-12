// @vitest-environment node
/**
 * Testes — `revalidateTaskViews` (W2 make-it-work).
 *
 * Garante que o helper revalida TODAS as vistas que dependem do estado das
 * tarefas (em particular `/visao`, a fonte do bug stale) e que é best-effort
 * (nunca lança, mesmo se `revalidatePath` falhar fora de um request context).
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  revalidatePathMock: vi.fn(),
}));

vi.mock('next/cache', () => ({
  revalidatePath: mocks.revalidatePathMock,
}));

const { revalidateTaskViews, revalidateFinanceViews } = await import(
  '@/lib/api-helpers/revalidate'
);

describe('revalidateTaskViews', () => {
  beforeEach(() => {
    mocks.revalidatePathMock.mockReset();
  });

  it('revalida /visao (a vista que ficava stale após mutações)', () => {
    revalidateTaskViews();
    expect(mocks.revalidatePathMock).toHaveBeenCalledWith('/visao');
  });

  it('revalida as três vistas de /tarefas (Lista, Kanban, Calendário)', () => {
    revalidateTaskViews();
    const paths = mocks.revalidatePathMock.mock.calls.map((c) => c[0]);
    expect(paths).toEqual(
      expect.arrayContaining(['/visao', '/tarefas', '/tarefas/kanban', '/tarefas/calendario']),
    );
  });

  it('é best-effort — não lança se revalidatePath falhar', () => {
    mocks.revalidatePathMock.mockImplementation(() => {
      throw new Error('revalidatePath fora de request context');
    });
    expect(() => revalidateTaskViews()).not.toThrow();
    // Tenta todos os paths mesmo quando um falha.
    expect(mocks.revalidatePathMock).toHaveBeenCalledTimes(4);
  });
});

describe('revalidateFinanceViews', () => {
  beforeEach(() => {
    mocks.revalidatePathMock.mockReset();
  });

  it('revalida /visao e as vistas de /financas que derivam das transacções', () => {
    revalidateFinanceViews();
    const paths = mocks.revalidatePathMock.mock.calls.map((c) => c[0]);
    expect(paths).toEqual(
      expect.arrayContaining([
        '/visao',
        '/financas/este-mes',
        '/financas/variaveis',
        '/financas/patrimonio',
        '/financas/cartoes',
        '/financas/recorrentes',
      ]),
    );
  });

  it('é best-effort — não lança se revalidatePath falhar', () => {
    mocks.revalidatePathMock.mockImplementation(() => {
      throw new Error('revalidatePath fora de request context');
    });
    expect(() => revalidateFinanceViews()).not.toThrow();
    expect(mocks.revalidatePathMock).toHaveBeenCalledTimes(6);
  });
});
