/**
 * Testes — agregação do brief diário (Story J-4 AC4/AC5 + follow-up agenda J-3).
 */
import { buildBriefForHousehold } from '@/lib/brief/build-brief';

import { synthesizeBriefText } from '@/lib/brief/synthesize';
import { getCalendarEventsToday } from '@/lib/google/calendar';
import { getGmailSummaryForBrief } from '@/lib/google/gmail';
import { refreshAccessToken } from '@/lib/google/oauth';
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

vi.mock('@/lib/google/oauth', () => ({
  refreshAccessToken: vi.fn(),
}));

vi.mock('@/lib/google/calendar', () => ({
  getCalendarEventsToday: vi.fn(),
}));

vi.mock('@/lib/google/gmail', () => ({
  getGmailSummaryForBrief: vi.fn(),
}));

const HOUSEHOLD = '2dedb1ec-dc6f-4445-a5b4-b5f942755655';
const USER = 'df5b403f-0000-4000-8000-000000000000';

/**
 * Extrai o texto SQL literal de um objecto `sql` do drizzle (concatena os
 * `StringChunk.value`) — para o mock discriminar por tabela sem depender da ordem
 * das chamadas (Story M-3: distinguir `jarvis_memories` de `google_oauth_tokens`,
 * que passam a correr em paralelo no mesmo `Promise.all`). Mesmo helper da M-2
 * (`run-agent.test.ts`).
 */
function sqlText(arg: unknown): string {
  const chunks = (arg as { queryChunks?: unknown[] })?.queryChunks;
  if (!Array.isArray(chunks)) return '';
  return chunks
    .map((c) => {
      const value = (c as { value?: unknown })?.value;
      if (Array.isArray(value)) return value.join('');
      return typeof value === 'string' ? value : '';
    })
    .join(' ');
}

/**
 * `db` mock que DISCRIMINA por tabela (nota should-fix do @po, Story M-3): a query
 * de `jarvis_memories` recebe `memoryImpl`; todas as outras (`google_oauth_tokens`
 * — calendar/email) recebem `executeImpl`. Sem discriminação, um mock ingénuo
 * poluiria a leitura de calendar/email com linhas de memória (ou vice-versa),
 * dando um falso-positivo ao AC8. Default de memórias: sem linha.
 */
function makeDb(
  executeImpl: () => Promise<unknown[]>,
  memoryImpl: () => Promise<unknown[]> = async () => [],
) {
  return {
    execute: vi.fn(async (query: unknown) => {
      if (sqlText(query).includes('jarvis_memories')) return memoryImpl();
      return executeImpl();
    }),
  } as never;
}

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
  // Default: sem emails não lidos (Gmail não ligado ou inbox limpa). Os testes
  // de email sobrepõem este mock conforme o cenário.
  vi.mocked(getGmailSummaryForBrief).mockResolvedValue({ emails: [] });
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('buildBriefForHousehold', () => {
  // Sem linha em google_oauth_tokens → agenda not_connected (caso base).
  const noToken = () => makeDb(async () => []);

  it('chama todas as queries com (db, householdId)', async () => {
    const db = noToken();
    await buildBriefForHousehold(db, HOUSEHOLD, USER, 'trace-1');
    expect(getTasksToday).toHaveBeenCalledWith(db, HOUSEHOLD);
    expect(getTasksOverdue).toHaveBeenCalledWith(db, HOUSEHOLD);
    expect(getFinancesMonth).toHaveBeenCalledWith(db, HOUSEHOLD);
    expect(getAccountsBalance).toHaveBeenCalledWith(db, HOUSEHOLD);
  });

  it('monta o BriefData (com calendar) e passa traceId/householdId à síntese', async () => {
    await buildBriefForHousehold(noToken(), HOUSEHOLD, USER, 'trace-1');
    expect(synthesizeBriefText).toHaveBeenCalledWith(
      {
        calendar: { status: 'not_connected' },
        tasksTodayCount: 2,
        tasksTodayTitles: ['Pagar a renda', 'Ligar ao notário'],
        tasksOverdueCount: 1,
        tasksOverdueTitles: ['Entregar IRS'],
        financeIncomeCents: 150000,
        financeExpenseCents: 80000,
        financeBalanceCents: 70000,
        accountsBalanceCents: 250000,
        emailSummary: [],
        memories: [],
      },
      { traceId: 'trace-1', householdId: HOUSEHOLD },
    );
  });

  it('devolve o texto sintetizado + contagens seguras para log', async () => {
    const result = await buildBriefForHousehold(noToken(), HOUSEHOLD, USER, 'trace-1');
    expect(result).toEqual({
      text: 'BRIEF GERADO',
      usedFallback: false,
      tasksTodayCount: 2,
      tasksOverdueCount: 1,
      calendarEventCount: null,
      emailCount: 0,
    });
  });

  it('propaga usedFallback quando a síntese caiu no fallback', async () => {
    vi.mocked(synthesizeBriefText).mockResolvedValue({ text: 'FALLBACK', usedFallback: true });
    const result = await buildBriefForHousehold(noToken(), HOUSEHOLD, USER, 'trace-1');
    expect(result.usedFallback).toBe(true);
    expect(result.text).toBe('FALLBACK');
  });
});

