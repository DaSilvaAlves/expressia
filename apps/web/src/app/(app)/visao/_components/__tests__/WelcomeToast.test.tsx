/**
 * Tests `<WelcomeToast>` (Story 6.2 AC8).
 *
 * jsdom. Cobre: mostra a mensagem com o nome; guard "uma vez" via sessionStorage
 * (re-mount não repete); auto-dismiss após 5s.
 */
import { render, screen, act } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { WelcomeToast } from '@/app/(app)/visao/_components/WelcomeToast';

describe('WelcomeToast', () => {
  beforeEach(() => {
    window.sessionStorage.clear();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.runOnlyPendingTimers();
    vi.useRealTimers();
  });

  it('mostra a saudação com o nome (AC8)', () => {
    render(<WelcomeToast name="João" />);
    expect(screen.getByRole('status')).toHaveTextContent('Bem-vindo, João. O Expressia está pronto.');
  });

  it('auto-dismiss após 5s', () => {
    render(<WelcomeToast name="João" />);
    expect(screen.queryByRole('status')).toBeInTheDocument();
    act(() => {
      vi.advanceTimersByTime(5000);
    });
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });

  it('mostra uma única vez por sessão — re-mount não repete (AC8)', () => {
    const first = render(<WelcomeToast name="João" />);
    expect(screen.getByRole('status')).toBeInTheDocument();
    first.unmount();

    // 2ª montagem (ex.: refresh de /visao?welcome=1) → guard sessionStorage.
    render(<WelcomeToast name="João" />);
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });
});
