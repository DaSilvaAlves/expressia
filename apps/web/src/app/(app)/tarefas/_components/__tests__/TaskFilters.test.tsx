/**
 * Tests `<TaskFilters>` (Story 3.3 T5.1 / AC3).
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';

const pushMock = vi.fn();
let currentSearchParams = new URLSearchParams('');

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: pushMock }),
  useSearchParams: () => currentSearchParams,
}));

import { TaskFilters } from '@/app/(app)/tarefas/_components/TaskFilters';

describe('<TaskFilters>', () => {
  beforeEach(() => {
    pushMock.mockReset();
    currentSearchParams = new URLSearchParams('');
  });

  it('renderiza labels em PT-PT', () => {
    render(<TaskFilters />);
    expect(screen.getByLabelText('Estado')).toBeInTheDocument();
    expect(screen.getByLabelText('Prioridade')).toBeInTheDocument();
    expect(screen.getByLabelText(/Procurar por projecto/i)).toBeInTheDocument();
    expect(screen.getByLabelText('Prazo de')).toBeInTheDocument();
    expect(screen.getByLabelText('Prazo até')).toBeInTheDocument();
  });

  it('opções estado em PT-PT (A fazer / Em curso / Concluído / Arquivado)', () => {
    render(<TaskFilters />);
    const statusSelect = screen.getByLabelText('Estado');
    expect(statusSelect).toContainHTML('A fazer');
    expect(statusSelect).toContainHTML('Em curso');
    expect(statusSelect).toContainHTML('Concluído');
    expect(statusSelect).toContainHTML('Arquivado');
  });

  it('change status select chama router.push com URL parameter', () => {
    render(<TaskFilters />);
    fireEvent.change(screen.getByLabelText('Estado'), { target: { value: 'doing' } });
    expect(pushMock).toHaveBeenCalledWith(
      expect.stringContaining('status=doing'),
      { scroll: false },
    );
  });

  it('change priority select chama router.push com URL parameter', () => {
    render(<TaskFilters />);
    fireEvent.change(screen.getByLabelText('Prioridade'), { target: { value: 'high' } });
    expect(pushMock).toHaveBeenCalledWith(
      expect.stringContaining('priority=high'),
      { scroll: false },
    );
  });

  it('search input debounce — não push instantâneo, push após delay', async () => {
    render(<TaskFilters />);
    fireEvent.change(screen.getByLabelText(/Procurar por projecto/i), {
      target: { value: 'casa' },
    });
    // Antes de delay — nada
    expect(pushMock).not.toHaveBeenCalled();
    await waitFor(
      () =>
        expect(pushMock).toHaveBeenCalledWith(
          expect.stringContaining('project=casa'),
          { scroll: false },
        ),
      { timeout: 1000 },
    );
  });

  it('clear filters button push para /tarefas sem params', () => {
    currentSearchParams = new URLSearchParams('status=todo&priority=high');
    render(<TaskFilters />);
    fireEvent.click(screen.getByText('Limpar filtros'));
    expect(pushMock).toHaveBeenCalledWith('/tarefas', { scroll: false });
  });

  it('clear filters button não aparece sem filters activos', () => {
    currentSearchParams = new URLSearchParams('');
    render(<TaskFilters />);
    expect(screen.queryByText('Limpar filtros')).not.toBeInTheDocument();
  });
});
