/**
 * Testes `<NewTaskModal>` — formulário completo de criação (P1 make-it-work).
 *
 * Cobre: render condicional por `open`, validação de título obrigatório,
 * POST /api/tasks com todos os campos (incluindo `due_time` e `priority` que
 * eram o gap), regra hora-só-com-data, e fecho via Cancelar/Escape.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';

const refreshMock = vi.fn();
vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: refreshMock }),
}));

const fetchMock = vi.fn();
vi.stubGlobal('fetch', fetchMock);

import { NewTaskModal } from '@/app/(app)/tarefas/_components/NewTaskModal';

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

describe('<NewTaskModal>', () => {
  it('não renderiza quando open=false', () => {
    render(<NewTaskModal open={false} onClose={() => {}} />);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('renderiza o formulário quando open=true', () => {
    render(<NewTaskModal open onClose={() => {}} />);
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: /Nova tarefa/i })).toBeInTheDocument();
    expect(screen.getByLabelText('Título da tarefa')).toBeInTheDocument();
    expect(screen.getByLabelText('Hora')).toBeInTheDocument();
    expect(screen.getByLabelText('Prioridade')).toBeInTheDocument();
  });

  it('título vazio bloqueia submit e mostra erro — sem POST', () => {
    render(<NewTaskModal open onClose={() => {}} />);
    fireEvent.click(screen.getByRole('button', { name: /Criar tarefa/i }));
    expect(screen.getByRole('alert')).toHaveTextContent(/título é obrigatório/i);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('cria tarefa com todos os campos (due_time + priority + project)', async () => {
    fetchMock.mockResolvedValue({ ok: true, json: async () => ({ task: { id: 'new' } }) });
    const onClose = vi.fn();
    render(<NewTaskModal open onClose={onClose} />);

    fireEvent.change(screen.getByLabelText('Título da tarefa'), {
      target: { value: 'Ir ao notário em Tavira' },
    });
    fireEvent.change(screen.getByLabelText('Prazo'), { target: { value: '2026-06-15' } });
    fireEvent.change(screen.getByLabelText('Hora'), { target: { value: '09:00' } });
    fireEvent.change(screen.getByLabelText('Prioridade'), { target: { value: 'high' } });
    fireEvent.change(screen.getByLabelText('Projecto'), { target: { value: 'Casa' } });
    fireEvent.click(screen.getByRole('button', { name: /Criar tarefa/i }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    expect(fetchMock).toHaveBeenCalledWith('/api/tasks', expect.objectContaining({ method: 'POST' }));
    const body = parseBody();
    expect(body).toMatchObject({
      title: 'Ir ao notário em Tavira',
      due_date: '2026-06-15',
      due_time: '09:00',
      priority: 'high',
      project: 'Casa',
    });
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(refreshMock).toHaveBeenCalled();
  });

  it('hora sem prazo não é enviada (due_time null)', async () => {
    fetchMock.mockResolvedValue({ ok: true, json: async () => ({ task: { id: 'new' } }) });
    render(<NewTaskModal open onClose={() => {}} />);

    fireEvent.change(screen.getByLabelText('Título da tarefa'), { target: { value: 'Sem data' } });
    // Campo Hora está disabled enquanto não houver prazo.
    expect(screen.getByLabelText('Hora')).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: /Criar tarefa/i }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    const body = parseBody();
    expect(body.due_time).toBeNull();
    expect(body.due_date).toBeNull();
  });

  it('erro do servidor mostra alerta e não fecha', async () => {
    fetchMock.mockResolvedValue({
      ok: false,
      json: async () => ({ error: { message: 'Dados inválidos.' } }),
    });
    const onClose = vi.fn();
    render(<NewTaskModal open onClose={onClose} />);

    fireEvent.change(screen.getByLabelText('Título da tarefa'), { target: { value: 'X' } });
    fireEvent.click(screen.getByRole('button', { name: /Criar tarefa/i }));

    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('Dados inválidos.'));
    expect(onClose).not.toHaveBeenCalled();
  });

  it('Cancelar fecha o modal', () => {
    const onClose = vi.fn();
    render(<NewTaskModal open onClose={onClose} />);
    fireEvent.click(screen.getByRole('button', { name: /Cancelar/i }));
    expect(onClose).toHaveBeenCalled();
  });

  it('Escape fecha o modal', () => {
    const onClose = vi.fn();
    render(<NewTaskModal open onClose={onClose} />);
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onClose).toHaveBeenCalled();
  });

  it('initialDueDate pré-preenche o prazo e activa a hora', () => {
    render(<NewTaskModal open onClose={() => {}} initialDueDate="2026-06-20" />);
    expect(screen.getByLabelText('Prazo')).toHaveValue('2026-06-20');
    expect(screen.getByLabelText('Hora')).not.toBeDisabled();
  });
});
