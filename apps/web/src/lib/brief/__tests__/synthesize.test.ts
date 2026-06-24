/**
 * Testes — síntese do brief diário (Story J-4 AC6).
 */
import {
  synthesizeBriefText,
  buildFallbackBrief,
  formatEur,
  type BriefData,
} from '@/lib/brief/synthesize';

import { getProvider } from '@meu-jarvis/agent';

vi.mock('@meu-jarvis/agent', () => ({
  getProvider: vi.fn(),
}));

const BASE_DATA: BriefData = {
  tasksTodayCount: 2,
  tasksTodayTitles: ['Pagar a renda', 'Ligar ao notário'],
  tasksOverdueCount: 1,
  tasksOverdueTitles: ['Entregar IRS'],
  financeIncomeCents: 150000,
  financeExpenseCents: 80000,
  financeBalanceCents: 70000,
  accountsBalanceCents: 250000,
};

function mockProviderComplete(impl: () => Promise<{ content: string | null }>) {
  vi.mocked(getProvider).mockReturnValue({
    id: 'openai',
    model: 'gpt-4o-mini',
    complete: vi.fn(impl) as never,
  } as never);
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('formatEur', () => {
  it('formata cêntimos em EUR PT-PT (vírgula decimal)', () => {
    expect(formatEur(888)).toContain('8,88');
    expect(formatEur(888)).toContain('€');
    expect(formatEur(0)).toContain('0,00');
    // Separador de milhares varia com o ICU (ponto, espaço ou nenhum) — validamos
    // apenas a parte decimal com vírgula + símbolo, que são invariantes PT-PT.
    expect(formatEur(123456)).toContain('234,56');
    expect(formatEur(123456)).toContain('€');
  });
});

describe('buildFallbackBrief', () => {
  it('é determinístico, PT-PT, e cobre tarefas + finanças', () => {
    const text = buildFallbackBrief(BASE_DATA);
    expect(text).toContain('Bom dia');
    expect(text).toContain('2 tarefas para hoje');
    expect(text).toContain('1 tarefa atrasada');
    expect(text).toContain('800,00'); // expense 80000 cêntimos → 800,00 €
    expect(text).toContain('€');
  });

  it('trata zero tarefas no singular/plural correctamente', () => {
    const text = buildFallbackBrief({
      ...BASE_DATA,
      tasksTodayCount: 0,
      tasksTodayTitles: [],
      tasksOverdueCount: 0,
      tasksOverdueTitles: [],
    });
    expect(text).toContain('Não tens tarefas marcadas para hoje');
    expect(text).not.toContain('atrasada');
  });

  it('usa singular para 1 tarefa de hoje', () => {
    const text = buildFallbackBrief({ ...BASE_DATA, tasksTodayCount: 1, tasksOverdueCount: 0 });
    expect(text).toContain('Tens 1 tarefa para hoje');
  });
});

describe('synthesizeBriefText', () => {
  const opts = { traceId: 'trace-1', householdId: '00000000-0000-0000-0000-000000000001' };

  it('devolve o texto do LLM quando há content', async () => {
    mockProviderComplete(async () => ({ content: '  Bom dia! Tens 2 tarefas.  ' }));
    const result = await synthesizeBriefText(BASE_DATA, opts);
    expect(result.usedFallback).toBe(false);
    expect(result.text).toBe('Bom dia! Tens 2 tarefas.'); // trimmed
  });

  it('recorre ao fallback quando o LLM devolve content vazio', async () => {
    mockProviderComplete(async () => ({ content: '   ' }));
    const result = await synthesizeBriefText(BASE_DATA, opts);
    expect(result.usedFallback).toBe(true);
    expect(result.text).toContain('Bom dia');
  });

  it('recorre ao fallback quando o LLM devolve content null', async () => {
    mockProviderComplete(async () => ({ content: null }));
    const result = await synthesizeBriefText(BASE_DATA, opts);
    expect(result.usedFallback).toBe(true);
  });

  it('recorre ao fallback quando o provider lança (ex.: sem créditos)', async () => {
    mockProviderComplete(async () => {
      throw new Error('Provider error: credit balance too low');
    });
    const result = await synthesizeBriefText(BASE_DATA, opts);
    expect(result.usedFallback).toBe(true);
    expect(result.text).toContain('Bom dia');
  });
});
