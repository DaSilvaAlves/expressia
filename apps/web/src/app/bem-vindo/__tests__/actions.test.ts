// @vitest-environment node
/**
 * Tests server action `completeOnboarding` (Story 6.2 AC6/AC7).
 *
 * Cobre: UPSERT idempotente em user_prefs.onboarding_completed_at + redirect
 * /visao?welcome=1; redirect /entrar sem sessão; redirect /entrar sem household.
 * NÃO toca em subscriptions (trial preservado — verificado por ausência de query).
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  getUserMock: vi.fn(),
  maybeSingleMock: vi.fn(),
  executeMock: vi.fn(),
  redirectMock: vi.fn(),
}));

vi.mock('@meu-jarvis/auth/server', () => ({
  createServerSupabaseClient: vi.fn(async () => ({
    auth: { getUser: mocks.getUserMock },
    from: () => ({
      select: () => ({
        eq: () => ({
          limit: () => ({
            maybeSingle: mocks.maybeSingleMock,
          }),
        }),
      }),
    }),
  })),
}));

vi.mock('next/navigation', () => ({
  redirect: mocks.redirectMock,
}));

vi.mock('@/lib/agent/db-shim', () => ({
  getDb: () => ({ execute: mocks.executeMock }),
}));

const { completeOnboarding } = await import('@/app/bem-vindo/actions');

beforeEach(() => {
  vi.clearAllMocks();
});

describe('completeOnboarding', () => {
  it('marca onboarding + redirect /visao?welcome=1 (AC7)', async () => {
    mocks.getUserMock.mockResolvedValue({ data: { user: { id: 'u1' } } });
    mocks.maybeSingleMock.mockResolvedValue({ data: { household_id: 'h1' }, error: null });
    mocks.executeMock.mockResolvedValue(undefined);

    await completeOnboarding();

    // UPSERT executado uma vez (idempotência garantida pelo `on conflict` no SQL)
    // + redirect para a /visao com o sinal do toast de boas-vindas.
    expect(mocks.executeMock).toHaveBeenCalledTimes(1);
    expect(mocks.redirectMock).toHaveBeenCalledWith('/visao?welcome=1');
  });

  it('redirect /entrar quando sem sessão', async () => {
    mocks.getUserMock.mockResolvedValue({ data: { user: null } });
    mocks.redirectMock.mockImplementation((url: string) => {
      throw new Error(`REDIRECT:${url}`);
    });
    await expect(completeOnboarding()).rejects.toThrow('REDIRECT:/entrar');
    expect(mocks.executeMock).not.toHaveBeenCalled();
  });

  it('redirect /entrar quando sem household (defensivo)', async () => {
    mocks.getUserMock.mockResolvedValue({ data: { user: { id: 'u1' } } });
    mocks.maybeSingleMock.mockResolvedValue({ data: null, error: null });
    mocks.redirectMock.mockImplementation((url: string) => {
      throw new Error(`REDIRECT:${url}`);
    });
    await expect(completeOnboarding()).rejects.toThrow('REDIRECT:/entrar');
    expect(mocks.executeMock).not.toHaveBeenCalled();
  });
});
