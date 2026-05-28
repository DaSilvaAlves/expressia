/**
 * Tests — `<AddWidgetMenu>` (Story 5.7 AC3/AC6/AC7 — re-activar widgets OFF).
 *
 * Cobre: lista apenas os widgets OFF (labels PT-PT, ordem canónica); activar
 * chama setWidget(true) + router.refresh; estado "todos ON" → disabled.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

import type { WidgetsEnabled } from '@meu-jarvis/db';

const refreshMock = vi.fn();
vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: refreshMock }),
}));

import { AddWidgetMenu } from '@/app/(app)/visao/_components/AddWidgetMenu';
import { useWidgetConfigStore } from '@/lib/stores/widgetConfigStore';

const DEFAULTS: WidgetsEnabled = {
  briefing: true,
  tasks_today: true,
  finance_month: true,
  recurrences_next: true,
  tasks_overdue: true,
  accounts_balance: false,
  calendar_week: false,
};

const ALL_ON: WidgetsEnabled = {
  briefing: true,
  tasks_today: true,
  finance_month: true,
  recurrences_next: true,
  tasks_overdue: true,
  accounts_balance: true,
  calendar_week: true,
};

function resetStore(): void {
  useWidgetConfigStore.setState({
    widgetsEnabled: null,
    lastPersisted: null,
    pending: false,
    banner: { kind: 'idle' },
    hydrated: false,
  });
}

beforeEach(() => {
  resetStore();
  refreshMock.mockClear();
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true }));
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('<AddWidgetMenu>', () => {
  it('mostra o botão [+ Adicionar widget]', () => {
    useWidgetConfigStore.getState().hydrate(DEFAULTS);
    render(<AddWidgetMenu initial={DEFAULTS} />);
    expect(screen.getByRole('button', { name: '+ Adicionar widget' })).toBeInTheDocument();
  });

  it('ao abrir, lista apenas os widgets OFF com labels PT-PT (ordem canónica)', () => {
    useWidgetConfigStore.getState().hydrate(DEFAULTS);
    render(<AddWidgetMenu initial={DEFAULTS} />);
    fireEvent.click(screen.getByRole('button', { name: '+ Adicionar widget' }));

    expect(screen.getByText('Saldo por conta')).toBeInTheDocument();
    expect(screen.getByText('Calendário da semana')).toBeInTheDocument();
    // Widgets ON não aparecem na lista.
    expect(screen.queryByText('Briefing diário')).not.toBeInTheDocument();
  });

  it('activar um widget chama setWidget(true) + router.refresh', async () => {
    useWidgetConfigStore.getState().hydrate(DEFAULTS);
    render(<AddWidgetMenu initial={DEFAULTS} />);
    fireEvent.click(screen.getByRole('button', { name: '+ Adicionar widget' }));
    fireEvent.click(screen.getByText('Saldo por conta'));

    await waitFor(() => {
      expect(useWidgetConfigStore.getState().widgetsEnabled?.accounts_balance).toBe(true);
    });
    await waitFor(() => {
      expect(refreshMock).toHaveBeenCalled();
    });
  });

  it('estado "todos ON" → botão disabled com texto explicativo', () => {
    useWidgetConfigStore.getState().hydrate(ALL_ON);
    render(<AddWidgetMenu initial={ALL_ON} />);
    const btn = screen.getByRole('button', { name: 'Todos os widgets já estão no painel' });
    expect(btn).toBeDisabled();
  });

  it('o disclosure expõe aria-expanded', () => {
    useWidgetConfigStore.getState().hydrate(DEFAULTS);
    render(<AddWidgetMenu initial={DEFAULTS} />);
    const btn = screen.getByRole('button', { name: '+ Adicionar widget' });
    expect(btn).toHaveAttribute('aria-expanded', 'false');
    fireEvent.click(btn);
    expect(btn).toHaveAttribute('aria-expanded', 'true');
  });
});
