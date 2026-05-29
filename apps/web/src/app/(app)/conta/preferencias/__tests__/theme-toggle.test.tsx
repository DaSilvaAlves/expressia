/**
 * Testes — `<ThemeToggle>` Client Component (Story 5.8 AC2 / AC7).
 *
 * Cobertura (precedente `prefs-toggle.test.tsx`):
 *   - render das 3 opções PT-PT (Claro / Escuro / Sistema) como radiogroup
 *   - `aria-checked` correcto consoante o tema activo
 *   - clicar "Escuro" → PATCH `{ theme: 'dark' }` + classe `dark` no DOM (optimistic)
 *   - PATCH falhado → revert do tema + banner de erro
 *   - PATCH success → banner "Guardado." + cookie `expressia-theme` escrito
 *   - clicar a opção já activa não dispara PATCH
 *
 * O `<ThemeToggle>` consome `useTheme()`, por isso é montado dentro de um
 * `<ThemeProvider>` real (o optimistic muda o `<html>` + cookie via o provider).
 * `matchMedia` é mockado (não há mock global em `vitest.setup.ts`).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

import { ThemeToggle } from '@/app/(app)/conta/preferencias/_components/theme-toggle';
import { ThemeProvider } from '@/components/theme/ThemeProvider';
import type { Theme } from '@/lib/api-schemas/preferences';

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

function renderToggle(initialTheme: Theme = 'system') {
  return render(
    <ThemeProvider initialTheme={initialTheme}>
      <ThemeToggle />
    </ThemeProvider>,
  );
}

beforeEach(() => {
  setMatchMedia(false);
  global.fetch = vi.fn();
  document.documentElement.classList.remove('dark');
  document.cookie = 'expressia-theme=; Path=/; Max-Age=0';
});

afterEach(() => {
  vi.restoreAllMocks();
  document.documentElement.classList.remove('dark');
});

describe('<ThemeToggle /> — render + a11y (AC2.a)', () => {
  it('renderiza um radiogroup com 3 opções PT-PT', () => {
    renderToggle('system');
    const group = screen.getByRole('radiogroup', { name: /tema da aplica/i });
    expect(group).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: 'Claro' })).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: 'Escuro' })).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: 'Sistema' })).toBeInTheDocument();
  });

  it('marca aria-checked na opção do tema activo', () => {
    renderToggle('dark');
    expect(screen.getByRole('radio', { name: 'Escuro' })).toBeChecked();
    expect(screen.getByRole('radio', { name: 'Claro' })).not.toBeChecked();
    expect(screen.getByRole('radio', { name: 'Sistema' })).not.toBeChecked();
  });
});

describe('<ThemeToggle /> — interacção optimistic + PATCH (AC2.b/AC7)', () => {
  it('clicar "Escuro" → PATCH { theme: "dark" } + classe dark no DOM + banner', async () => {
    (global.fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({ theme: 'dark' }),
    });
    renderToggle('light');

    fireEvent.click(screen.getByRole('radio', { name: 'Escuro' }));

    // Optimistic: o DOM muda já (antes mesmo do PATCH resolver).
    expect(document.documentElement.classList.contains('dark')).toBe(true);

    await waitFor(() =>
      expect(screen.getByRole('status')).toHaveTextContent(/guardado/i),
    );
    expect(global.fetch).toHaveBeenCalledWith(
      '/api/conta/preferencias',
      expect.objectContaining({
        method: 'PATCH',
        body: JSON.stringify({ theme: 'dark' }),
      }),
    );
    // Cookie de sincronização anti-FOUC escrito (DP-5.8.B).
    expect(document.cookie).toContain('expressia-theme=dark');
  });

  it('PATCH falhado → revert do tema + banner de erro', async () => {
    (global.fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      ok: false,
      status: 500,
      json: async () => ({ error: { message: 'Erro interno.' } }),
    });
    renderToggle('light');

    fireEvent.click(screen.getByRole('radio', { name: 'Escuro' }));

    await waitFor(() =>
      expect(screen.getByRole('alert')).toHaveTextContent(/erro/i),
    );
    // Revert: volta a light (sem classe dark).
    expect(document.documentElement.classList.contains('dark')).toBe(false);
    expect(screen.getByRole('radio', { name: 'Claro' })).toBeChecked();
  });

  it('network error (fetch reject) → revert + banner temporário', async () => {
    (global.fetch as unknown as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
      new Error('network'),
    );
    renderToggle('light');

    fireEvent.click(screen.getByRole('radio', { name: 'Escuro' }));

    await waitFor(() =>
      expect(screen.getByRole('alert')).toHaveTextContent(/erro temporário/i),
    );
    expect(screen.getByRole('radio', { name: 'Claro' })).toBeChecked();
  });

  it('clicar a opção já activa não dispara PATCH', () => {
    renderToggle('light');
    fireEvent.click(screen.getByRole('radio', { name: 'Claro' }));
    expect(global.fetch).not.toHaveBeenCalled();
  });
});
