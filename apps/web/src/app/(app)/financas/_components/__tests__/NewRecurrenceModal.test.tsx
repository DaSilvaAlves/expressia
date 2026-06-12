/**
 * Testes `<NewRecurrenceModal>` — formulário de criação de recorrência (A4).
 *
 * Cobre: render condicional por `open`, fetch das contas ao abrir (GET
 * /api/financas/contas, primeira pré-seleccionada), validação de
 * descrição/valor/data, POST /api/financas/recorrencias com `amount_cents`
 * parseado de PT-PT ("700,00" → 70000), escopo MVP (sem `custom` na lista de
 * frequências; `interval`/`payment_method` omitidos — defaults do schema),
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

import { NewRecurrenceModal } from '@/app/(app)/financas/_components/NewRecurrenceModal';

afterEach(() => {
  cleanup();
  fetchMock.mockReset();
  refreshMock.mockReset();
});

const ACCOUNTS = [
  { id: 'a1', name: 'Conta Ordenado', bank_name: 'CGD' },
  { id: 'a2', name: 'Dinheiro', bank_name: null },
];

/** GET contas responde com `accounts`; POST recorrencias responde com `postResponse`. */
function stubFetch(
  accounts: unknown = ACCOUNTS,
  postResponse: { ok: boolean; body?: unknown } = {
    ok: true,
    body: { recurrence: { id: 'new' } },
  },
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
  render(<NewRecurrenceModal open onClose={onClose} />);
  await waitFor(() => expect(screen.getByLabelText('Conta associada')).not.toBeDisabled());
}

describe('<NewRecurrenceModal>', () => {
  it('não renderiza quando open=false', () => {
    render(<NewRecurrenceModal open={false} onClose={() => {}} />);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('renderiza o formulário e carrega as contas (primeira pré-seleccionada)', async () => {
    stubFetch();
    await renderOpen();
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: /Nova recorrência/i })).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledWith('/api/financas/contas');
    expect(screen.getByLabelText('Conta associada')).toHaveValue('a1');
    expect(screen.getByLabelText('Tipo de recorrência')).toHaveValue('expense');
    expect(screen.getByLabelText('Frequência')).toHaveValue('monthly');
  });

  it('a frequência "custom" não é oferecida no formulário MVP', async () => {
    stubFetch();
    await renderOpen();
    expect(
      screen.queryByRole('option', { name: /Personalizada/i }),
    ).not.toBeInTheDocument();
  });

  it('sem contas: aviso + Criar disabled', async () => {
    stubFetch([]);
    render(<NewRecurrenceModal open onClose={() => {}} />);
    await waitFor(() =>
      expect(screen.getByRole('alert')).toHaveTextContent(/Ainda não há contas/i),
    );
    expect(screen.getByRole('button', { name: /Criar/i })).toBeDisabled();
  });

  it('falha no GET das contas: alerta de erro + Criar disabled', async () => {
    fetchMock.mockResolvedValue({ ok: false, json: async () => ({}) });
    render(<NewRecurrenceModal open onClose={() => {}} />);
    await waitFor(() =>
      expect(screen.getByRole('alert')).toHaveTextContent(/Erro ao carregar as contas/i),
    );
    expect(screen.getByRole('button', { name: /Criar/i })).toBeDisabled();
  });

  it('descrição vazia bloqueia submit e mostra erro — sem POST', async () => {
    stubFetch();
    await renderOpen();
    fireEvent.click(screen.getByRole('button', { name: /Criar/i }));
    expect(screen.getByRole('alert')).toHaveTextContent(/descrição é obrigatória/i);
    expect(postCalls()).toHaveLength(0);
  });

  it('valor inválido bloqueia submit e mostra erro — sem POST', async () => {
    stubFetch();
    await renderOpen();
    fireEvent.change(screen.getByLabelText('Descrição'), { target: { value: 'Renda' } });
    fireEvent.change(screen.getByLabelText('Valor em euros'), { target: { value: 'abc' } });
    fireEvent.click(screen.getByRole('button', { name: /Criar/i }));
    expect(screen.getByRole('alert')).toHaveTextContent(/Valor inválido/i);
    expect(postCalls()).toHaveLength(0);
  });

  it('data de início vazia bloqueia submit — sem POST', async () => {
    stubFetch();
    await renderOpen();
    fireEvent.change(screen.getByLabelText('Descrição'), { target: { value: 'Renda' } });
    fireEvent.change(screen.getByLabelText('Valor em euros'), { target: { value: '700,00' } });
    fireEvent.click(screen.getByRole('button', { name: /Criar/i }));
    expect(screen.getByRole('alert')).toHaveTextContent(/Data de início inválida/i);
    expect(postCalls()).toHaveLength(0);
  });

  it('cria recorrência completa — amount_cents parseado de "700,00"; opcionais omitidos', async () => {
    stubFetch();
    const onClose = vi.fn();
    await renderOpen(onClose);

    fireEvent.change(screen.getByLabelText('Conta associada'), { target: { value: 'a2' } });
    fireEvent.change(screen.getByLabelText('Tipo de recorrência'), {
      target: { value: 'income' },
    });
    fireEvent.change(screen.getByLabelText('Frequência'), { target: { value: 'weekly' } });
    fireEvent.change(screen.getByLabelText('Descrição'), { target: { value: 'Salário' } });
    fireEvent.change(screen.getByLabelText('Valor em euros'), { target: { value: '700,00' } });
    fireEvent.change(screen.getByLabelText('Data de início'), {
      target: { value: '2026-07-01' },
    });
    fireEvent.click(screen.getByRole('button', { name: /Criar/i }));

    await waitFor(() => expect(postCalls()).toHaveLength(1));
    expect(postCalls()[0]![0]).toBe('/api/financas/recorrencias');
    expect(parsePostBody()).toEqual({
      kind: 'income',
      description: 'Salário',
      amount_cents: 70000,
      account_id: 'a2',
      frequency: 'weekly',
      starts_on: '2026-07-01',
    });
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(refreshMock).toHaveBeenCalled();
  });

  it('erro do servidor mostra alerta e não fecha', async () => {
    stubFetch(ACCOUNTS, { ok: false, body: { error: { message: 'Conta não encontrada.' } } });
    const onClose = vi.fn();
    await renderOpen(onClose);

    fireEvent.change(screen.getByLabelText('Descrição'), { target: { value: 'Renda' } });
    fireEvent.change(screen.getByLabelText('Valor em euros'), { target: { value: '700,00' } });
    fireEvent.change(screen.getByLabelText('Data de início'), {
      target: { value: '2026-07-01' },
    });
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
