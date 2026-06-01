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
import { readdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

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

import { APP_PATH_PREFIXES, middleware } from '@/middleware';

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

describe('middleware — auth gate Story 5.0-hotfix (/tarefas + /financas, AC2)', () => {
  // Regressão do bypass NFR8 [SEC-MW-F1]: antes do hotfix, `/tarefas` e
  // `/financas` (Epics 3 e 4) NÃO estavam em APP_PATH_PREFIXES, logo o auth
  // gate nunca redireccionava utilizadores anónimos dessas árvores.
  it('redirecciona /tarefas → /entrar quando sem sessão', async () => {
    mocks.getUserMock.mockResolvedValue({ data: { user: null } });
    const res = await middleware(makeRequest('/tarefas') as never);
    expect(res.status).toBe(307);
    expect(res.headers.get('location')).toContain('/entrar');
    expect(res.headers.get('location')).toContain('next=%2Ftarefas');
  });

  it('redirecciona /tarefas/kanban (sub-rota) → /entrar quando sem sessão', async () => {
    mocks.getUserMock.mockResolvedValue({ data: { user: null } });
    const res = await middleware(makeRequest('/tarefas/kanban') as never);
    expect(res.status).toBe(307);
    expect(res.headers.get('location')).toContain('/entrar');
  });

  it('redirecciona /financas → /entrar quando sem sessão', async () => {
    mocks.getUserMock.mockResolvedValue({ data: { user: null } });
    const res = await middleware(makeRequest('/financas') as never);
    expect(res.status).toBe(307);
    expect(res.headers.get('location')).toContain('/entrar');
    expect(res.headers.get('location')).toContain('next=%2Ffinancas');
  });

  it('redirecciona /financas/este-mes (sub-rota) → /entrar quando sem sessão', async () => {
    mocks.getUserMock.mockResolvedValue({ data: { user: null } });
    const res = await middleware(makeRequest('/financas/este-mes') as never);
    expect(res.status).toBe(307);
    expect(res.headers.get('location')).toContain('/entrar');
  });

  it('NÃO redirecciona /tarefas quando user tem sessão', async () => {
    mocks.getUserMock.mockResolvedValue({ data: { user: { id: 'u1', email: 'x@y.pt' } } });
    const res = await middleware(makeRequest('/tarefas') as never);
    // Sem redirect — passa com 200 (NextResponse.next).
    expect(res.status).toBe(200);
  });
});

describe('middleware — auth gate Story 6.2 (/bem-vindo, AC1)', () => {
  // `/bem-vindo` é rota TOP-LEVEL (fullscreen sem AppShell), logo NÃO é apanhada
  // pelo teste de cobertura auto-mantido de `(app)/`. Testada explicitamente aqui.
  it('redirecciona /bem-vindo → /entrar quando sem sessão', async () => {
    mocks.getUserMock.mockResolvedValue({ data: { user: null } });
    const res = await middleware(makeRequest('/bem-vindo') as never);
    expect(res.status).toBe(307);
    expect(res.headers.get('location')).toContain('/entrar');
    expect(res.headers.get('location')).toContain('next=%2Fbem-vindo');
  });

  it('NÃO redirecciona /bem-vindo quando user tem sessão', async () => {
    mocks.getUserMock.mockResolvedValue({ data: { user: { id: 'u1', email: 'x@y.pt' } } });
    const res = await middleware(makeRequest('/bem-vindo') as never);
    expect(res.status).toBe(200);
  });
});

describe('middleware — cobertura auto-mantida do auth gate (Story 5.0-hotfix AC3, DP-HF.A)', () => {
  // Anti-reincidência (CO-2): este bug já reincidiu 2× porque adicionar uma
  // rota `(app)/` nova não obriga a actualizar APP_PATH_PREFIXES. Este teste
  // enumera os segmentos de topo reais de `app/(app)/` e exige que CADA um
  // esteja coberto pelo auth gate — uma rota futura descoberta PARTE o build.
  const appDir = resolve(dirname(fileURLToPath(import.meta.url)), '../app/(app)');

  function appRouteSegments(): string[] {
    return readdirSync(appDir, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .filter((name) => !name.startsWith('_') && !name.startsWith('('));
  }

  function isCovered(segment: string): boolean {
    return APP_PATH_PREFIXES.some((prefix) => `/${segment}`.startsWith(prefix));
  }

  it('todos os segmentos de topo de (app)/ estão cobertos por APP_PATH_PREFIXES', () => {
    const segments = appRouteSegments();
    // Sanity: o enumerador encontrou rotas reais (não um directório vazio).
    expect(segments.length).toBeGreaterThan(0);

    const uncovered = segments.filter((segment) => !isCovered(segment));
    expect(uncovered).toEqual([]);
  });

  it('o mecanismo de cobertura FALHA para uma rota (app)/ não coberta (meta-verificação)', () => {
    // Prova que o assert acima realmente apanha uma rota descoberta: um segmento
    // fictício sem prefixo correspondente NÃO é coberto → o teste de cima falharia.
    expect(isCovered('rota-fantasma-sem-auth-gate')).toBe(false);
  });
});
