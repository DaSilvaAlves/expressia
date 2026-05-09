/**
 * Tests UI — `<PrefsToggle />` Client Component (Story 2.7 T11 + AC10).
 *
 * Cobertura ≥3 tests: render initial, toggle on (PATCH success), toggle off
 * → revert on error, banner success após PATCH OK, banner error após PATCH fail.
 *
 * Nota: testamos o Client Component directamente (PrefsToggle), não o
 * Server Component page (que requer environment Server Component + cookies).
 * Cobertura do Server Component fica em integration tests futuros (E2E).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

import { PrefsToggle } from '@/app/(app)/conta/preferencias/_components/prefs-toggle';

beforeEach(() => {
  global.fetch = vi.fn();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('<PrefsToggle />', () => {
  it('renderiza com estado initial=false (toggle off)', () => {
    render(<PrefsToggle initial={{ always_preview: false }} />);
    const cb = screen.getByRole('switch') as HTMLInputElement;
    expect(cb.checked).toBe(false);
    expect(
      screen.getByText(/confirmar sempre antes de gravar/i),
    ).toBeInTheDocument();
  });

  it('renderiza com estado initial=true (toggle on)', () => {
    render(<PrefsToggle initial={{ always_preview: true }} />);
    const cb = screen.getByRole('switch') as HTMLInputElement;
    expect(cb.checked).toBe(true);
  });

  it('toggle on → PATCH success → banner "Guardado"', async () => {
    (global.fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({ always_preview: true }),
    });
    render(<PrefsToggle initial={{ always_preview: false }} />);
    fireEvent.click(screen.getByRole('switch'));
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent(/guardado/i));
    expect(global.fetch).toHaveBeenCalledWith(
      '/api/conta/preferencias',
      expect.objectContaining({
        method: 'PATCH',
        body: JSON.stringify({ always_preview: true }),
      }),
    );
  });

  it('PATCH fail → optimistic update revertido + banner erro', async () => {
    (global.fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      ok: false,
      status: 500,
      json: async () => ({ error: { message: 'Erro interno servidor.' } }),
    });
    render(<PrefsToggle initial={{ always_preview: false }} />);
    const cb = screen.getByRole('switch') as HTMLInputElement;
    fireEvent.click(cb);
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent(/erro/i));
    // Revert: switch volta a false
    expect(cb.checked).toBe(false);
  });

  it('network error (fetch reject) mostra mensagem PT-PT genérica + revert', async () => {
    (global.fetch as unknown as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
      new Error('network'),
    );
    render(<PrefsToggle initial={{ always_preview: true }} />);
    const cb = screen.getByRole('switch') as HTMLInputElement;
    fireEvent.click(cb);
    await waitFor(() =>
      expect(screen.getByRole('alert')).toHaveTextContent(/erro temporário/i),
    );
    expect(cb.checked).toBe(true); // revert ao initial
  });
});
