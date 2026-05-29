'use client';

/**
 * `ThemeProvider` + `useTheme()` — gestão de tema claro/escuro/sistema (Story 5.8).
 *
 * Contexto Client que sincroniza a classe `dark` no `<html>` com a preferência
 * do utilizador (`light` | `dark` | `system`) e expõe `useTheme()` ao toggle UI.
 *
 * LIÇÃO FIX-1 da Story 5.7 (CRÍTICA — AC1.d / Dev Notes): Client Components
 * renderizam no SSR. A mutação de `document.documentElement.classList` é SEMPRE
 * em `useEffect` (client-only) — NUNCA no corpo do render (mutaria o DOM/singleton
 * no servidor → cross-request leak). O `theme` inicial vem do RSC via prop
 * (GET estendido — AC4), evitando round-trip e mismatch de hidratação.
 *
 * Para `theme === 'system'` (default), segue `prefers-color-scheme` via
 * `window.matchMedia` e reage a mudanças do OS em tempo real (AC6).
 *
 * Persistência híbrida C (DP-5.8.B): `user_prefs.theme` (DB) é a fonte de verdade
 * cross-device; o cookie `expressia-theme` serve a leitura síncrona pré-paint
 * (script anti-FOUC no `<head>`); este Provider é o cache reactivo de UI.
 *
 * Trace: Story 5.8 AC1.d/AC6/AC7; DP-5.8.A/B; front-end-spec §11.
 */
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';

import type { Theme } from '@/lib/api-schemas/preferences';

/** Nome canónico do cookie de sincronização anti-FOUC (DP-5.8.B). */
export const THEME_COOKIE = 'expressia-theme';
/** Max-Age de 1 ano (segundos) — SameSite=Lax; Path=/. */
const THEME_COOKIE_MAX_AGE = 31536000;

interface ThemeContextValue {
  /** Preferência declarada do utilizador (`light` | `dark` | `system`). */
  readonly theme: Theme;
  /** Resolução efectiva aplicada ao DOM (`light` | `dark`) — útil ao toggle. */
  readonly resolvedTheme: 'light' | 'dark';
  /** Define a preferência (optimistic): muda o DOM + cookie imediatamente. */
  readonly setTheme: (theme: Theme) => void;
}

const ThemeContext = createContext<ThemeContextValue | null>(null);

/**
 * Determina se o modo escuro deve estar activo dada a preferência e o OS.
 * `system` consulta `prefers-color-scheme`; `light`/`dark` ignoram o OS.
 */
function computeIsDark(theme: Theme): boolean {
  if (theme === 'dark') return true;
  if (theme === 'light') return false;
  // theme === 'system'
  if (typeof window === 'undefined' || !window.matchMedia) return false;
  return window.matchMedia('(prefers-color-scheme: dark)').matches;
}

/** Aplica/remove a classe `dark` no `<html>` (client-only — chamar em effect). */
function applyThemeClass(isDark: boolean): void {
  if (typeof document === 'undefined') return;
  document.documentElement.classList.toggle('dark', isDark);
}

/** Escreve o cookie de sincronização anti-FOUC (client-only). */
function writeThemeCookie(theme: Theme): void {
  if (typeof document === 'undefined') return;
  document.cookie = `${THEME_COOKIE}=${theme}; Path=/; Max-Age=${THEME_COOKIE_MAX_AGE}; SameSite=Lax`;
}

export interface ThemeProviderProps {
  /** Preferência inicial vinda do RSC (GET estendido — AC4). */
  readonly initialTheme: Theme;
  readonly children: ReactNode;
}

export function ThemeProvider({
  initialTheme,
  children,
}: ThemeProviderProps): React.ReactElement {
  const [theme, setThemeState] = useState<Theme>(initialTheme);
  const [resolvedTheme, setResolvedTheme] = useState<'light' | 'dark'>(
    initialTheme === 'dark' ? 'dark' : 'light',
  );

  // Sincroniza o DOM com a preferência sempre que `theme` muda (client-only).
  // Lição FIX-1 (5.7): mutação do DOM SÓ em useEffect, nunca no render.
  useEffect(() => {
    const isDark = computeIsDark(theme);
    applyThemeClass(isDark);
    setResolvedTheme(isDark ? 'dark' : 'light');
  }, [theme]);

  // Reage a mudanças do OS quando em modo `system` (AC6).
  useEffect(() => {
    if (theme !== 'system') return;
    if (typeof window === 'undefined' || !window.matchMedia) return;

    const mql = window.matchMedia('(prefers-color-scheme: dark)');
    const onChange = (event: MediaQueryListEvent): void => {
      applyThemeClass(event.matches);
      setResolvedTheme(event.matches ? 'dark' : 'light');
    };
    mql.addEventListener('change', onChange);
    return () => mql.removeEventListener('change', onChange);
  }, [theme]);

  const setTheme = useCallback((next: Theme): void => {
    setThemeState(next);
    // Optimistic: cookie + DOM mudam já; o PATCH (no toggle) persiste no DB.
    writeThemeCookie(next);
    const isDark = computeIsDark(next);
    applyThemeClass(isDark);
    setResolvedTheme(isDark ? 'dark' : 'light');
  }, []);

  const value = useMemo<ThemeContextValue>(
    () => ({ theme, resolvedTheme, setTheme }),
    [theme, resolvedTheme, setTheme],
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

/**
 * Hook de acesso ao tema. Lança se usado fora de `<ThemeProvider>` — garante
 * que o toggle nunca é montado sem o provider.
 */
export function useTheme(): ThemeContextValue {
  const ctx = useContext(ThemeContext);
  if (!ctx) {
    throw new Error('useTheme() tem de ser usado dentro de <ThemeProvider>.');
  }
  return ctx;
}
