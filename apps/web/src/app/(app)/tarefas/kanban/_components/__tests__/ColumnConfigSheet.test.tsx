/**
 * Testes `<ColumnConfigSheet>` — abrir/fechar, mostrar columns, "+ Adicionar"
 * disabled em 6/6, Guardar chama batch endpoint, validações inline (Story 3.4 T11.4).
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';

const fetchMock = vi.fn();
vi.stubGlobal('fetch', fetchMock);

import { ColumnConfigSheet } from '@/app/(app)/tarefas/kanban/_components/ColumnConfigSheet';
import type { KanbanColumnRow } from '@/lib/api-schemas/kanban-columns';

const COLUMNS_3: KanbanColumnRow[] = [
  { id: 'c1', name: 'A fazer', sort_order: 0, color: '#6B7280', is_done_column: false },
  { id: 'c2', name: 'Em curso', sort_order: 1, color: '#6B7280', is_done_column: false },
  { id: 'c3', name: 'Concluído', sort_order: 2, color: '#6B7280', is_done_column: true },
];

const COLUMNS_6: KanbanColumnRow[] = [
  ...COLUMNS_3,
  { id: 'c4', name: 'Bloqueado', sort_order: 3, color: '#6B7280', is_done_column: false },
  { id: 'c5', name: 'Em revisão', sort_order: 4, color: '#6B7280', is_done_column: false },
  { id: 'c6', name: 'Arquivado', sort_order: 5, color: '#6B7280', is_done_column: false },
];

afterEach(() => {
  cleanup();
  fetchMock.mockReset();
});

describe('<ColumnConfigSheet>', () => {
  it('mostra 3 colunas existentes', () => {
    render(
      <ColumnConfigSheet
        currentColumns={COLUMNS_3}
        onClose={() => {}}
        onSaved={() => {}}
      />,
    );
    expect(screen.getByDisplayValue('A fazer')).toBeInTheDocument();
    expect(screen.getByDisplayValue('Em curso')).toBeInTheDocument();
    expect(screen.getByDisplayValue('Concluído')).toBeInTheDocument();
  });

  it('"+ Adicionar coluna" disabled quando 6/6', () => {
    render(
      <ColumnConfigSheet
        currentColumns={COLUMNS_6}
        onClose={() => {}}
        onSaved={() => {}}
      />,
    );
    const addBtn = screen.getByRole('button', { name: /Adicionar coluna/i });
    expect(addBtn).toBeDisabled();
  });

  it('Cancelar fecha sem chamar fetch', () => {
    const onClose = vi.fn();
    render(
      <ColumnConfigSheet
        currentColumns={COLUMNS_3}
        onClose={onClose}
        onSaved={() => {}}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Cancelar' }));
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('Guardar chama PATCH /api/kanban-columns/batch + onSaved com response', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({ columns: COLUMNS_3 }),
    });
    const onSaved = vi.fn();
    render(
      <ColumnConfigSheet
        currentColumns={COLUMNS_3}
        onClose={() => {}}
        onSaved={onSaved}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: /Guardar/i }));
    // wait for promise
    await new Promise((r) => setTimeout(r, 50));
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/kanban-columns/batch',
      expect.objectContaining({
        method: 'PATCH',
      }),
    );
    expect(onSaved).toHaveBeenCalledWith(COLUMNS_3);
  });

  it('validation: rename para nome duplicado mostra erro inline', async () => {
    render(
      <ColumnConfigSheet
        currentColumns={COLUMNS_3}
        onClose={() => {}}
        onSaved={() => {}}
      />,
    );
    const firstInput = screen.getByDisplayValue('A fazer') as HTMLInputElement;
    fireEvent.change(firstInput, { target: { value: 'Em curso' } });
    fireEvent.click(screen.getByRole('button', { name: /Guardar/i }));
    await new Promise((r) => setTimeout(r, 50));
    expect(screen.getByRole('alert')).toHaveTextContent(/únicos/);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
