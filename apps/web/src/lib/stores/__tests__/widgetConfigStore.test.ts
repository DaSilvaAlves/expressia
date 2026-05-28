/**
 * Tests — `widgetConfigStore` (Story 5.7 AC2/AC4 — DP-5.7.B/D).
 *
 * Cobre: hydrate idempotente; setWidget optimistic; debounce agrupa toggles
 * num único PATCH; flushNow imediato; revert + banner de erro em PATCH falhado.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { WidgetsEnabled } from '@meu-jarvis/db';

import { useWidgetConfigStore } from '@/lib/stores/widgetConfigStore';

const INITIAL: WidgetsEnabled = {
  briefing: true,
  tasks_today: true,
  finance_month: true,
  recurrences_next: true,
  tasks_overdue: true,
  accounts_balance: false,
  calendar_week: false,
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
  vi.useFakeTimers();
  resetStore();
});

afterEach(() => {
  vi.clearAllTimers();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('hydrate', () => {
  it('inicializa widgetsEnabled + lastPersisted e marca hydrated', () => {
    useWidgetConfigStore.getState().hydrate(INITIAL);
    const s = useWidgetConfigStore.getState();
    expect(s.widgetsEnabled).toEqual(INITIAL);
    expect(s.lastPersisted).toEqual(INITIAL);
    expect(s.hydrated).toBe(true);
  });

  it('é idempotente — segunda chamada não sobrescreve estado optimistic', () => {
    const store = useWidgetConfigStore.getState();
    store.hydrate(INITIAL);
    store.setWidget('briefing', false); // optimistic
    store.hydrate(INITIAL); // não deve repor briefing=true
    expect(useWidgetConfigStore.getState().widgetsEnabled?.briefing).toBe(false);
  });
});

describe('setWidget optimistic + debounce (DP-5.7.D)', () => {
  it('actualiza o estado imediatamente (optimistic)', () => {
    const store = useWidgetConfigStore.getState();
    store.hydrate(INITIAL);
    store.setWidget('finance_month', false);
    expect(useWidgetConfigStore.getState().widgetsEnabled?.finance_month).toBe(false);
  });

  it('3 toggles em < janela → 1 único PATCH com o estado final', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true });
    vi.stubGlobal('fetch', fetchMock);

    const store = useWidgetConfigStore.getState();
    store.hydrate(INITIAL);
    store.setWidget('briefing', false);
    store.setWidget('tasks_today', false);
    store.setWidget('accounts_balance', true);

    await vi.advanceTimersByTimeAsync(600);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [, opts] = fetchMock.mock.calls[0] as [string, RequestInit];
    const sent = JSON.parse(opts.body as string) as { widgets_enabled: WidgetsEnabled };
    expect(sent.widgets_enabled.briefing).toBe(false);
    expect(sent.widgets_enabled.tasks_today).toBe(false);
    expect(sent.widgets_enabled.accounts_balance).toBe(true);
  });

  it('PATCH com sucesso → banner "Guardado." + lastPersisted actualizado', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true });
    vi.stubGlobal('fetch', fetchMock);

    const store = useWidgetConfigStore.getState();
    store.hydrate(INITIAL);
    store.setWidget('briefing', false);
    await vi.advanceTimersByTimeAsync(600);

    const s = useWidgetConfigStore.getState();
    expect(s.banner).toEqual({ kind: 'success', text: 'Guardado.' });
    expect(s.lastPersisted?.briefing).toBe(false);
  });
});

describe('revert em erro (AC2.b)', () => {
  it('PATCH falhado → reverte para lastPersisted + banner de erro', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: false });
    vi.stubGlobal('fetch', fetchMock);

    const store = useWidgetConfigStore.getState();
    store.hydrate(INITIAL);
    store.setWidget('briefing', false);
    await vi.advanceTimersByTimeAsync(600);

    const s = useWidgetConfigStore.getState();
    expect(s.widgetsEnabled?.briefing).toBe(true); // revertido
    expect(s.banner.kind).toBe('error');
  });

  it('fetch a lançar (rede) → também reverte', async () => {
    const fetchMock = vi.fn().mockRejectedValue(new Error('offline'));
    vi.stubGlobal('fetch', fetchMock);

    const store = useWidgetConfigStore.getState();
    store.hydrate(INITIAL);
    store.setWidget('tasks_today', false);
    await vi.advanceTimersByTimeAsync(600);

    expect(useWidgetConfigStore.getState().widgetsEnabled?.tasks_today).toBe(true);
    expect(useWidgetConfigStore.getState().banner.kind).toBe('error');
  });
});

describe('flushNow (DP-5.7.A — adicionar)', () => {
  it('faz PATCH imediato sem esperar o debounce', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true });
    vi.stubGlobal('fetch', fetchMock);

    const store = useWidgetConfigStore.getState();
    store.hydrate(INITIAL);
    store.setWidget('calendar_week', true);
    const ok = await store.flushNow();

    expect(ok).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
