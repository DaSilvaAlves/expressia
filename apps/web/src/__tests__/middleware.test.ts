// @vitest-environment node
/**
 * Testes para `apps/web/src/middleware.ts` — Story 2.7 PO_FIX_INLINE 4.
 *
 * Foco: refactor `APP_PATH_PREFIX` literal `/visao` → `APP_PATH_PREFIXES`
 * array `['/visao', '/jarvis', '/conta']`. Sem isto, `/jarvis` e
 * `/conta/preferencias` ficavam publicamente acessíveis (regression
 * NFR8 / Story 1.5 AC2).
 *
 * Estratégia: mock `@supabase/ssr.createServerClient` para controlar o
 * `getUser()` retorno; verificar que cada path protegido redirecciona
 * sem session e passa com session.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  getUserMock: vi.fn(),
}));

vi.mock('@supabase/ssr', () => ({
  createServerClient: vi.fn(() => ({
    auth: { getUser: mocks.getUserMock },
  })),
}));

import { NextRequest } from 'next/server';

import { middleware } from '@/middleware';

function makeRequest(pathname: string): NextRequest {
  // NextRequest expõe `nextUrl` (URL clone-friendly) e `cookies` mock-friendly.
  return new NextRequest(new URL(`http://localhost${pathname}`));
}

beforeEach(() => {
  vi.clearAllMocks();
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'http://localhost:54321';
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'anon-key';
});

describe('middleware — auth gate Story 2.7 PO_FIX_INLINE 4', () => {
  it('redirecciona /visao → /entrar quando sem sessão (regression Story 1.5 AC2)', async () => {
    mocks.getUserMock.mockResolvedValue({ data: { user: null } });
    const res = await middleware(makeRequest('/visao') as never);
    expect(res.status).toBe(307); // redirect
    expect(res.headers.get('location')).toContain('/entrar');
    expect(res.headers.get('location')).toContain('next=%2Fvisao');
  });

  it('redirecciona /jarvis → /entrar quando sem sessão (Story 2.7 nova rota protegida)', async () => {
    mocks.getUserMock.mockResolvedValue({ data: { user: null } });
    const res = await middleware(makeRequest('/jarvis') as never);
    expect(res.status).toBe(307);
    expect(res.headers.get('location')).toContain('/entrar');
    expect(res.headers.get('location')).toContain('next=%2Fjarvis');
  });

  it('redirecciona /conta/preferencias → /entrar quando sem sessão (Story 2.7 nova rota protegida)', async () => {
    mocks.getUserMock.mockResolvedValue({ data: { user: null } });
    const res = await middleware(makeRequest('/conta/preferencias') as never);
    expect(res.status).toBe(307);
    expect(res.headers.get('location')).toContain('/entrar');
  });

  it('NÃO redirecciona /visao quando user tem sessão (regression)', async () => {
    mocks.getUserMock.mockResolvedValue({ data: { user: { id: 'u1', email: 'x@y.pt' } } });
    const res = await middleware(makeRequest('/visao') as never);
    // Sem redirect — passa com 200 (NextResponse.next).
    expect(res.status).toBe(200);
  });

  it('NÃO redirecciona rotas públicas como /entrar mesmo sem sessão', async () => {
    mocks.getUserMock.mockResolvedValue({ data: { user: null } });
    const res = await middleware(makeRequest('/entrar') as never);
    // /entrar não está em APP_PATH_PREFIXES — passa.
    expect(res.status).toBe(200);
  });

  it('NÃO redirecciona /api/me sem sessão (apenas redirect rotas UI)', async () => {
    // /api/me NÃO está em APP_PATH_PREFIXES — middleware deixa passar
    // (a route handler própria decide 401).
    mocks.getUserMock.mockResolvedValue({ data: { user: null } });
    const res = await middleware(makeRequest('/api/me') as never);
    expect(res.status).toBe(200);
  });
});