describe('resolveCalendarSection (via buildBriefForHousehold)', () => {
  const tokenRow = {
    encrypted_refresh_token: 'ciphertext',
    token_iv: 'iv',
    token_auth_tag: 'tag',
  };

  it('not_connected quando não há linha de token (refresh não é chamado)', async () => {
    const db = makeDb(async () => []);
    const result = await buildBriefForHousehold(db, HOUSEHOLD, USER, 'trace-1');
    expect(result.calendarEventCount).toBeNull();
    expect(refreshAccessToken).not.toHaveBeenCalled();
    expect(getCalendarEventsToday).not.toHaveBeenCalled();
    // calendar passado à síntese é not_connected.
    const dataArg = vi.mocked(synthesizeBriefText).mock.calls[0]?.[0];
    expect(dataArg?.calendar).toEqual({ status: 'not_connected' });
  });

  it('connected quando há token e getCalendarEventsToday devolve eventos', async () => {
    const db = makeDb(async () => [tokenRow]);
    vi.mocked(refreshAccessToken).mockResolvedValue({
      accessToken: 'access-xyz',
      expiry: new Date('2026-06-24T12:00:00.000Z'),
    });
    const events = [
      { summary: 'Reunião', start: new Date('2026-06-24T08:30:00Z'), end: new Date('2026-06-24T09:30:00Z') },
    ];
    vi.mocked(getCalendarEventsToday).mockResolvedValue(events);

    const result = await buildBriefForHousehold(db, HOUSEHOLD, USER, 'trace-1');

    expect(refreshAccessToken).toHaveBeenCalledWith('ciphertext', 'iv', 'tag');
    expect(getCalendarEventsToday).toHaveBeenCalledWith('access-xyz');
    expect(result.calendarEventCount).toBe(1);
    const dataArg = vi.mocked(synthesizeBriefText).mock.calls[0]?.[0];
    expect(dataArg?.calendar).toEqual({ status: 'connected', events });
  });

  it('connected com lista vazia quando não há eventos hoje (count 0, não null)', async () => {
    const db = makeDb(async () => [tokenRow]);
    vi.mocked(refreshAccessToken).mockResolvedValue({
      accessToken: 'access-xyz',
      expiry: new Date('2026-06-24T12:00:00.000Z'),
    });
    vi.mocked(getCalendarEventsToday).mockResolvedValue([]);

    const result = await buildBriefForHousehold(db, HOUSEHOLD, USER, 'trace-1');
    expect(result.calendarEventCount).toBe(0);
    const dataArg = vi.mocked(synthesizeBriefText).mock.calls[0]?.[0];
    expect(dataArg?.calendar).toEqual({ status: 'connected', events: [] });
  });

  it('unavailable quando refreshAccessToken lança', async () => {
    const db = makeDb(async () => [tokenRow]);
    vi.mocked(refreshAccessToken).mockRejectedValue(new Error('refresh revogado'));

    const result = await buildBriefForHousehold(db, HOUSEHOLD, USER, 'trace-1');
    expect(result.calendarEventCount).toBeNull();
    expect(getCalendarEventsToday).not.toHaveBeenCalled();
    const dataArg = vi.mocked(synthesizeBriefText).mock.calls[0]?.[0];
    expect(dataArg?.calendar).toEqual({ status: 'unavailable' });
  });

  it('unavailable quando getCalendarEventsToday devolve null', async () => {
    const db = makeDb(async () => [tokenRow]);
    vi.mocked(refreshAccessToken).mockResolvedValue({
      accessToken: 'access-xyz',
      expiry: new Date('2026-06-24T12:00:00.000Z'),
    });
    vi.mocked(getCalendarEventsToday).mockResolvedValue(null);

    const result = await buildBriefForHousehold(db, HOUSEHOLD, USER, 'trace-1');
    expect(result.calendarEventCount).toBeNull();
    const dataArg = vi.mocked(synthesizeBriefText).mock.calls[0]?.[0];
    expect(dataArg?.calendar).toEqual({ status: 'unavailable' });
  });

  it('unavailable quando a leitura do token (db.execute) lança — agenda nunca derruba o brief', async () => {
    const db = makeDb(async () => {
      throw new Error('db falhou');
    });
    const result = await buildBriefForHousehold(db, HOUSEHOLD, USER, 'trace-1');
    expect(result.calendarEventCount).toBeNull();
    expect(result.text).toBe('BRIEF GERADO'); // brief continua
    const dataArg = vi.mocked(synthesizeBriefText).mock.calls[0]?.[0];
    expect(dataArg?.calendar).toEqual({ status: 'unavailable' });
  });
});

