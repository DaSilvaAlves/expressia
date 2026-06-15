// @vitest-environment node
/**
 * Tests RSC raiz `/` page.tsx (Story 5.10 AC6/AC7).
 *
 * Pattern: vi.hoisted + vi.mock (consistente com `(app)/visao/__tests__/page.test.tsx`).
 * Cobre:
 *   - NÃO-autenticado → renderiza a landing pública: wordmark "Expressia", claim
 *     PT-PT, e DOIS CTAs (`<Link>`) com hrefs `/registar` ("Experimenta grátis")
 *     e `/entrar` ("Entrar"). `redirect` NÃO é chamado.
 *   - AUTENTICADO → `redirect('/visao')` é chamado; a landing não é renderizada.
 *
 * Trace: Story 5.10 AC6 (Teste 1 não-auth / Teste 2 auth), DP-5.10.F = B.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  getUserMock: vi.fn(),
  redirectMock: vi.fn(),
}));

vi.mock('@meu-jarvis/auth/server', () => ({
  createServerSupabaseClient: vi.fn(async () => ({
    auth: { getUser: mocks.getUserMock },
  })),
}));

vi.mock('next/navigation', () => ({
  // `redirect` real lança um erro especial (`NEXT_REDIRECT`) para abortar o
  // render do RSC. Replicamos esse comportamento para que, no caso autenticado,
  // a landing NÃO seja renderizada após o redirect (paridade com runtime).
  redirect: (...args: unknown[]) => {
    mocks.redirectMock(...args);
    throw new Error('NEXT_REDIRECT');
  },
}));

const { default: HomePage } = await import('@/app/page');

/**
 * Serializa a árvore React em string para asserções de presença de texto/hrefs,
 * sem renderer DOM (RSC env `node`). Recolhe hrefs dos elementos `<Link>`.
 */
function collectTree(el: unknown, hrefs: string[]): string {
  if (el == null || typeof el === 'boolean') return '';
  if (typeof el === 'string' || typeof el === 'number') return String(el);
  if (Array.isArray(el)) return el.map((c) => collectTree(c, hrefs)).join(' ');

  const node = el as { props?: Record<string, unknown> };
  const props = node.props ?? {};
  if (typeof props.href === 'string') hrefs.push(props.href);

  return collectTree(props.children, hrefs);
}

/** Recolhe os `className` de todos os elementos `<Link>` (href != null). */
function collectLinkClasses(el: unknown, acc: Record<string, string>): void {
  if (el == null || typeof el === 'boolean' || typeof el === 'string' || typeof el === 'number') {
    return;
  }
  if (Array.isArray(el)) {
    el.forEach((c) => collectLinkClasses(c, acc));
    return;
  }
  const node = el as { props?: Record<string, unknown> };
  const props = node.props ?? {};
  if (typeof props.href === 'string' && typeof props.className === 'string') {
    acc[props.href] = props.className;
  }
  collectLinkClasses(props.children, acc);
}

async function renderHome(): Promise<{ text: string; hrefs: string[] }> {
  const tree = await HomePage();
  const hrefs: string[] = [];
  const text = collectTree(tree, hrefs);
  return { text, hrefs };
}

describe('Story 5.10 AC6 — raiz `/` landing pública + redirect autenticado', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('não-autenticado → renderiza a landing com wordmark, claim PT-PT e 2 CTAs', async () => {
    mocks.getUserMock.mockResolvedValue({ data: { user: null } });

    const { text, hrefs } = await renderHome();

    // Wordmark
    expect(text).toContain('Expressia');
    // Claim PT-PT (tarefas + finanças + rotinas da família)
    expect(text).toContain('tarefas');
    expect(text).toContain('finanças');
    expect(text).toContain('família');
    // Labels dos 2 CTAs
    expect(text).toContain('Experimenta grátis');
    expect(text).toContain('Entrar');
    // Hrefs dos 2 CTAs
    expect(hrefs).toContain('/registar');
    expect(hrefs).toContain('/entrar');
    // Sem redirect quando não há sessão
    expect(mocks.redirectMock).not.toHaveBeenCalled();
  });

  it('AC7 — os 2 CTAs têm touch target ≥ 44px (`min-h-11`) e foco visível', async () => {
    mocks.getUserMock.mockResolvedValue({ data: { user: null } });

    const tree = await HomePage();
    const classes: Record<string, string> = {};
    collectLinkClasses(tree, classes);

    for (const href of ['/registar', '/entrar']) {
      // `min-h-11` = 2.75rem = 44px (front-end-spec §9).
      expect(classes[href]).toContain('min-h-11');
      // Foco visível por token (AC7.d).
      expect(classes[href]).toContain('focus-visible:ring');
    }
  });

  it('AC7 — landing sem cores hardcoded (só tokens do design system)', async () => {
    mocks.getUserMock.mockResolvedValue({ data: { user: null } });

    const tree = await HomePage();
    const classes: Record<string, string> = {};
    collectLinkClasses(tree, classes);
    const allClasses = Object.values(classes).join(' ');

    // Grep negativo (AC7.c) — nenhuma cor crua nos CTAs.
    expect(allClasses).not.toMatch(/bg-white|bg-black|text-black|bg-neutral-\d|ring-blue/);
    // Usa tokens semânticos.
    expect(allClasses).toContain('bg-primary');
  });

  it('autenticado → redirect(/visao) e landing não renderizada', async () => {
    mocks.getUserMock.mockResolvedValue({ data: { user: { id: 'user-123' } } });

    // O `redirect` mockado lança `NEXT_REDIRECT` (paridade com runtime), abortando
    // o render — logo `renderHome()` rejeita e a landing nunca é construída.
    await expect(renderHome()).rejects.toThrow('NEXT_REDIRECT');

    expect(mocks.redirectMock).toHaveBeenCalledWith('/visao');
    expect(mocks.redirectMock).toHaveBeenCalledTimes(1);
  });
});
