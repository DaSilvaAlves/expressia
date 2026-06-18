/**
 * Testes — `<ExportData>` Client Component (Story 6.8 AC6 / T7.4).
 *
 * Cobre os estados: idle → loading → ready (link + expiração PT-PT) / error;
 * caso 409 (export já em curso/disponível) com mensagem dedicada.
 *
 * `global.fetch` mockado (precedente `theme-toggle.test.tsx`).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

import { ExportData } from '@/app/(app)/conta/dados/_components/export-data';

beforeEach(() => {
  global.fetch = vi.fn();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('<ExportData /> — estado inicial', () => {
  it('renderiza o botão "Exportar os meus dados"', () => {
    render(<ExportData />);
    expect(
      screen.getByRole('button', { name: /exportar os meus dados/i }),
    ).toBeInTheDocument();
  });
});

describe('<ExportData /> — sucesso (AC6)', () => {
  it('mostra o link de download e a data de expiração PT-PT quando pronto', async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({
        jobId: 'job-1',
        downloadUrl: 'https://storage/signed',
        expiresAt: '2026-06-19T14:30:00.000Z',
      }),
    });

    render(<ExportData />);
    fireEvent.click(screen.getByRole('button', { name: /exportar os meus dados/i }));

    await waitFor(() => {
      expect(screen.getByText(/a tua exportação está pronta/i)).toBeInTheDocument();
    });
    const link = screen.getByRole('link', { name: /descarregar ficheiro zip/i });
    expect(link).toHaveAttribute('href', 'https://storage/signed');
    // Data de expiração formatada PT-PT (DD/MM/YYYY às HH:MM).
    expect(screen.getByText(/Disponível até 19\/06\/2026 às \d{2}:\d{2}\./)).toBeInTheDocument();
  });
});

describe('<ExportData /> — 409 já em curso', () => {
  it('mostra mensagem de export já em curso/disponível', async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      ok: false,
      status: 409,
      json: async () => ({
        error: { message: 'Já tens um export em curso ou disponível para download.' },
      }),
    });

    render(<ExportData />);
    fireEvent.click(screen.getByRole('button', { name: /exportar os meus dados/i }));

    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent(/em curso ou disponível/i);
    });
  });
});

describe('<ExportData /> — erro de geração', () => {
  it('mostra mensagem de erro genérica em 500', async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      ok: false,
      status: 500,
      json: async () => ({
        error: { message: 'Não foi possível gerar a exportação. Tenta novamente mais tarde.' },
      }),
    });

    render(<ExportData />);
    fireEvent.click(screen.getByRole('button', { name: /exportar os meus dados/i }));

    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent(/não foi possível gerar/i);
    });
  });

  it('mostra erro de ligação quando o fetch rejeita', async () => {
    (global.fetch as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error('network'));

    render(<ExportData />);
    fireEvent.click(screen.getByRole('button', { name: /exportar os meus dados/i }));

    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent(/erro de ligação/i);
    });
  });
});