describe('resolveEmailSection (via buildBriefForHousehold) — Story J-6', () => {
  const tokenRow = {
    encrypted_refresh_token: 'ciphertext',
    token_iv: 'iv',
    token_auth_tag: 'tag',
  };
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

  it('emails não lidos → emailSummary passado à síntese + emailCount na contagem', async () => {
    const db = makeDb(async () => [tokenRow]);
    vi.mocked(getGmailSummaryForBrief).mockResolvedValue({ emails: EMAILS });

    const result = await buildBriefForHousehold(db, HOUSEHOLD, USER, 'trace-1');

    expect(getGmailSummaryForBrief).toHaveBeenCalledWith({
      encryptedRefreshToken: 'ciphertext',
      tokenIv: 'iv',
      tokenAuthTag: 'tag',
    });
    expect(result.emailCount).toBe(2);
    const dataArg = vi.mocked(synthesizeBriefText).mock.calls[0]?.[0];
    expect(dataArg?.emailSummary).toEqual(EMAILS);
  });

  it('sem token → email omitido (emailSummary [], getGmailSummaryForBrief não chamado)', async () => {
    const db = makeDb(async () => []);
    const result = await buildBriefForHousehold(db, HOUSEHOLD, USER, 'trace-1');

    expect(getGmailSummaryForBrief).not.toHaveBeenCalled();
    expect(result.emailCount).toBe(0);
    const dataArg = vi.mocked(synthesizeBriefText).mock.calls[0]?.[0];
    expect(dataArg?.emailSummary).toEqual([]);
  });

  it('erro do Gmail → emailSummary [] graciosamente, o brief continua', async () => {
    const db = makeDb(async () => [tokenRow]);
    vi.mocked(getGmailSummaryForBrief).mockResolvedValue({
      emails: [],
      error: 'Gmail API recusou listar emails (HTTP 401).',
    });

    const result = await buildBriefForHousehold(db, HOUSEHOLD, USER, 'trace-1');

    expect(result.emailCount).toBe(0);
    expect(result.text).toBe('BRIEF GERADO'); // brief nunca derruba por causa do email
    const dataArg = vi.mocked(synthesizeBriefText).mock.calls[0]?.[0];
    expect(dataArg?.emailSummary).toEqual([]);
  });
});

describe('resolveMemoriesSection (via buildBriefForHousehold) — Story M-3', () => {
  /** A linha da query `jarvis_memories` (mock discrimina por SQL — nota @po). */
  function memoryQuery(db: { execute: ReturnType<typeof vi.fn> }): unknown {
    return db.execute.mock.calls.find((c) => sqlText(c[0]).includes('jarvis_memories'))?.[0];
  }

  it('memórias presentes → BriefData.memories populado; query usa jarvis_memories + LIMIT 50', async () => {
    // executeImpl (google_oauth_tokens) sem linha; memoryImpl devolve 2 memórias.
    const db = makeDb(
      async () => [],
      async () => [{ content: 'odeio reuniões antes das 10h' }, { content: 'prefiro café sem açúcar' }],
    ) as unknown as { execute: ReturnType<typeof vi.fn> };

    await buildBriefForHousehold(db as never, HOUSEHOLD, USER, 'trace-1');

    const dataArg = vi.mocked(synthesizeBriefText).mock.calls[0]?.[0];
    expect(dataArg?.memories).toEqual(['odeio reuniões antes das 10h', 'prefiro café sem açúcar']);

    // A query correcta foi emitida (household-scoped, cap 50) — sem falso-positivo.
    const query = sqlText(memoryQuery(db));
    expect(query).toContain('jarvis_memories');
    expect(query).toContain('limit 50');
  });

  it('sem memórias → BriefData.memories vazio (secção omitida a jusante)', async () => {
    const db = makeDb(async () => []); // memoryImpl default → []
    const result = await buildBriefForHousehold(db, HOUSEHOLD, USER, 'trace-1');

    expect(result.text).toBe('BRIEF GERADO');
    const dataArg = vi.mocked(synthesizeBriefText).mock.calls[0]?.[0];
    expect(dataArg?.memories).toEqual([]);
  });

  it('erro na leitura de memórias → memories [] graciosamente, o brief continua', async () => {
    const db = makeDb(
      async () => [], // tokens OK (sem linha)
      async () => {
        throw new Error('db falhou a ler jarvis_memories');
      },
    );

    const result = await buildBriefForHousehold(db, HOUSEHOLD, USER, 'trace-1');

    expect(result.text).toBe('BRIEF GERADO'); // memória nunca derruba o brief
    const dataArg = vi.mocked(synthesizeBriefText).mock.calls[0]?.[0];
    expect(dataArg?.memories).toEqual([]);
  });
});
