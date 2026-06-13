/**
 * Testes `<EditTaskModal>` — edição de tarefa com atribuição a membro (A6).
 *
 * Foco no campo "Atribuir a" (finish-line A6): carrega membros ao abrir
 * (GET /api/conta/household), pré-selecciona o assignee actual, e envia
 * `assigned_to_user_id` (UUID ou null) no PATCH /api/tasks/[id]. Cobre ainda
 * degradação graceful quando o GET de membros falha, erro do servidor no PATCH
 * e fecho via Cancelar/Escape. TagPicker/TagBadge são mockados para isolar.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';

import type { TaskRow } from '@/lib/api-helpers/list-tasks';

const refreshMock = vi.fn();
vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: refreshMock }),
}));

vi.mock('@/app/(app)/tarefas/_components/TagPicker', () => ({
  TagPicker: () => null,
}));
vi.mock('@/app/(app)/tarefas/_components/TagBadge', () => ({
  TagBadge: () => null,
}));

const fetchMock = vi.fn();
vi.stubGlobal('fetch', fetchMock);

import { EditTaskModal } from '@/app/(app)/tarefas/_components/EditTaskModal';

afterEach(() => {
  cleanup();
  fetchMock.mockReset();
  refreshMock.mockReset();
});

const MEMBERS = [
  { id: 'u1', fullName: 'Eurico', role: 'owner' },
  { id: 'u2', fullName: 'Maria', role: 'member' },
];

function makeTask(overrides: Partial<TaskRow> = {}): TaskRow {
  return {
    id: 't1',
    household_id: 'h1',
    created_by_user_id: 'u1',
    assigned_to_user_id: null,
    title: 'Comprar leite',
    description: 'Pacote de 1L',
    due_date: null,
    due_time: null,
    priority: 'medium',
    status: 'todo',
    kanban_column_id: null,
    kanban_position: 0,
    project: null,
    recurrence_id: null,
    is_recurrence_template: false,
    completed_at: null,
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
    tags: [],
    ...overrides,
  };
}

/** GET household devolve `members`; PATCH tasks responde com `patchResponse`. */
function stubFetch(
  members: unknown = MEMBERS,
  patchResponse: { ok: boolean; body?: unknown } = { ok: true, body: { task: { id: 't1' } } },
): void {
  fetchMock.mockImplementation((url: string, init?: { method?: string }) => {
    if (!init?.method || init.method === 'GET') {
      return Promise.resolve({ ok: true, json: async () => ({ members }) });
    }
    return Promise.resolve({ ok: patchResponse.ok, json: async () => patchResponse.body ?? {} });
  });
}

function patchCalls(): Array<[string, { method?: string; body?: string }]> {
  return fetchMock.mock.calls.filter(
    (call) => (call[1] as { method?: string } | undefined)?.method === 'PATCH',
  ) as Array<[string, { method?: string; body?: string }]>;
}

function parsePatchBody(): Record<string, unknown> {
  const call = patchCalls()[0];
  return JSON.parse(call![1].body!) as Record<string, unknown>;
}

/** Abre o modal e espera o fetch de membros resolver (select enabled). */
async function renderOpen(
  task: TaskRow = makeTask(),
  onClose: () => void = () => {},
): Promise<void> {
  render(<EditTaskModal task={task} open onClose={onClose} />);
  await waitFor(() => expect(screen.getByLabelText('Atribuir a')).not.toBeDisabled());
}

describe('<EditTaskModal>', () => {
  it('não renderiza nem faz fetch quando open=false', () => {
    render(<EditTaskModal task={makeTask()} open={false} onClose={() => {}} />);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('carrega membros ao abrir e mostra "Sem responsável" quando a tarefa não tem assignee', async () => {
    stubFetch();
    await renderOpen();
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledWith('/api/conta/household');
    const select = screen.getByLabelText('Atribuir a');
    expect(select).toHaveValue('');
    expect(screen.getByRole('option', { name: 'Eurico' })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: 'Maria' })).toBeInTheDocument();
  });

  it('pré-selecciona o assignee actual da tarefa', async () => {
    stubFetch();
    await renderOpen(makeTask({ assigned_to_user_id: 'u2' }));
    expect(screen.getByLabelText('Atribuir a')).toHaveValue('u2');
  });

  it('atribui a um membro — PATCH com assigned_to_user_id = UUID', async () => {
    stubFetch();
    const onClose = vi.fn();
    await renderOpen(makeTask(), onClose);

    fireEvent.change(screen.getByLabelText('Atribuir a'), { target: { value: 'u2' } });
    fireEvent.click(screen.getByRole('button', { name: /Guardar/i }));

    await waitFor(() => expect(patchCalls()).toHaveLength(1));
    expect(patchCalls()[0]![0]).toBe('/api/tasks/t1');
    expect(parsePatchBody()).toMatchObject({ assigned_to_user_id: 'u2' });
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(refreshMock).toHaveBeenCalled();
  });

  it('desatribui (Sem responsável) — PATCH com assigned_to_user_id = null', async () => {
    stubFetch();
    await renderOpen(makeTask({ assigned_to_user_id: 'u2' }));

    fireEvent.change(screen.getByLabelText('Atribuir a'), { target: { value: '' } });
    fireEvent.click(screen.getByRole('button', { name: /Guardar/i }));

    await waitFor(() => expect(patchCalls()).toHaveLength(1));
    expect(parsePatchBody()).toMatchObject({ assigned_to_user_id: null });
  });

  it('GET de membros falha: esconde o select, mostra aviso e mantém a atribuição actual no PATCH', async () => {
    fetchMock.mockImplementation((url: string, init?: { method?: string }) => {
      if (!init?.method || init.method === 'GET') {
        return Promise.resolve({ ok: false, json: async () => ({}) });
      }
      return Promise.resolve({ ok: true, json: async () => ({ task: { id: 't1' } }) });
    });
    render(<EditTaskModal task={makeTask({ assigned_to_user_id: 'u2' })} open onClose={() => {}} />);

    await waitFor(() =>
      expect(screen.getByRole('status')).toHaveTextContent(/Não foi possível carregar os membros/i),
    );
    expect(screen.queryByLabelText('Atribuir a')).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /Guardar/i }));
    await waitFor(() => expect(patchCalls()).toHaveLength(1));
    expect(parsePatchBody()).toMatchObject({ assigned_to_user_id: 'u2' });
  });

  it('erro do servidor no PATCH mostra alerta e não fecha', async () => {
    stubFetch(MEMBERS, { ok: false, body: { error: { message: 'Membro inválido.' } } });
    const onClose = vi.fn();
    await renderOpen(makeTask(), onClose);

    fireEvent.change(screen.getByLabelText('Atribuir a'), { target: { value: 'u1' } });
    fireEvent.click(screen.getByRole('button', { name: /Guardar/i }));

    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('Membro inválido.'));
    expect(onClose).not.toHaveBeenCalled();
    expect(refreshMock).not.toHaveBeenCalled();
  });

  it('Cancelar fecha o modal', async () => {
    stubFetch();
    const onClose = vi.fn();
    await renderOpen(makeTask(), onClose);
    fireEvent.click(screen.getByRole('button', { name: /Cancelar/i }));
    expect(onClose).toHaveBeenCalled();
  });

  it('Escape fecha o modal', async () => {
    stubFetch();
    const onClose = vi.fn();
    await renderOpen(makeTask(), onClose);
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onClose).toHaveBeenCalled();
  });
});
