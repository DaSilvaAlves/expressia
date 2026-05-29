/**
 * Testes — `<ThemeProvider>` + `useTheme()` (Story 5.8 AC1.d / AC6 / AC7).
 *
 * Cobertura:
 *   - aplica classe `dark` no `<html>` quando `initialTheme='dark'`
 *   - NÃO aplica `dark` quando `initialTheme='light'` (ignora matchMedia)
 *   - `system` + matchMedia(dark) → aplica `dark`; `system` + matchMedia(light) → sem `dark`
 *   - reage a mudança de OS em modo `system` (listener matchMedia)
 *   - `useTheme().setTheme` é optimistic: muda o DOM + escreve cookie `expressia-theme`
 *   - `useTheme()` fora do provider lança erro
 *
 * Lição FIX-1 (5.7): a mutação do `<html>` é em `useEffect` — testamos o efeito
 * pós-render (não o corpo do render). `matchMedia` é mockado por teste (não há
 * mock global em `vitest.setup.ts`).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, render, renderHook, screen } from '@testing-library/react';

import { ThemeProvider, useTheme } from '@/components/theme/ThemeProvider';

type MqlListener = (event: MediaQueryListEvent) => void;

/** Instala um mock controlável de `window.matchMedia`. */
function installMatchMedia(matches: boolean): { fire: (next: boolean) => void } {
  const listeners = new Set<MqlListener>();
  const mql = {
    matches,
    media: '(prefers-color-scheme: dark)',
    addEventListener: (_: string, cb: MqlListener) => listeners.add(cb),
    removeEventListener: (_: string, cb: MqlListener) => listeners.delete(cb),
    // APIs legacy — não usadas pela implementação mas presentes no tipo.
    addListener: () => undefined,
    removeListener: () => undefined,
    onchange: null,
    dispatchEvent: () => false,
  };
  window.matchMedia = vi.fn().mockReturnValue(mql) as unknown as typeof window.matchMedia;
  return {
    fire: (next: boolean) => {
      mql.matches = next;
      listeners.forEach((cb) => cb({ matches: next } as MediaQueryListEvent));
    },
  };
}

beforeEach(() => {
  document.documentElement.classList.remove('dark');
  document.cookie = 'expressia-theme=; Path=/; Max-Age=0';
});

afterEach(() => {
  vi.restoreAllMocks();
  document.documentElement.classList.remove('dark');
});

describe('<ThemeProvider> — aplicação da classe dark (AC1.d)', () => {
  it('initialTheme="dark" → adiciona classe `dark` ao <html>', () => {
    installMatchMedia(false);
    render(
      <ThemeProvider initialTheme="dark">
        <span>conteudo</span>
      </ThemeProvider>,
    );
    expect(document.documentElement.classList.contains('dark')).toBe(true);
  });

  it('initialTheme="light" → NÃO adiciona `dark` mesmo com OS em dark', () => {
    installMatchMedia(true); // OS prefere dark, mas `light` ignora-o
    render(
      <ThemeProvider initialTheme="light">
        <span>conteudo</span>
      </ThemeProvider>,
    );
    expect(document.documentElement.classList.contains('dark')).toBe(false);
  });
});

describe('<ThemeProvider> — modo system segue o OS (AC6)', () => {
  it('system + matchMedia(dark) → aplica `dark`', () => {
    installMatchMedia(true);
    render(
      <ThemeProvider initialTheme="system">
        <span>x</span>
      </ThemeProvider>,
    );
    expect(document.documentElement.classList.contains('dark')).toBe(true);
  });

  it('system + matchMedia(light) → não aplica `dark`', () => {
    installMatchMedia(false);
    render(
      <ThemeProvider initialTheme="system">
        <span>x</span>
      </ThemeProvider>,
    );
    expect(document.documentElement.classList.contains('dark')).toBe(false);
  });

  it('system → reage a mudança de preferência do OS em runtime', () => {
    const mock = installMatchMedia(false);
    render(
      <ThemeProvider initialTheme="system">
        <span>x</span>
      </ThemeProvider>,
    );
    expect(document.documentElement.classList.contains('dark')).toBe(false);
    act(() => mock.fire(true)); // OS muda para dark
    expect(document.documentElement.classList.contains('dark')).toBe(true);
    act(() => mock.fire(false)); // OS volta a light
    expect(document.documentElement.classList.contains('dark')).toBe(false);
  });
});

describe('useTheme() — setTheme optimistic + cookie (AC2/AC7)', () => {
  it('setTheme("dark") muda o DOM imediatamente e escreve o cookie', () => {
    installMatchMedia(false);
    const { result } = renderHook(() => useTheme(), {
      wrapper: ({ children }) => (
        <ThemeProvider initialTheme="light">{children}</ThemeProvider>
      ),
    });

    expect(document.documentElement.classList.contains('dark')).toBe(false);
    act(() => result.current.setTheme('dark'));

    expect(result.current.theme).toBe('dark');
    expect(result.current.resolvedTheme).toBe('dark');
    expect(document.documentElement.classList.contains('dark')).toBe(true);
    expect(document.cookie).toContain('expressia-theme=dark');
  });

  it('setTheme("system") com OS light remove a classe dark', () => {
    installMatchMedia(false);
    const { result } = renderHook(() => useTheme(), {
      wrapper: ({ children }) => (
        <ThemeProvider initialTheme="dark">{children}</ThemeProvider>
      ),
    });
    expect(document.documentElement.classList.contains('dark')).toBe(true);
    act(() => result.current.setTheme('system'));
    expect(document.documentElement.classList.contains('dark')).toBe(false);
    expect(document.cookie).toContain('expressia-theme=system');
  });

  it('useTheme() fora do <ThemeProvider> lança erro explícito', () => {
    // Silencia o console.error do React Error Boundary no teste.
    const spy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    function Orphan(): React.ReactElement {
      useTheme();
      return <span>n</span>;
    }
    expect(() => render(<Orphan />)).toThrow(/useTheme/);
    spy.mockRestore();
  });

  it('renderiza os filhos normalmente', () => {
    installMatchMedia(false);
    render(
      <ThemeProvider initialTheme="system">
        <span>filho-visivel</span>
      </ThemeProvider>,
    );
    expect(screen.getByText('filho-visivel')).toBeInTheDocument();
  });
});
