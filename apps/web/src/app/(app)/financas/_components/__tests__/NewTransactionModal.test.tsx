/**
 * Testes `<NewTransactionModal>` — formulário de registo de transacção (A1).
 *
 * Cobre: render condicional por `open`, validação de valor/descrição,
 * POST /api/financas/transacoes com `amount_cents` parseado de PT-PT
 * ("13,50" → 1350), selecção conta vs cartão (XOR do schema), categoria
 * opcional, erro do servidor, fecho via Cancelar/Escape e estado sem
 * contas/cartões (submit bloqueado).
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';

const refreshMock = vi.fn();
vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: refreshMock }),
}));

const fetchMock = vi.fn();
vi.stubGlobal('fetch', fetchMock);

import { NewTransactionModal } from '@/app/(app)/financas/_components/NewTransactionModal';

const OPTIONS = {
  categories: [
    { id: '11111111-1111-4111-8111-111111111111', name: 'Alimentação' },
    { id: '22222222-2222-4222-8222-222222222222', name: 'Outros gastos' },
  ],
  accounts: [{ id: '33333333-3333-4333-8333-333333333333', name: 'Dinheiro' }],
  cards: [{ id: '44444444-4444-4444-8444-444444444444', name: 'Cartão Principal' }],
} as const;

const NO_SOURCES = { categories: OPTIONS.categories, accounts: [], cards: [] } as const;

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

describe('<NewTransactionModal>', () => {
  it('não renderiza quando open=false', () => {
    render(<NewTransactionModal open={false} onClose={() => {}} options={OPTIONS} />);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('renderiza o formulário quando open=true', () => {
    render(<NewTransactionModal open onClose={() => {}} options={OPTIONS} />);
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: /Nova transacção/i })).toBeInTheDocument();
    expect(screen.getByLabelText('Valor em euros')).toBeInTheDocument();
    expect(screen.getByLabelText('Pagar com')).toBeInTheDocument();
    expect(screen.getByLabelText('Categoria')).toBeInTheDocument();
    expect(screen.getByLabelText('Data')).not.toHaveValue('');
  });

  it('valor inválido bloqueia submit e mostra erro — sem POST', () => {
    render(<NewTransactionModal open onClose={() => {}} options={OPTIONS} />);
    fireEvent.change(screen.getByLabelText('Valor em euros'), { target: { value: 'abc' } });
    fireEvent.click(screen.getByRole('button', { name: /Registar/i }));
    expect(screen.getByRole('alert')).toHaveTextContent(/Valor inválido/i);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('descrição vazia bloqueia submit e mostra erro — sem POST', () => {
    render(<NewTransactionModal open onClose={() => {}} options={OPTIONS} />);
    fireEvent.change(screen.getByLabelText('Valor em euros'), { target: { value: '13,50' } });
    fireEvent.click(screen.getByRole('button', { name: /Registar/i }));
    expect(screen.getByRole('alert')).toHaveTextContent(/descrição é obrigatória/i);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('regista despesa com conta — amount_cents parseado de "13,50"', async () => {
    fetchMock.mockResolvedValue({ ok: true, json: async () => ({ transaction: { id: 'new' } }) });
    const onClose = vi.fn();
    render(<NewTransactionModal open onClose={onClose} options={OPTIONS} />);

    fireEvent.change(screen.getByLabelText('Valor em euros'), { target: { value: '13,50' } });
    fireEvent.change(screen.getByLabelText('Descrição'), { target: { value: 'Almoço' } });
    fireEvent.change(screen.getByLabelText('Data'), { target: { value: '2026-06-12' } });
    fireEvent.change(screen.getByLabelText('Categoria'), {
      target: { value: OPTIONS.categories[0].id },
    });
    fireEvent.click(screen.getByRole('button', { name: /Registar/i }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/financas/transacoes',
      expect.objectContaining({ method: 'POST' }),
    );
    const body = parseBody();
    expect(body).toMatchObject({
      kind: 'expense',
      amount_cents: 1350,
      description: 'Almoço',
      transaction_date: '2026-06-12',
      payment_method: 'card',
      account_id: OPTIONS.accounts[0].id,
      category_id: OPTIONS.categories[0].id,
    });
    expect(body.card_id).toBeUndefined();
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(refreshMock).toHaveBeenCalled();
  });

  it('pagar com cartão envia card_id (sem account_id) e tipo/método seguem a selecção', async () => {
    fetchMock.mockResolvedValue({ ok: true, json: async () => ({ transaction: { id: 'new' } }) });
    render(<NewTransactionModal open onClose={() => {}} options={OPTIONS} />);

    fireEvent.change(screen.getByLabelText('Valor em euros'), { target: { value: '7' } });
    fireEvent.change(screen.getByLabelText('Descrição'), { target: { value: 'Streaming' } });
    fireEvent.change(screen.getByLabelText('Tipo'), { target: { value: 'income' } });
    fireEvent.change(screen.getByLabelText('Método de pagamento'), {
      target: { value: 'mb_way' },
    });
    fireEvent.change(screen.getByLabelText('Pagar com'), {
      target: { value: `card:${OPTIONS.cards[0].id}` },
    });
    fireEvent.click(screen.getByRole('button', { name: /Registar/i }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    const body = parseBody();
    expect(body).toMatchObject({
      kind: 'income',
      amount_cents: 700,
      payment_method: 'mb_way',
      card_id: OPTIONS.cards[0].id,
    });
    expect(body.account_id).toBeUndefined();
    expect(body.category_id).toBeUndefined();
  });

  it('erro do servidor mostra alerta e não fecha', async () => {
    fetchMock.mockResolvedValue({
      ok: false,
      json: async () => ({ error: { message: 'Conta não encontrada.' } }),
    });
    const onClose = vi.fn();
    render(<NewTransactionModal open onClose={onClose} options={OPTIONS} />);

    fireEvent.change(screen.getByLabelText('Valor em euros'), { target: { value: '5' } });
    fireEvent.change(screen.getByLabelText('Descrição'), { target: { value: 'X' } });
    fireEvent.click(screen.getByRole('button', { name: /Registar/i }));

    await waitFor(() =>
      expect(screen.getByRole('alert')).toHaveTextContent('Conta não encontrada.'),
    );
    expect(onClose).not.toHaveBeenCalled();
  });

  it('sem contas nem cartões: aviso visível e submit desactivado', () => {
    render(<NewTransactionModal open onClose={() => {}} options={NO_SOURCES} />);
    expect(screen.getByRole('alert')).toHaveTextContent(/não existem contas nem cartões/i);
    expect(screen.getByRole('button', { name: /Registar/i })).toBeDisabled();
    expect(screen.getByLabelText('Pagar com')).toBeDisabled();
  });

  it('Cancelar fecha o modal', () => {
    const onClose = vi.fn();
    render(<NewTransactionModal open onClose={onClose} options={OPTIONS} />);
    fireEvent.click(screen.getByRole('button', { name: /Cancelar/i }));
    expect(onClose).toHaveBeenCalled();
  });

  it('Escape fecha o modal', () => {
    const onClose = vi.fn();
    render(<NewTransactionModal open onClose={onClose} options={OPTIONS} />);
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onClose).toHaveBeenCalled();
  });
});
