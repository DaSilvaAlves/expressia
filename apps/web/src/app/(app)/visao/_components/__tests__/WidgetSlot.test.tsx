/**
 * Tests — `<WidgetSlot>` (Story 5.7 AC2/AC7 — controlo `×` remover).
 *
 * Cobre: render mostra children + botão `×` com aria-label PT-PT; clicar `×`
 * define o widget OFF no store (optimistic); quando o store diz OFF, o slot
 * esconde (null).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

import type { WidgetsEnabled } from '@meu-jarvis/db';

import { WidgetSlot } from '@/app/(app)/visao/_components/WidgetSlot';
import { useWidgetConfigStore } from '@/lib/stores/widgetConfigStore';

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
  // Evita PATCH real ao clicar (setWidget agenda debounce).
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true }));
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('<WidgetSlot>', () => {
  it('mostra children + botão × com aria-label PT-PT', () => {
    useWidgetConfigStore.getState().hydrate(ALL_ON);
    render(
      <WidgetSlot widgetId="finance_month">
        <div>CONTEUDO</div>
      </WidgetSlot>,
    );
    expect(screen.getByText('CONTEUDO')).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'Remover Gastos do mês do painel' }),
    ).toBeInTheDocument();
  });

  it('expõe data-widget e a orderClass', () => {
    useWidgetConfigStore.getState().hydrate(ALL_ON);
    const { container } = render(
      <WidgetSlot widgetId="tasks_today" orderClass="order-first md:order-none">
        <div>X</div>
      </WidgetSlot>,
    );
    const slot = container.querySelector('[data-widget="tasks_today"]');
    expect(slot).not.toBeNull();
    expect(slot?.className).toContain('order-first');
  });

  it('clicar × define o widget OFF no store (optimistic)', () => {
    useWidgetConfigStore.getState().hydrate(ALL_ON);
    render(
      <WidgetSlot widgetId="briefing">
        <div>X</div>
      </WidgetSlot>,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Remover Briefing diário do painel' }));
    expect(useWidgetConfigStore.getState().widgetsEnabled?.briefing).toBe(false);
  });

  it('esconde (null) quando o store diz que o widget está OFF', () => {
    useWidgetConfigStore.getState().hydrate({ ...ALL_ON, calendar_week: false });
    const { container } = render(
      <WidgetSlot widgetId="calendar_week">
        <div>NAO_DEVE_APARECER</div>
      </WidgetSlot>,
    );
    expect(container.querySelector('[data-widget="calendar_week"]')).toBeNull();
    expect(screen.queryByText('NAO_DEVE_APARECER')).not.toBeInTheDocument();
  });

  it('mostra o widget quando o store ainda não está hidratado (default true)', () => {
    // sem hydrate → widgetsEnabled === null → useWidgetEnabled devolve true
    render(
      <WidgetSlot widgetId="briefing">
        <div>VISIVEL</div>
      </WidgetSlot>,
    );
    expect(screen.getByText('VISIVEL')).toBeInTheDocument();
  });
});
