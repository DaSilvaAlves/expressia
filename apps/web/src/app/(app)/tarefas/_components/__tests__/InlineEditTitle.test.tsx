/**
 * Tests `<InlineEditTitle>` (Story 3.3 T7.1 / AC8).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';

import { InlineEditTitle } from '@/app/(app)/tarefas/_components/InlineEditTitle';

beforeEach(() => {
  global.fetch = vi.fn();
});
afterEach(() => {
  vi.restoreAllMocks();
});

describe('<InlineEditTitle>', () => {
  it('renderiza título inicial como botão clicável', () => {
    render(<InlineEditTitle taskId="t1" initialTitle="Comprar pão" />);
    expect(screen.getByText('Comprar pão')).toBeInTheDocument();
  });

  it('click no título → input swap pre-filled', () => {
    render(<InlineEditTitle taskId="t1" initialTitle="Comprar pão" />);
    fireEvent.click(screen.getByText('Comprar pão'));
    const input = screen.getByDisplayValue('Comprar pão') as HTMLInputElement;
    expect(input).toBeInTheDocument();
  });

  it('Enter → PATCH success → fecha edit mode', async () => {
    (global.fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({ task: { id: 't1', title: 'Comprar pão fresco' } }),
    });
    render(<InlineEditTitle taskId="t1" initialTitle="Comprar pão" />);
    fireEvent.click(screen.getByText('Comprar pão'));
    const input = screen.getByDisplayValue('Comprar pão');
    fireEvent.change(input, { target: { value: 'Comprar pão fresco' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    await waitFor(() => {
      expect(global.fetch).toHaveBeenCalledWith(
        '/api/tasks/t1',
        expect.objectContaining({
          method: 'PATCH',
          body: JSON.stringify({ title: 'Comprar pão fresco' }),
        }),
      );
    });
  });

  it('Escape → revert sem PATCH', () => {
    render(<InlineEditTitle taskId="t1" initialTitle="Comprar pão" />);
    fireEvent.click(screen.getByText('Comprar pão'));
    const input = screen.getByDisplayValue('Comprar pão');
    fireEvent.change(input, { target: { value: 'novo' } });
    fireEvent.keyDown(input, { key: 'Escape' });
    expect(global.fetch).not.toHaveBeenCalled();
    expect(screen.getByText('Comprar pão')).toBeInTheDocument();
  });

  it('validation error título vazio mostra alert + não faz PATCH', async () => {
    render(<InlineEditTitle taskId="t1" initialTitle="Comprar pão" />);
    fireEvent.click(screen.getByText('Comprar pão'));
    const input = screen.getByDisplayValue('Comprar pão');
    fireEvent.change(input, { target: { value: '   ' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    await waitFor(() => {
      expect(screen.getByRole('alert')).toHaveTextContent(/Título obrigatório/);
    });
    expect(global.fetch).not.toHaveBeenCalled();
  });
});
