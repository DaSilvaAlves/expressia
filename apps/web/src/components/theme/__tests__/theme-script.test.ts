/**
 * Testes — script anti-FOUC `THEME_SCRIPT` (Story 5.8 AC1.c / AC6.b).
 *
 * O script é uma string de JS puro injectada no `<head>` que aplica a classe
 * `dark` ANTES do primeiro paint, lendo o cookie `expressia-theme`. Testamo-lo
 * avaliando a string num ambiente jsdom controlado (cookie + matchMedia) e
 * verificando o efeito em `document.documentElement`.
 *
 * Cobertura:
 *   - cookie=dark → classe `dark` aplicada
 *   - cookie=light → classe `dark` removida (ignora OS)
 *   - cookie=system + OS dark → `dark`; cookie=system + OS light → sem `dark`
 *   - sem cookie → comporta-se como `system`
 *   - forma do script: IIFE auto-contida com try/catch defensivo (não parte o doc)
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { THEME_SCRIPT } from '@/components/theme/theme-script';

/** Define `window.matchMedia` para devolver `matches` fixo. */
function setMatchMedia(matches: boolean): void {
  window.matchMedia = vi.fn().mockReturnValue({
    matches,
    media: '(prefers-color-scheme: dark)',
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
    addListener: () => undefined,
    removeListener: () => undefined,
    onchange: null,
    dispatchEvent: () => false,
  }) as unknown as typeof window.matchMedia;
}

/** Limpa o cookie de tema. */
function clearThemeCookie(): void {
  document.cookie = 'expressia-theme=; Path=/; Max-Age=0';
}

/** Executa o script anti-FOUC no contexto jsdom actual. */
function runScript(): void {
  // eslint-disable-next-line no-new-func -- testamos a string real injectada no <head>.
  new Function(THEME_SCRIPT)();
}

beforeEach(() => {
  document.documentElement.classList.remove('dark');
  clearThemeCookie();
});

afterEach(() => {
  vi.restoreAllMocks();
  document.documentElement.classList.remove('dark');
  clearThemeCookie();
});

describe('THEME_SCRIPT — forma', () => {
  it('é uma IIFE auto-contida com try/catch defensivo', () => {
    expect(THEME_SCRIPT).toContain('(function(){');
    expect(THEME_SCRIPT).toContain('try{');
    expect(THEME_SCRIPT).toContain('catch');
    expect(THEME_SCRIPT).toContain('expressia-theme');
    expect(THEME_SCRIPT).toContain("classList.toggle('dark'");
  });

  it('não lança em qualquer cenário (falha defensivamente)', () => {
    setMatchMedia(false);
    expect(() => runScript()).not.toThrow();
  });
});

describe('THEME_SCRIPT — aplicação por cookie', () => {
  it('cookie=dark → aplica classe `dark`', () => {
    setMatchMedia(false);
    document.cookie = 'expressia-theme=dark; Path=/';
    runScript();
    expect(document.documentElement.classList.contains('dark')).toBe(true);
  });

  it('cookie=light → não aplica `dark` mesmo com OS dark', () => {
    setMatchMedia(true);
    document.cookie = 'expressia-theme=light; Path=/';
    runScript();
    expect(document.documentElement.classList.contains('dark')).toBe(false);
  });
});

describe('THEME_SCRIPT — modo system / ausência de cookie (AC6.b)', () => {
  it('cookie=system + OS dark → aplica `dark`', () => {
    setMatchMedia(true);
    document.cookie = 'expressia-theme=system; Path=/';
    runScript();
    expect(document.documentElement.classList.contains('dark')).toBe(true);
  });

  it('cookie=system + OS light → não aplica `dark`', () => {
    setMatchMedia(false);
    document.cookie = 'expressia-theme=system; Path=/';
    runScript();
    expect(document.documentElement.classList.contains('dark')).toBe(false);
  });

  it('sem cookie → comporta-se como system (segue OS dark)', () => {
    setMatchMedia(true);
    clearThemeCookie();
    runScript();
    expect(document.documentElement.classList.contains('dark')).toBe(true);
  });
});
