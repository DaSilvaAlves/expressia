/**
 * Testes `<NewCardModal>` — formulário de criação de cartão (A3).
 *
 * Cobre: render condicional por `open`, fetch das contas ao abrir (GET
 * /api/financas/contas, primeira pré-seleccionada), validação de
 * nome/last4/dias 1-28/limite obrigatório p/ crédito, POST
 * /api/financas/cartoes com `credit_limit_cents` parseado de PT-PT
 * ("1.500,00" → 150000), opcionais omitidos quando vazios (schema `.strict()`),
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

import { NewCardModal } from '@/app/(app)/financas/_components/NewCardModal';

afterEach(() => {
  cleanup();
  fetchMock.mockReset();
  refreshMock.mockReset();
});

const ACCOUNTS = [
  { id: 'a1', name: 'Conta Ordenado', bank_name: 'CGD' },
  { id: 'a2', name: 'Dinheiro', bank_name: null },
];

/** GET contas responde com `accounts`; POST cartoes responde com `postResponse`. */
function stubFetch(
  accounts: unknown = ACCOUNTS,
  postResponse: { ok: boolean; body?: unknown } = { ok: true, body: { card: { id: 'new' } } },
): void {
  fetchMock.mockImplementation((url: string, init?: { method?: string }) => {
    if (!init?.method || init.method === 'GET') {
      return Promise.resolve({ ok: true, json: async () => ({ accounts }) });
    }
    return Promise.resolve({
      ok: postResponse.ok,
      json: async () => postResponse.body ?? {},
    });
  });
}

function postCalls(): Array<[string, { method?: string; body?: string }]> {
  return fetchMock.mock.calls.filter(
    (call) => (call[1] as { method?: string } | undefined)?.method === 'POST',
  ) as Array<[string, { method?: string; body?: string }]>;
}

function parsePostBody(): Record<string, unknown> {
  const call = postCalls()[0];
  return JSON.parse(call![1].body!) as Record<string, unknown>;
}

/** Abre o modal e espera o fetch das contas resolver (select preenchido). */
async function renderOpen(onClose: () => void = () => {}): Promise<void> {
  render(<NewCardModal open onClose={onClose} />);
  await waitFor(() =>
    expect(screen.getByLabelText('Conta associada')).not.toBeDisabled(),
  );
}

