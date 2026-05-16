/**
 * Tests `<TaskSort>` (Story 3.3 T5.2 / AC4).
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';

const pushMock = vi.fn();
let currentSearchParams = new URLSearchParams('');

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: pushMock }),
  useSearchParams: () => currentSearchParams,
}));

import { TaskSort } from '@/app/(app)/tarefas/_components/TaskSort';

describe('<TaskSort>', () => {
  beforeEach(() => {
    pushMock.mockReset();
    currentSearchParams = new URLSearchParams('');
  });

  it('renderiza 4 opções de sort com labels PT-PT', () => {
    render(<TaskSort />);
    const select = screen.getByLabelText('Ordenar por');
    expect(select).toContainHTML('Prazo (crescente)');
    expect(select).toContainHTML('Criação (mais recentes)');
    expect(select).toContainHTML('Prioridade (alta primeiro)');
    expect(select).toContainHTML('Título (A-Z)');
  });

  it('change para created_at_desc chama router.push com ?sort=', () => {
    render(<TaskSort />);
    fireEvent.change(screen.getByLabelText('Ordenar por'), {
      target: { value: 'created_at_desc' },
    });
    expect(pushMock).toHaveBeenCalledWith(
      expect.stringContaining('sort=created_at_desc'),
      { scroll: false },
    );
  });

  it('change para due_date_asc (default) remove ?sort= do URL', () => {
    currentSearchParams = new URLSearchParams('sort=title_asc');
    render(<TaskSort />);
    fireEvent.change(screen.getByLabelText('Ordenar por'), { target: { value: 'due_date_asc' } });
    const pushArg = pushMock.mock.calls[0]![0] as string;
    expect(pushArg).not.toContain('sort=');
  });
});
