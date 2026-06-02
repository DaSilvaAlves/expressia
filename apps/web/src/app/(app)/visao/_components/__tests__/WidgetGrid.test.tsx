/**
 * Tests — `<WidgetGrid>` (Story 5.6 AC3, AC6, AC8, AC9).
 *
 * Cobre: render só dos widgets enabled; ordem canónica; todos 7 ON; classes de
 * grid responsivo (AC8); mobile order-first em `tasks_today` (DP-5.6.F).
 *
 * Os 7 widgets são mockados para componentes síncronos que renderizam um marker
 * (não fazem fetch) — o foco é a estrutura/ordem do grid, não os dados (testados
 * separadamente em widgets.test.tsx).
 */
import { describe, expect, it, vi } from 'vitest';
import { render } from '@testing-library/react';

import type { WidgetsEnabled } from '@meu-jarvis/db';

vi.mock('@/app/(app)/visao/_components/widgets/BriefingWidget', () => ({
  BriefingWidget: () => <div>WIDGET:briefing</div>,
}));
vi.mock('@/app/(app)/visao/_components/widgets/TasksTodayWidget', () => ({
  TasksTodayWidget: () => <div>WIDGET:tasks_today</div>,
}));
vi.mock('@/app/(app)/visao/_components/widgets/FinanceMonthWidget', () => ({
  FinanceMonthWidget: () => <div>WIDGET:finance_month</div>,
}));
vi.mock('@/app/(app)/visao/_components/widgets/RecurrencesNextWidget', () => ({
  RecurrencesNextWidget: () => <div>WIDGET:recurrences_next</div>,
}));
vi.mock('@/app/(app)/visao/_components/widgets/TasksOverdueWidget', () => ({
  TasksOverdueWidget: () => <div>WIDGET:tasks_overdue</div>,
}));
vi.mock('@/app/(app)/visao/_components/widgets/AccountsBalanceWidget', () => ({
  AccountsBalanceWidget: () => <div>WIDGET:accounts_balance</div>,
}));
vi.mock('@/app/(app)/visao/_components/widgets/CalendarWeekWidget', () => ({
  CalendarWeekWidget: () => <div>WIDGET:calendar_week</div>,
}));

const { WidgetGrid } = await import('@/app/(app)/visao/_components/WidgetGrid');

const ALL_ON: WidgetsEnabled = {
  briefing: true,
  tasks_today: true,
  finance_month: true,
  recurrences_next: true,
  tasks_overdue: true,
  accounts_balance: true,
  calendar_week: true,
};

const DEFAULTS: WidgetsEnabled = {
  briefing: true,
  tasks_today: true,
  finance_month: true,
  recurrences_next: true,
  tasks_overdue: true,
  accounts_balance: false,
  calendar_week: false,
};

function renderedWidgetOrder(container: HTMLElement): string[] {
  return Array.from(container.querySelectorAll('[data-widget]')).map(
    (el) => el.getAttribute('data-widget') ?? '',
  );
}

describe('<WidgetGrid>', () => {
  it('renderiza apenas os widgets enabled (5 default-ON, sem accounts/calendar)', () => {
    const { container } = render(<WidgetGrid widgetsEnabled={DEFAULTS} householdId="hh-test" />);
    const ids = renderedWidgetOrder(container);
    expect(ids).toEqual([
      'briefing',
      'tasks_today',
      'finance_month',
      'recurrences_next',
      'tasks_overdue',
    ]);
    expect(ids).not.toContain('accounts_balance');
    expect(ids).not.toContain('calendar_week');
  });

  it('renderiza os 7 widgets na ordem canónica quando todos ON', () => {
    const { container } = render(<WidgetGrid widgetsEnabled={ALL_ON} householdId="hh-test" />);
    expect(renderedWidgetOrder(container)).toEqual([
      'briefing',
      'tasks_today',
      'finance_month',
      'recurrences_next',
      'tasks_overdue',
      'accounts_balance',
      'calendar_week',
    ]);
  });

  it('aplica as classes de grid responsivo (AC8.a)', () => {
    const { getByTestId } = render(<WidgetGrid widgetsEnabled={DEFAULTS} householdId="hh-test" />);
    const grid = getByTestId('widget-grid');
    expect(grid.className).toContain('grid-cols-1');
    expect(grid.className).toContain('md:grid-cols-2');
    expect(grid.className).toContain('lg:grid-cols-3');
  });

  it('DP-5.6.F — tasks_today recebe order-first md:order-none (mobile primeiro)', () => {
    const { container } = render(<WidgetGrid widgetsEnabled={DEFAULTS} householdId="hh-test" />);
    const tasksToday = container.querySelector('[data-widget="tasks_today"]');
    expect(tasksToday?.className).toContain('order-first');
    expect(tasksToday?.className).toContain('md:order-none');
    // Os outros NÃO têm order-first.
    const briefing = container.querySelector('[data-widget="briefing"]');
    expect(briefing?.className ?? '').not.toContain('order-first');
  });

  it('nenhum widget ON → grid vazio (sem itens)', () => {
    const NONE: WidgetsEnabled = {
      briefing: false,
      tasks_today: false,
      finance_month: false,
      recurrences_next: false,
      tasks_overdue: false,
      accounts_balance: false,
      calendar_week: false,
    };
    const { container } = render(<WidgetGrid widgetsEnabled={NONE} householdId="hh-test" />);
    expect(renderedWidgetOrder(container)).toEqual([]);
  });
});