describe('<NewCardModal>', () => {
  it('não renderiza quando open=false', () => {
    render(<NewCardModal open={false} onClose={() => {}} />);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('renderiza o formulário e carrega as contas (primeira pré-seleccionada)', async () => {
    stubFetch();
    await renderOpen();
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: /Novo cartão/i })).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledWith('/api/financas/contas');
    expect(screen.getByLabelText('Conta associada')).toHaveValue('a1');
    expect(screen.getByLabelText('Tipo de cartão')).toHaveValue('credit');
    // Crédito por omissão — campo de limite visível.
    expect(screen.getByLabelText('Limite de crédito em euros')).toBeInTheDocument();
  });

  it('sem contas: aviso + Criar disabled', async () => {
    stubFetch([]);
    render(<NewCardModal open onClose={() => {}} />);
    await waitFor(() =>
      expect(screen.getByRole('alert')).toHaveTextContent(/Ainda não há contas/i),
    );
    expect(screen.getByRole('button', { name: /Criar/i })).toBeDisabled();
  });

  it('falha no GET das contas: alerta de erro + Criar disabled', async () => {
    fetchMock.mockResolvedValue({ ok: false, json: async () => ({}) });
    render(<NewCardModal open onClose={() => {}} />);
    await waitFor(() =>
      expect(screen.getByRole('alert')).toHaveTextContent(/Erro ao carregar as contas/i),
    );
    expect(screen.getByRole('button', { name: /Criar/i })).toBeDisabled();
  });

  it('nome vazio bloqueia submit e mostra erro — sem POST', async () => {
    stubFetch();
    await renderOpen();
    fireEvent.click(screen.getByRole('button', { name: /Criar/i }));
    expect(screen.getByRole('alert')).toHaveTextContent(/nome é obrigatório/i);
    expect(postCalls()).toHaveLength(0);
  });

  it('last4 inválido bloqueia submit e mostra erro — sem POST', async () => {
    stubFetch();
    await renderOpen();
    fireEvent.change(screen.getByLabelText('Nome do cartão'), { target: { value: 'Visa' } });
    fireEvent.change(screen.getByLabelText('Últimos 4 dígitos'), { target: { value: '12a' } });
    fireEvent.click(screen.getByRole('button', { name: /Criar/i }));
    expect(screen.getByRole('alert')).toHaveTextContent(/Últimos 4 dígitos inválidos/i);
    expect(postCalls()).toHaveLength(0);
  });

  it('dia de fecho fora de 1-28 bloqueia submit — sem POST', async () => {
    stubFetch();
    await renderOpen();
    fireEvent.change(screen.getByLabelText('Nome do cartão'), { target: { value: 'Visa' } });
    fireEvent.change(screen.getByLabelText('Dia de fecho'), { target: { value: '29' } });
    fireEvent.click(screen.getByRole('button', { name: /Criar/i }));
    expect(screen.getByRole('alert')).toHaveTextContent(/Dia de fecho inválido/i);
    expect(postCalls()).toHaveLength(0);
  });

  it('crédito sem limite bloqueia submit (refinamento credit⇒limit) — sem POST', async () => {
    stubFetch();
    await renderOpen();
    fireEvent.change(screen.getByLabelText('Nome do cartão'), { target: { value: 'Visa' } });
    fireEvent.click(screen.getByRole('button', { name: /Criar/i }));
    // Nome preenchido, tipo default credit, limite vazio.
    expect(screen.getByRole('alert')).toHaveTextContent(/requer limite de crédito/i);
    expect(postCalls()).toHaveLength(0);
  });

  it('limite inválido bloqueia submit e mostra erro — sem POST', async () => {
    stubFetch();
    await renderOpen();
    fireEvent.change(screen.getByLabelText('Nome do cartão'), { target: { value: 'Visa' } });
    fireEvent.change(screen.getByLabelText('Limite de crédito em euros'), {
      target: { value: 'abc' },
    });
    fireEvent.click(screen.getByRole('button', { name: /Criar/i }));
    expect(screen.getByRole('alert')).toHaveTextContent(/Limite de crédito inválido/i);
    expect(postCalls()).toHaveLength(0);
  });

  it('cria cartão de crédito completo — credit_limit_cents parseado de "1.500,00"', async () => {
    stubFetch();
    const onClose = vi.fn();
    await renderOpen(onClose);

    fireEvent.change(screen.getByLabelText('Conta associada'), { target: { value: 'a2' } });
    fireEvent.change(screen.getByLabelText('Nome do cartão'), {
      target: { value: 'Visa Gold' },
    });
    fireEvent.change(screen.getByLabelText('Últimos 4 dígitos'), { target: { value: '4321' } });
    fireEvent.change(screen.getByLabelText('Dia de fecho'), { target: { value: '5' } });
    fireEvent.change(screen.getByLabelText('Dia de pagamento'), { target: { value: '20' } });
    fireEvent.change(screen.getByLabelText('Limite de crédito em euros'), {
      target: { value: '1.500,00' },
    });
    fireEvent.click(screen.getByRole('button', { name: /Criar/i }));

    await waitFor(() => expect(postCalls()).toHaveLength(1));
    expect(postCalls()[0]![0]).toBe('/api/financas/cartoes');
    expect(parsePostBody()).toEqual({
      account_id: 'a2',
      name: 'Visa Gold',
      card_type: 'credit',
      last4: '4321',
      closing_day: 5,
      due_day: 20,
      credit_limit_cents: 150000,
    });
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(refreshMock).toHaveBeenCalled();
  });

  it('cartão de débito mínimo — opcionais omitidos do body (schema .strict())', async () => {
    stubFetch();
    await renderOpen();

    fireEvent.change(screen.getByLabelText('Tipo de cartão'), { target: { value: 'debit' } });
    fireEvent.change(screen.getByLabelText('Nome do cartão'), {
      target: { value: 'Multibanco' },
    });
    // Débito — campo de limite escondido.
    expect(screen.queryByLabelText('Limite de crédito em euros')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /Criar/i }));

    await waitFor(() => expect(postCalls()).toHaveLength(1));
    expect(parsePostBody()).toEqual({
      account_id: 'a1',
      name: 'Multibanco',
      card_type: 'debit',
    });
  });

  it('erro do servidor mostra alerta e não fecha', async () => {
    stubFetch(ACCOUNTS, { ok: false, body: { error: { message: 'Conta não encontrada.' } } });
    const onClose = vi.fn();
    await renderOpen(onClose);

    fireEvent.change(screen.getByLabelText('Tipo de cartão'), { target: { value: 'debit' } });
    fireEvent.change(screen.getByLabelText('Nome do cartão'), { target: { value: 'Visa' } });
    fireEvent.click(screen.getByRole('button', { name: /Criar/i }));

    await waitFor(() =>
      expect(screen.getByRole('alert')).toHaveTextContent('Conta não encontrada.'),
    );
    expect(onClose).not.toHaveBeenCalled();
    expect(refreshMock).not.toHaveBeenCalled();
  });

  it('Cancelar fecha o modal', async () => {
    stubFetch();
    const onClose = vi.fn();
    await renderOpen(onClose);
    fireEvent.click(screen.getByRole('button', { name: /Cancelar/i }));
    expect(onClose).toHaveBeenCalled();
  });

  it('Escape fecha o modal', async () => {
    stubFetch();
    const onClose = vi.fn();
    await renderOpen(onClose);
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onClose).toHaveBeenCalled();
  });
});
