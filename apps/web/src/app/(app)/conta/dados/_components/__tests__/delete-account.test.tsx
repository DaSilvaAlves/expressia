import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { DeleteAccount } from '@/app/(app)/conta/dados/_components/delete-account';
import type { AccountDeletionJobDTO } from '@/lib/api-schemas/account-deletion';

/**
 * Testes de `<DeleteAccount>` — Story 6.9 AC6 (T8.5).
 *
 * Estados none/scheduled/in_progress; diálogo de confirmação (campo ELIMINAR —
 * botão desactivado sem texto, activado com texto exacto); disparo do POST e do
 * cancelamento (DELETE).
 */

const SCHEDULED_JOB: AccountDeletionJobDTO = {
  jobId: 'job-1',
  status: 'scheduled',
  scheduledFor: '2026-07-19T03:00:00.000Z',
  createdAt: '2026-06-19T03:00:00.000Z',
};

const IN_PROGRESS_JOB: AccountDeletionJobDTO = {
  ...SCHEDULED_JOB,
  status: 'in_progress',
};

const originalLocation = window.location;

beforeEach(() => {
  vi.restoreAllMocks();
  // window.location.reload é chamado após acções — stub para não rebentar em jsdom.
  Object.defineProperty(window, 'location', {
    configurable: true,
    value: { ...originalLocation, reload: vi.fn() },
  });
});

afterEach(() => {
  Object.defineProperty(window, 'location', {
    configurable: true,
    value: originalLocation,
  });
});

describe('<DeleteAccount> — estado none', () => {
  it('mostra o botão "Eliminar conta"', () => {
    render(<DeleteAccount initialJob={null} />);
    expect(screen.getByRole('button', { name: /eliminar conta/i })).toBeInTheDocument();
  });

  it('abre o diálogo de confirmação ao clicar', () => {
    render(<DeleteAccount initialJob={null} />);
    fireEvent.click(screen.getByRole('button', { name: /eliminar conta/i }));
    expect(screen.getByRole('alertdialog')).toBeInTheDocument();
    expect(screen.getByLabelText(/escreve eliminar/i)).toBeInTheDocument();
  });

  it('botão de confirmação desactivado sem o texto ELIMINAR', () => {
    render(<DeleteAccount initialJob={null} />);
    fireEvent.click(screen.getByRole('button', { name: /eliminar conta/i }));
    const confirmBtn = screen.getByRole('button', { name: /confirmar eliminação/i });
    expect(confirmBtn).toBeDisabled();
  });

  it('texto parcial/incorrecto mantém o botão desactivado', () => {
    render(<DeleteAccount initialJob={null} />);
    fireEvent.click(screen.getByRole('button', { name: /eliminar conta/i }));
    const input = screen.getByLabelText(/escreve eliminar/i);
    fireEvent.change(input, { target: { value: 'eliminar' } }); // minúsculas
    expect(screen.getByRole('button', { name: /confirmar eliminação/i })).toBeDisabled();
  });

  it('texto exacto ELIMINAR activa o botão e dispara POST', async () => {
    const fetchMock = vi
      .spyOn(global, 'fetch')
      .mockResolvedValue(new Response(JSON.stringify({ jobId: 'job-1' }), { status: 200 }));

    render(<DeleteAccount initialJob={null} />);
    fireEvent.click(screen.getByRole('button', { name: /eliminar conta/i }));
    fireEvent.change(screen.getByLabelText(/escreve eliminar/i), {
      target: { value: 'ELIMINAR' },
    });

    const confirmBtn = screen.getByRole('button', { name: /confirmar eliminação/i });
    expect(confirmBtn).toBeEnabled();
    fireEvent.click(confirmBtn);

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith('/api/conta/delete', { method: 'POST' });
    });
  });

  it('mostra erro quando o POST falha', async () => {
    vi.spyOn(global, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ error: { message: 'Erro ao agendar.' } }), { status: 500 }),
    );

    render(<DeleteAccount initialJob={null} />);
    fireEvent.click(screen.getByRole('button', { name: /eliminar conta/i }));
    fireEvent.change(screen.getByLabelText(/escreve eliminar/i), {
      target: { value: 'ELIMINAR' },
    });
    fireEvent.click(screen.getByRole('button', { name: /confirmar eliminação/i }));

    expect(await screen.findByRole('alert')).toHaveTextContent(/erro ao agendar/i);
  });
});

describe('<DeleteAccount> — estado scheduled', () => {
  it('mostra a data PT-PT e o botão de cancelar', () => {
    render(<DeleteAccount initialJob={SCHEDULED_JOB} />);
    expect(screen.getByText(/19\/07\/2026/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /cancelar eliminação/i })).toBeInTheDocument();
  });

  it('dispara DELETE ao cancelar', async () => {
    const fetchMock = vi
      .spyOn(global, 'fetch')
      .mockResolvedValue(new Response(JSON.stringify({ jobId: 'job-1' }), { status: 200 }));

    render(<DeleteAccount initialJob={SCHEDULED_JOB} />);
    fireEvent.click(screen.getByRole('button', { name: /cancelar eliminação/i }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith('/api/conta/delete', { method: 'DELETE' });
    });
  });
});

describe('<DeleteAccount> — estado in_progress', () => {
  it('mostra mensagem informativa sem acção', () => {
    render(<DeleteAccount initialJob={IN_PROGRESS_JOB} />);
    expect(screen.getByText(/está a ser eliminada/i)).toBeInTheDocument();
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });
});
