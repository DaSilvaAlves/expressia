/**
 * Tests do `CookieNotice` — aviso mínimo de cookies da landing pública.
 *
 * Pattern: jsdom + Testing Library + globals Vitest. Cobre:
 *   - Primeira visita (sem flag em localStorage) → o aviso aparece.
 *   - Clique em "Compreendi" → o aviso desaparece e persiste o guard.
 *   - Visita subsequente (flag presente) → o aviso NÃO aparece.
 *
 * `localStorage` real do jsdom é limpo entre testes (FIX-1: a leitura ocorre em
 * useEffect, pelo que esperamos o aviso aparecer via `findBy*`/`waitFor`).
 */
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { CookieNotice } from '@/components/legal/CookieNotice';

const STORAGE_KEY = 'expressia-cookie-notice-dismissed';

describe('CookieNotice — aviso mínimo de cookies', () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  afterEach(() => {
    cleanup();
    window.localStorage.clear();
  });

  it('aparece na primeira visita (sem flag em localStorage)', async () => {
    render(<CookieNotice />);

    expect(
      await screen.findByText(/cookies essenciais para o funcionamento/i),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /compreendi/i })).toBeInTheDocument();
    // Liga à Política de Privacidade.
    expect(screen.getByRole('link', { name: /política de privacidade/i })).toHaveAttribute(
      'href',
      '/privacidade',
    );
  });

  it('desaparece após clicar em "Compreendi" e persiste o guard', async () => {
    const user = userEvent.setup();
    render(<CookieNotice />);

    const button = await screen.findByRole('button', { name: /compreendi/i });
    await user.click(button);

    await waitFor(() => {
      expect(screen.queryByText(/cookies essenciais para o funcionamento/i)).not.toBeInTheDocument();
    });
    expect(window.localStorage.getItem(STORAGE_KEY)).toBe('true');
  });

  it('não aparece em visitas subsequentes (flag presente)', async () => {
    window.localStorage.setItem(STORAGE_KEY, 'true');
    render(<CookieNotice />);

    // Damos tempo ao effect; o aviso nunca deve surgir.
    await waitFor(() => {
      expect(
        screen.queryByText(/cookies essenciais para o funcionamento/i),
      ).not.toBeInTheDocument();
    });
  });
});
