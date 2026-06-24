/**
 * Testes — agregação do brief diário (Story J-4 AC4/AC5).
 */
import { buildBriefForHousehold } from '@/lib/brief/build-brief';

import { synthesizeBriefText } from '@/lib/brief/synthesize';
import {
  getAccountsBalance,
  getFinancesMonth,
  getTasksOverdue,
  getTasksToday,
} from '@/lib/visao/queries';

vi.mock('@/lib/visao/queries', () => ({
  getTasksToday: vi.fn(),
  getTasksOverdue: vi.fn(),
  getFinancesMonth: vi.fn(),
  getAccountsBalance: vi.fn(),
}));

vi.mock('@/lib/brief/synthesize', () => ({
  synthesizeBriefText: vi.fn(),
}));

const HOUSEHOLD = '2dedb1ec-dc6f-4445-a5b4-b5f942755655';
const fakeDb = {} as never;

beforeEach(() => {
  vi.mocked(getTasksToday).mockResolvedValue({
    count: 2,
    tasks: [
      { id: '1', title: 'Pagar a renda', status: 'todo', priority: 'high', dueTime: null },
      { id: '2', title: 'Ligar ao notário', status: 'todo', priority: 'medium', dueTime: '10:00' },
    ],
  });
  vi.mocked(getTasksOverdue).mockResolvedValue({
    count: 1,
    tasks: [
      { id: '3', title: 'Entregar IRS', status: 'todo', priority: 'high', dueDate: '2026-06-20', dueTime: null },
    ],
  });
  vi.mocked(getFinancesMonth).mockResolvedValue({
    incomeTotal: 150000,
    expenseTotal: 80000,
    balance: 70000,
    transactionCount: 5,
    currency: 'EUR',
  });
  vi.mocked(getAccountsBalance).mockResolvedValue({
    totalBalanceCents: 250000,
    accountCount: 1,
    currency: 'EUR',
  });
  vi.mocked(synthesizeBriefText).mockResolvedValue({ text: 'BRIEF GERADO', usedFallback: false });
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('buildBriefForHousehold', () => {
  it('chama todas as queries com (db, householdId)', async () => {
    await buildBriefForHousehold(fakeDb, HOUSEHOLD, 'trace-1');
    expect(getTasksToday).toHaveBeenCalledWith(fakeDb, HOUSEHOLD);
    expect(getTasksOverdue).toHaveBeenCalledWith(fakeDb, HOUSEHOLD);
    expect(getFinancesMonth).toHaveBeenCalledWith(fakeDb, HOUSEHOLD);
    expect(getAccountsBalance).toHaveBeenCalledWith(fakeDb, HOUSEHOLD);
  });

  it('monta o BriefData correcto e passa traceId/householdId à síntese', async () => {
    await buildBriefForHousehold(fakeDb, HOUSEHOLD, 'trace-1');
    expect(synthesizeBriefText).toHaveBeenCalledWith(
      {
        tasksTodayCount: 2,
        tasksTodayTitles: ['Pagar a renda', 'Ligar ao notário'],
        tasksOverdueCount: 1,
        tasksOverdueTitles: ['Entregar IRS'],
        financeIncomeCents: 150000,
        financeExpenseCents: 80000,
        financeBalanceCents: 70000,
        accountsBalanceCents: 250000,
      },
      { traceId: 'trace-1', householdId: HOUSEHOLD },
    );
  });

  it('devolve o texto sintetizado + contagens seguras para log', async () => {
    const result = await buildBriefForHousehold(fakeDb, HOUSEHOLD, 'trace-1');
    expect(result).toEqual({
      text: 'BRIEF GERADO',
      usedFallback: false,
      tasksTodayCount: 2,
      tasksOverdueCount: 1,
    });
  });

  it('propaga usedFallback quando a síntese caiu no fallback', async () => {
    vi.mocked(synthesizeBriefText).mockResolvedValue({ text: 'FALLBACK', usedFallback: true });
    const result = await buildBriefForHousehold(fakeDb, HOUSEHOLD, 'trace-1');
    expect(result.usedFallback).toBe(true);
    expect(result.text).toBe('FALLBACK');
  });
});
