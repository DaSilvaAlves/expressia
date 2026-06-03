/**
 * Tests — 7 widget Server Components (Story 5.6 AC4, AC9.b).
 *
 * Cada widget é um `async` RSC que chama uma função de `@/lib/visao/queries`
 * (DP-5.6.A=B). Mockamos essas funções (vi.mock) e o `db-shim`; depois fazemos
 * `await Widget()` e renderizamos o elemento devolvido com Testing Library.
 *
 * Cobre por widget: com dados / sem dados; `tasks_overdue` hidden quando vazio
 * (DP-5.6.E / AC4.b); rodapés correctos (PO-FIX-1 calendar_week → /tarefas/calendario).
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';

import type { CalendarWeekResponse } from '@/lib/api-schemas/visao';

const q = vi.hoisted(() => ({
  getBriefing: vi.fn(),
  getTasksToday: vi.fn(),
  getFinancesMonth: vi.fn(),
  getRecurrencesNext: vi.fn(),
  getTasksOverdue: vi.fn(),
  getAccountsBalance: vi.fn(),
  getCalendarWeek: vi.fn(),
}));

vi.mock('@/lib/agent/db-shim', () => ({
  getDb: () => ({ execute: vi.fn() }),
  // SEC-6 — `withHousehold` executa o callback com o fake db; as funções de
  // `@/lib/visao/queries` estão mockadas, logo o `tx` injectado é irrelevante.
  withHousehold: (_auth: unknown, fn: (tx: unknown) => unknown) => fn({ execute: vi.fn() }),
}));

vi.mock('@meu-jarvis/observability', () => ({
  captureException: vi.fn(),
}));

vi.mock('@/lib/visao/queries', () => ({
  getBriefing: q.getBriefing,
  getTasksToday: q.getTasksToday,
  getFinancesMonth: q.getFinancesMonth,
  getRecurrencesNext: q.getRecurrencesNext,
  getTasksOverdue: q.getTasksOverdue,
  getAccountsBalance: q.getAccountsBalance,
  getCalendarWeek: q.getCalendarWeek,
}));

const { BriefingWidget } = await import('@/app/(app)/visao/_components/widgets/BriefingWidget');
const { TasksTodayWidget } = await import(
  '@/app/(app)/visao/_components/widgets/TasksTodayWidget'
);
const { FinanceMonthWidget } = await import(
  '@/app/(app)/visao/_components/widgets/FinanceMonthWidget'
);
const { RecurrencesNextWidget } = await import(
  '@/app/(app)/visao/_components/widgets/RecurrencesNextWidget'
);
const { TasksOverdueWidget } = await import(
  '@/app/(app)/visao/_components/widgets/TasksOverdueWidget'
);
const { AccountsBalanceWidget } = await import(
  '@/app/(app)/visao/_components/widgets/AccountsBalanceWidget'
);
const { CalendarWeekWidget } = await import(
  '@/app/(app)/visao/_components/widgets/CalendarWeekWidget'
);

beforeEach(() => {
  vi.clearAllMocks();
});

describe('<BriefingWidget>', () => {
  it('mostra a mensagem do stub (available:false)', async () => {
    q.getBriefing.mockReturnValue({
      version: 1,
      available: false,
      message: 'Briefing diário disponível em breve.',
      generatedAt: null,
    });
    render(await BriefingWidget({ householdId: 'hh-test', userId: 'user-test' }));
    expect(screen.getByText('Briefing diário disponível em breve.')).toBeInTheDocument();
  });
});

describe('<TasksTodayWidget>', () => {
  it('com dados — lista tarefas + rodapé /tarefas', async () => {
    q.getTasksToday.mockResolvedValue({
      count: 2,
      tasks: [
        { id: 't1', title: 'Comprar pão', status: 'todo', priority: 'high', dueTime: '09:00:00' },
        { id: 't2', title: 'Ligar médico', status: 'todo', priority: 'low', dueTime: null },
      ],
    });
    render(await TasksTodayWidget({ householdId: 'hh-test', userId: 'user-test' }));
    expect(screen.getByText('Comprar pão')).toBeInTheDocument();
    expect(screen.getByText('09:00')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /ver todas/i })).toHaveAttribute('href', '/tarefas');
  });

  it('sem dados — empty inline "Sem tarefas para hoje."', async () => {
    q.getTasksToday.mockResolvedValue({ count: 0, tasks: [] });
    render(await TasksTodayWidget({ householdId: 'hh-test', userId: 'user-test' }));
    expect(screen.getByText('Sem tarefas para hoje.')).toBeInTheDocument();
  });

  it('mostra "+N mais" quando count > 5', async () => {
    q.getTasksToday.mockResolvedValue({
      count: 8,
      tasks: Array.from({ length: 8 }, (_, i) => ({
        id: `t${i}`,
        title: `Tarefa ${i}`,
        status: 'todo' as const,
        priority: 'medium' as const,
        dueTime: null,
      })),
    });
    render(await TasksTodayWidget({ householdId: 'hh-test', userId: 'user-test' }));
    expect(screen.getByText('+3 mais')).toBeInTheDocument();
  });
});

describe('<FinanceMonthWidget>', () => {
  it('com dados — saldo + entradas/saídas + rodapé /financas/este-mes', async () => {
    q.getFinancesMonth.mockResolvedValue({
      incomeTotal: 250000,
      expenseTotal: 88000,
      balance: 162000,
      transactionCount: 5,
      currency: 'EUR',
    });
    render(await FinanceMonthWidget({ householdId: 'hh-test', userId: 'user-test' }));
    expect(screen.getByText('5 transacções')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /ver mês/i })).toHaveAttribute(
      'href',
      '/financas/este-mes',
    );
  });

  it('sem transacções — empty inline', async () => {
    q.getFinancesMonth.mockResolvedValue({
      incomeTotal: 0,
      expenseTotal: 0,
      balance: 0,
      transactionCount: 0,
      currency: 'EUR',
    });
    render(await FinanceMonthWidget({ householdId: 'hh-test', userId: 'user-test' }));
    expect(screen.getByText('Sem movimentos este mês.')).toBeInTheDocument();
  });
});

describe('<RecurrencesNextWidget>', () => {
  it('com dados — lista + rodapé /financas/recorrentes', async () => {
    q.getRecurrencesNext.mockResolvedValue({
      count: 1,
      recurrences: [
        {
          id: 'r1',
          description: 'Netflix',
          kind: 'expense',
          amountCents: 1599,
          frequency: 'monthly',
          nextRunOn: '2026-04-01',
        },
      ],
    });
    render(await RecurrencesNextWidget({ householdId: 'hh-test', userId: 'user-test' }));
    expect(screen.getByText('Netflix')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /ver recorrências/i })).toHaveAttribute(
      'href',
      '/financas/recorrentes',
    );
  });

  it('sem dados — empty inline', async () => {
    q.getRecurrencesNext.mockResolvedValue({ count: 0, recurrences: [] });
    render(await RecurrencesNextWidget({ householdId: 'hh-test', userId: 'user-test' }));
    expect(screen.getByText('Sem recorrências próximas.')).toBeInTheDocument();
  });
});

describe('<TasksOverdueWidget> (DP-5.6.E hidden se vazio)', () => {
  it('com atrasadas — renderiza card + contador + rodapé /tarefas', async () => {
    q.getTasksOverdue.mockResolvedValue({
      count: 2,
      tasks: [
        {
          id: 'o1',
          title: 'Pagar renda',
          status: 'todo',
          priority: 'high',
          dueDate: '2026-03-01',
          dueTime: null,
        },
      ],
    });
    const result = await TasksOverdueWidget({ householdId: 'hh-test', userId: 'user-test' });
    expect(result).not.toBeNull();
    render(result!);
    expect(screen.getByText('Pagar renda')).toBeInTheDocument();
    expect(screen.getByText('2 tarefas atrasadas')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /ver todas/i })).toHaveAttribute('href', '/tarefas');
  });

  it('count === 0 → não renderiza nada (devolve null)', async () => {
    q.getTasksOverdue.mockResolvedValue({ count: 0, tasks: [] });
    const result = await TasksOverdueWidget({ householdId: 'hh-test', userId: 'user-test' });
    expect(result).toBeNull();
  });

  it('erro de fetch → devolve null (não bloqueia a Visão)', async () => {
    q.getTasksOverdue.mockRejectedValue(new Error('db down'));
    const result = await TasksOverdueWidget({ householdId: 'hh-test', userId: 'user-test' });
    expect(result).toBeNull();
  });
});

describe('<AccountsBalanceWidget>', () => {
  it('com contas — saldo + nº contas + rodapé /financas/patrimonio', async () => {
    q.getAccountsBalance.mockResolvedValue({
      totalBalanceCents: 543210,
      accountCount: 3,
      currency: 'EUR',
    });
    render(await AccountsBalanceWidget({ householdId: 'hh-test', userId: 'user-test' }));
    expect(screen.getByText('3 contas')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /ver contas/i })).toHaveAttribute(
      'href',
      '/financas/patrimonio',
    );
  });

  it('sem contas — empty inline', async () => {
    q.getAccountsBalance.mockResolvedValue({
      totalBalanceCents: 0,
      accountCount: 0,
      currency: 'EUR',
    });
    render(await AccountsBalanceWidget({ householdId: 'hh-test', userId: 'user-test' }));
    expect(screen.getByText('Sem contas registadas.')).toBeInTheDocument();
  });
});

describe('<CalendarWeekWidget> (PO-FIX-1 rodapé)', () => {
  function emptyWeek(): CalendarWeekResponse {
    return {
      days: Array.from({ length: 7 }, (_, i) => ({
        date: `2026-03-${String(14 + i).padStart(2, '0')}`,
        taskCount: 0,
        tasks: [],
      })),
    };
  }

  it('com tarefas — render dos 7 dias + rodapé /tarefas/calendario (PO-FIX-1)', async () => {
    const week = emptyWeek();
    week.days[0] = {
      date: '2026-03-14',
      taskCount: 2,
      tasks: [
        { id: 'c1', title: 'A', priority: 'high', dueTime: null },
        { id: 'c2', title: 'B', priority: 'low', dueTime: null },
      ],
    };
    q.getCalendarWeek.mockResolvedValue(week);
    render(await CalendarWeekWidget({ householdId: 'hh-test', userId: 'user-test' }));
    expect(screen.getByRole('link', { name: /ver calendário/i })).toHaveAttribute(
      'href',
      '/tarefas/calendario',
    );
  });

  it('semana sem tarefas — empty inline', async () => {
    q.getCalendarWeek.mockResolvedValue(emptyWeek());
    render(await CalendarWeekWidget({ householdId: 'hh-test', userId: 'user-test' }));
    expect(screen.getByText('Sem tarefas esta semana.')).toBeInTheDocument();
  });
});
