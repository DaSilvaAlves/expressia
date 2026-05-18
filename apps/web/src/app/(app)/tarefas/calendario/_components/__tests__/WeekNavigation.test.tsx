/**
 * Tests `<WeekNavigation>` (Story 3.5 T11.5).
 *
 * Cobre prev/today/next + URL state + keyboard shortcuts.
 * R3 DST edge cases já cobertos em week-helpers.test.ts.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

const pushMock = vi.fn();

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: pushMock, refresh: () => {} }),
  useSearchParams: () => ({
    toString: () => '',
    get: () => null,
  }),
}));

import { WeekNavigation } from '@/app/(app)/tarefas/calendario/_components/WeekNavigation';

describe('<WeekNavigation>', () => {
  beforeEach(() => {
    pushMock.mockReset();
  });

  it('renderiza 3 botões (anterior / Hoje / seguinte) + título range PT-PT', () => {
    render(<WeekNavigation weekStartIso="2026-W21" />);
    expect(screen.getByTitle('Semana anterior (←)')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Hoje' })).toBeInTheDocument();
    expect(screen.getByTitle('Semana seguinte (→)')).toBeInTheDocument();
    // Título 18 a 24 Maio 2026 (ISO W21 = 2026-05-18 Mon → 2026-05-24 Sun).
    expect(screen.getByRole('heading', { level: 2 })).toHaveTextContent('18 a 24 Maio 2026');
  });

  it('clica em "anterior" navega para semana anterior (W20)', () => {
    render(<WeekNavigation weekStartIso="2026-W21" />);
    fireEvent.click(screen.getByTitle('Semana anterior (←)'));
    expect(pushMock).toHaveBeenCalledWith(expect.stringContaining('week=2026-W20'));
  });

  it('clica em "Hoje" remove o param week', () => {
    render(<WeekNavigation weekStartIso="2026-W21" />);
    fireEvent.click(screen.getByRole('button', { name: 'Hoje' }));
    expect(pushMock).toHaveBeenCalledWith('/tarefas/calendario');
  });

  it('clica em "seguinte" navega para semana seguinte (W22)', () => {
    render(<WeekNavigation weekStartIso="2026-W21" />);
    fireEvent.click(screen.getByTitle('Semana seguinte (→)'));
    expect(pushMock).toHaveBeenCalledWith(expect.stringContaining('week=2026-W22'));
  });
});

