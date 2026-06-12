/**
 * Testes `<NewAccountModal>` — formulário de criação de conta (A2).
 *
 * Cobre: render condicional por `open`, validação de nome/IBAN/saldo inicial,
 * POST /api/financas/contas com `initial_balance_cents` parseado de PT-PT
 * ("1.234,56" → 123456), opcionais omitidos quando vazios (schema `.strict()`),
 * erro do servidor e fecho via Cancelar/Escape.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';

const refreshMock = vi.fn();
vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: refreshMock }),
}));

const fetchMock = vi.fn();
vi.stubGlobal('fetch', fetchMock);

import { NewAccountModal } from '@/app/(app)/financas/_components/NewAccountModal';

afterEach(() => {
  cleanup();
  fetchMock.mockReset();
  refreshMock.mockReset();
});

function parseBody(): Record<string, unknown> {
  const call = fetchMock.mock.calls[0];
  const init = call?.[1] as { body: string };
  return JSON.parse(init.body) as Record<string, unknown>;
}

describe('<NewAccountModal>', () => {
  it('não renderiza quando open=false', () => {
    render(<NewAccountModal open={false} onClose={() => {}} />);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('renderiza o formulário quando open=true', () => {
    render(<NewAccountModal open onClose={() => {}} />);
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: /Nova conta/i })).toBeInTheDocument();
    expect(screen.getByLabelText('Nome da conta')).toBeInTheDocument();
    expect(screen.getByLabelText('Tipo de conta')).toHaveValue('corrente');
    expect(screen.getByLabelText('Saldo inicial em euros')).toBeInTheDocument();
    expect(screen.getByLabelText('Banco')).toBeInTheDocument();
    expect(screen.getByLabelText('IBAN (últimos 4 dígitos)')).toBeInTheDocument();
  });

  it('nome vazio bloqueia submit e mostra erro — sem POST', () => {
    render(<NewAccountModal open onClose={() => {}} />);
    fireEvent.click(screen.getByRole('button', { name: /Criar/i }));
    expect(screen.getByRole('alert')).toHaveTextContent(/nome é obrigatório/i);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('IBAN inválido bloqueia submit e mostra erro — sem POST', () => {
    render(<NewAccountModal open onClose={() => {}} />);
    fireEvent.change(screen.getByLabelText('Nome da conta'), { target: { value: 'CGD' } });
    fireEvent.change(screen.getByLabelText('IBAN (últimos 4 dígitos)'), {
      target: { value: '12a' },
    });
    fireEvent.click(screen.getByRole('button', { name: /Criar/i }));
    expect(screen.getByRole('alert')).toHaveTextContent(/IBAN/i);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('saldo inicial inválido bloqueia submit e mostra erro — sem POST', () => {
    render(<NewAccountModal open onClose={() => {}} />);
    fireEvent.change(screen.getByLabelText('Nome da conta'), { target: { value: 'CGD' } });
    fireEvent.change(screen.getByLabelText('Saldo inicial em euros'), {
      target: { value: 'abc' },
    });
    fireEvent.click(screen.getByRole('button', { name: /Criar/i }));
    expect(screen.getByRole('alert')).toHaveTextContent(/Saldo inicial inválido/i);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('cria conta completa — initial_balance_cents parseado de "1.234,56"', async () => {
    fetchMock.mockResolvedValue({ ok: true, json: async () => ({ account: { id: 'new' } }) });
    const onClose = vi.fn();
    render(<NewAccountModal open onClose={onClose} />);

    fireEvent.change(screen.getByLabelText('Nome da conta'), {
      target: { value: 'Conta Ordenado' },
    });
    fireEvent.change(screen.getByLabelText('Tipo de conta'), { target: { value: 'poupanca' } });
    fireEvent.change(screen.getByLabelText('Banco'), { target: { value: 'CGD' } });
    fireEvent.change(screen.getByLabelText('IBAN (últimos 4 dígitos)'), {
      target: { value: '1234' },
    });
    fireEvent.change(screen.getByLabelText('Saldo inicial em euros'), {
      target: { value: '1.234,56' },
    });
    fireEvent.click(screen.getByRole('button', { name: /Criar/i }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/financas/contas',
      expect.objectContaining({ method: 'POST' }),
    );
    expect(parseBody()).toEqual({
      name: 'Conta Ordenado',
      account_type: 'poupanca',
      bank_name: 'CGD',
      iban_last4: '1234',
      initial_balance_cents: 123456,
    });
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(refreshMock).toHaveBeenCalled();
  });

  it('opcionais vazios são omitidos do body (schema .strict()) e saldo default 0', async () => {
    fetchMock.mockResolvedValue({ ok: true, json: async () => ({ account: { id: 'new' } }) });
    render(<NewAccountModal open onClose={() => {}} />);

    fireEvent.change(screen.getByLabelText('Nome da conta'), { target: { value: 'Mealheiro' } });
    fireEvent.click(screen.getByRole('button', { name: /Criar/i }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    expect(parseBody()).toEqual({
      name: 'Mealheiro',
      account_type: 'corrente',
      initial_balance_cents: 0,
    });
  });

  it('erro do servidor mostra alerta e não fecha', async () => {
    fetchMock.mockResolvedValue({
      ok: false,
      json: async () => ({ error: { message: 'Dados inválidos.' } }),
    });
    const onClose = vi.fn();
    render(<NewAccountModal open onClose={onClose} />);

    fireEvent.change(screen.getByLabelText('Nome da conta'), { target: { value: 'CGD' } });
    fireEvent.click(screen.getByRole('button', { name: /Criar/i }));

    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('Dados inválidos.'));
    expect(onClose).not.toHaveBeenCalled();
    expect(refreshMock).not.toHaveBeenCalled();
  });

  it('Cancelar fecha o modal', () => {
    const onClose = vi.fn();
    render(<NewAccountModal open onClose={onClose} />);
    fireEvent.click(screen.getByRole('button', { name: /Cancelar/i }));
    expect(onClose).toHaveBeenCalled();
  });

  it('Escape fecha o modal', () => {
    const onClose = vi.fn();
    render(<NewAccountModal open onClose={onClose} />);
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onClose).toHaveBeenCalled();
  });
});
