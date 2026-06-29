/**
 * Testes — síntese do brief diário (Story J-4 AC6).
 */
import {
  synthesizeBriefText,
  buildFallbackBrief,
  formatEur,
  type BriefData,
} from '@/lib/brief/synthesize';
import type { CalendarEvent } from '@/lib/google/calendar';

import { getProvider } from '@meu-jarvis/agent';

vi.mock('@meu-jarvis/agent', () => ({
  getProvider: vi.fn(),
}));

const BASE_DATA: BriefData = {
  calendar: { status: 'not_connected' },
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

// Instante UTC fixo → 09:30 em Europe/Lisbon (WEST/UTC+1 no verão). Garante
// horas determinísticas independentes do TZ do host.
const EVENT_0930: CalendarEvent = {
  summary: 'Reunião de equipa',
  start: new Date('2026-06-24T08:30:00.000Z'),
  end: new Date('2026-06-24T09:30:00.000Z'),
};
const EVENT_1400: CalendarEvent = {
  summary: 'Almoço com cliente',
  start: new Date('2026-06-24T13:00:00.000Z'),
  end: new Date('2026-06-24T14:00:00.000Z'),
};
// All-day: começa à meia-noite wall-clock de Lisbon (fromZonedTime resolveria
// 2026-06-23T23:00Z no verão WEST). Aqui usamos directamente esse instante.
const EVENT_ALL_DAY: CalendarEvent = {
  summary: 'Feriado municipal',
  start: new Date('2026-06-23T23:00:00.000Z'),
  end: new Date('2026-06-24T23:00:00.000Z'),
};

describe('buildFallbackBrief — agenda (Google Calendar)', () => {
  it('connected com eventos lista hora 24h PT-PT, por ordem', () => {
    const text = buildFallbackBrief({
      ...BASE_DATA,
      calendar: { status: 'connected', events: [EVENT_0930, EVENT_1400] },
    });
    expect(text).toContain('Agenda de hoje:');
    expect(text).toContain('09:30 Reunião de equipa');
    expect(text).toContain('14:00 Almoço com cliente');
    // Agenda antes das tarefas.
    expect(text.indexOf('Agenda de hoje:')).toBeLessThan(text.indexOf('tarefa'));
  });

  it('connected com evento all-day mostra "(todo o dia)"', () => {
    const text = buildFallbackBrief({
      ...BASE_DATA,
      calendar: { status: 'connected', events: [EVENT_ALL_DAY] },
    });
    expect(text).toContain('(todo o dia) Feriado municipal');
  });

  it('connected vazio diz "Sem eventos no calendário hoje"', () => {
    const text = buildFallbackBrief({
      ...BASE_DATA,
      calendar: { status: 'connected', events: [] },
    });
    expect(text).toContain('Sem eventos no calendário hoje.');
  });

  it('unavailable inclui a nota discreta', () => {
    const text = buildFallbackBrief({ ...BASE_DATA, calendar: { status: 'unavailable' } });
    expect(text).toContain('Agenda: não foi possível ler hoje.');
  });

  it('not_connected omite a secção da agenda por completo', () => {
    const text = buildFallbackBrief({ ...BASE_DATA, calendar: { status: 'not_connected' } });
    expect(text).not.toContain('Agenda');
    expect(text).not.toContain('calendário');
  });
});

describe('serializeBriefData (via prompt do LLM) — agenda', () => {
  const opts = { traceId: 'trace-cal', householdId: '00000000-0000-0000-0000-000000000002' };

  /** Captura o `content` da mensagem enviada ao provider (o prompt serializado). */
  async function capturePromptContent(data: BriefData): Promise<string> {
    let captured = '';
    const completeSpy = vi.fn(async (args: { messages: Array<{ content: string }> }) => {
      captured = args.messages[0]?.content ?? '';
      return { content: 'ok' };
    });
    vi.mocked(getProvider).mockReturnValue({
      id: 'openai',
      model: 'gpt-4o-mini',
      complete: completeSpy as never,
    } as never);
    await synthesizeBriefText(data, opts);
    return captured;
  }

  it('connected com eventos serializa lista ordenada com hora 24h', async () => {
    const content = await capturePromptContent({
      ...BASE_DATA,
      calendar: { status: 'connected', events: [EVENT_0930, EVENT_1400] },
    });
    expect(content).toContain('Agenda de hoje:');
    expect(content).toContain('09:30 Reunião de equipa');
    expect(content).toContain('14:00 Almoço com cliente');
    // Agenda surge antes das tarefas no prompt.
    expect(content.indexOf('Agenda de hoje:')).toBeLessThan(content.indexOf('Tarefas de hoje'));
  });

  it('connected vazio serializa "Sem eventos no calendário hoje"', async () => {
    const content = await capturePromptContent({
      ...BASE_DATA,
      calendar: { status: 'connected', events: [] },
    });
    expect(content).toContain('Sem eventos no calendário hoje.');
  });

  it('unavailable serializa a nota discreta', async () => {
    const content = await capturePromptContent({ ...BASE_DATA, calendar: { status: 'unavailable' } });
    expect(content).toContain('Agenda: não foi possível ler hoje.');
  });

  it('not_connected omite qualquer menção a agenda no prompt', async () => {
    const content = await capturePromptContent({ ...BASE_DATA, calendar: { status: 'not_connected' } });
    expect(content).not.toContain('Agenda');
    expect(content).not.toContain('calendário');
    expect(content.startsWith('Tarefas de hoje')).toBe(true);
  });
});

describe('serializeBriefData (via prompt do LLM) — email (Story J-6)', () => {
  const opts = { traceId: 'trace-email', householdId: '00000000-0000-0000-0000-000000000003' };

  async function capturePromptContent(data: BriefData): Promise<string> {
    let captured = '';
    const completeSpy = vi.fn(async (args: { messages: Array<{ content: string }> }) => {
      captured = args.messages[0]?.content ?? '';
      return { content: 'ok' };
    });
    vi.mocked(getProvider).mockReturnValue({
      id: 'openai',
      model: 'gpt-4o-mini',
      complete: completeSpy as never,
    } as never);
    await synthesizeBriefText(data, opts);
    return captured;
  }

  const EMAILS = [
    {
      subject: 'Reunião amanhã',
      from: 'Pedro <pedro@example.com>',
      receivedAt: 'Fri, 27 Jun 2026 10:30:00 +0000',
      snippet: 'Confirmas a reunião?',
    },
    {
      subject: 'Extrato disponível',
      from: 'Banco <noreply@banco.pt>',
      receivedAt: 'Fri, 27 Jun 2026 08:00:00 +0000',
      snippet: 'O teu extrato de junho está pronto.',
    },
  ];

  it('emailSummary preenchido → secção de email serializada no fim, após finanças', async () => {
    const content = await capturePromptContent({ ...BASE_DATA, emailSummary: EMAILS });
    expect(content).toContain('Emails não lidos (2):');
    expect(content).toContain('Pedro <pedro@example.com>: Reunião amanhã');
    expect(content).toContain('Banco <noreply@banco.pt>: Extrato disponível');
    // Email surge depois das finanças (ordem: agenda → tarefas → finanças → email).
    expect(content.indexOf('Finanças do mês')).toBeLessThan(content.indexOf('Emails não lidos'));
  });

  it('emailSummary vazio → secção de email omitida por completo', async () => {
    const content = await capturePromptContent({ ...BASE_DATA, emailSummary: [] });
    expect(content).not.toContain('Emails não lidos');
  });

  it('emailSummary ausente (undefined) → secção de email omitida por completo', async () => {
    const content = await capturePromptContent(BASE_DATA);
    expect(content).not.toContain('Emails não lidos');
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
