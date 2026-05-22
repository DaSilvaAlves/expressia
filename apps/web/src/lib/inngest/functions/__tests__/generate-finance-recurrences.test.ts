// @vitest-environment node
/**
 * Tests — `generateFinanceRecurrences` Inngest function (Story 4.5 AC7).
 *
 * Mockable-only (D43): zero Inngest Dev Server, zero Postgres real. O handler
 * é extraído via mock de `inngest.createFunction` (pattern Story 3.7
 * `generate-recurring-tasks.test.ts` — `vi.hoisted` shared object).
 *
 * `calcNextRunDate`/`isRecurrenceDue` NÃO são mockados — são funções puras
 * determinísticas, testadas exaustivamente em `finance-recurrence-helpers.test.ts`.
 *
 * Cobertura 10 testes per AC7:
 *   zero recurrences + INSERT + idempotência rerun + next_run_on NULL +
 *   esgotada (inactivate) + active=false skip + DB error + audit failure +
 *   span attrs whitelist + 3 households sequencial.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// ─────────────────────────────────────────────────────────────────────────────
// Mocks partilhados (vi.hoisted — disponíveis antes dos imports)
// ─────────────────────────────────────────────────────────────────────────────

const mocks = vi.hoisted(() => ({
  executeMock: vi.fn<(query: unknown) => Promise<unknown>>(),
  loggerInfoMock: vi.fn(),
  loggerWarnMock: vi.fn(),
  loggerErrorMock: vi.fn(),
  captureExceptionMock: vi.fn(),
  spanSetAttributeMock: vi.fn(),
}));

vi.mock('@/lib/agent/db-shim', () => ({
  getServiceDb: () => ({
    execute: mocks.executeMock,
  }),
}));

vi.mock('@meu-jarvis/observability', () => ({
  childLogger: () => ({
    info: mocks.loggerInfoMock,
    warn: mocks.loggerWarnMock,
    error: mocks.loggerErrorMock,
  }),
  captureException: mocks.captureExceptionMock,
  // `withSpan(name, attrs, fn)` — assinatura real de @meu-jarvis/observability.
  withSpan: vi.fn(async (_name: string, _attrs: unknown, fn: (span: unknown) => Promise<unknown>) =>
    fn({ setAttribute: mocks.spanSetAttributeMock }),
  ),
}));

// `inngest.createFunction` captura config/trigger/handler num objecto partilhado.
const capturedHandlers = vi.hoisted(() => ({
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  handler: null as null | ((args: any) => Promise<unknown>),
  config: null as null | { id: string; name?: string },
  trigger: null as null | { cron?: string },
}));

vi.mock('@/lib/inngest/client', () => ({
  inngest: {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    createFunction: (config: any, trigger: any, handler: any) => {
      capturedHandlers.config = config;
      capturedHandlers.trigger = trigger;
      capturedHandlers.handler = handler;
      return { id: config.id, name: config.name, trigger, handler };
    },
  },
}));

// Import APÓS os mocks para garantir createFunction mockado.
import { generateFinanceRecurrences } from '@/lib/inngest/functions/generate-finance-recurrences';

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

/** `step.run(id, cb)` invoca o callback directamente. */
function makeStepMock() {
  return {
    run: vi.fn(async <T>(_id: string, cb: () => Promise<T>): Promise<T> => cb()),
  };
}

/** Inspecciona uma query Drizzle `sql` template para texto contido. */
function queryText(query: unknown): string {
  return JSON.stringify(query ?? {}).toLowerCase();
}

/** Row de recorrência de Finanças de teste. */
function recurrenceRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'rec-1',
    household_id: 'hh-1',
    created_by_user_id: 'user-1',
    description: 'Renda',
    kind: 'expense',
    amount_cents: 80000,
    currency: 'EUR',
    account_id: 'acc-1',
    card_id: null,
    category_id: 'cat-1',
    payment_method: 'transfer',
    frequency: 'monthly',
    interval: 1,
    custom_rrule: null,
    starts_on: '2026-05-08',
    ends_on: null,
    next_run_on: '2026-05-08',
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('generateFinanceRecurrences', () => {
  it('regista id/name correctos e cron 03:00 UTC diário', () => {
    expect(capturedHandlers.config?.id).toBe('generate-finance-recurrences');
    expect(capturedHandlers.config?.name).toBe('Generate finance recurrences');
    expect(capturedHandlers.trigger?.cron).toBe('0 3 * * *');
    expect(generateFinanceRecurrences).toBeDefined();
  });

  it('(1) zero recurrences activas → counts a zero, zero INSERTs em transactions', async () => {
    mocks.executeMock.mockResolvedValueOnce([]); // SELECT recurrences
    mocks.executeMock.mockResolvedValueOnce([]); // INSERT audit_log

    const result = (await capturedHandlers.handler!({
      step: makeStepMock(),
      runId: 'run-test-1',
    })) as Record<string, number>;

    expect(result).toEqual({
      total_generated: 0,
      total_skipped: 0,
      processed_recurrences: 0,
      inactivated_recurrences: 0,
    });
    const insertTxCalls = mocks.executeMock.mock.calls.filter((c) =>
      queryText(c[0]).includes('insert into transactions'),
    );
    expect(insertTxCalls).toHaveLength(0);
  });

  it('(2) 1 recurrence monthly devida → 1 INSERT em transactions + UPDATE next_run_on', async () => {
    mocks.executeMock.mockResolvedValueOnce([recurrenceRow()]); // SELECT recurrences
    mocks.executeMock.mockResolvedValueOnce([{ id: 'tx-1' }]); // INSERT transactions
    mocks.executeMock.mockResolvedValueOnce([]); // UPDATE recurrences
    mocks.executeMock.mockResolvedValueOnce([]); // INSERT audit_log

    const result = (await capturedHandlers.handler!({
      step: makeStepMock(),
      runId: 'run-test-2',
    })) as Record<string, number>;

    expect(result.processed_recurrences).toBe(1);
    expect(result.total_generated).toBe(1);
    expect(result.total_skipped).toBe(0);
    expect(result.inactivated_recurrences).toBe(0);

    const updateCalls = mocks.executeMock.mock.calls.filter((c) =>
      queryText(c[0]).includes('update recurrences'),
    );
    expect(updateCalls).toHaveLength(1);
    expect(queryText(updateCalls[0]?.[0])).toContain('next_run_on');
  });

  it('(3) idempotência rerun (R-4.5) → ON CONFLICT DO NOTHING → count_skipped=1', async () => {
    mocks.executeMock.mockResolvedValueOnce([recurrenceRow()]); // SELECT recurrences
    mocks.executeMock.mockResolvedValueOnce([]); // INSERT transactions → vazio (conflito)
    mocks.executeMock.mockResolvedValueOnce([]); // UPDATE recurrences
    mocks.executeMock.mockResolvedValueOnce([]); // INSERT audit_log

    const result = (await capturedHandlers.handler!({
      step: makeStepMock(),
      runId: 'run-test-3',
    })) as Record<string, number>;

    expect(result.total_generated).toBe(0);
    expect(result.total_skipped).toBe(1);

    const insertCall = mocks.executeMock.mock.calls.find((c) =>
      queryText(c[0]).includes('insert into transactions'),
    );
    expect(queryText(insertCall?.[0])).toContain('on conflict');
    expect(queryText(insertCall?.[0])).toContain('do nothing');
  });

  it('(4) recurrence com next_run_on NULL → usa starts_on como transaction_date', async () => {
    mocks.executeMock.mockResolvedValueOnce([
      recurrenceRow({ next_run_on: null, starts_on: '2026-05-10' }),
    ]); // SELECT recurrences
    mocks.executeMock.mockResolvedValueOnce([{ id: 'tx-4' }]); // INSERT transactions
    mocks.executeMock.mockResolvedValueOnce([]); // UPDATE recurrences
    mocks.executeMock.mockResolvedValueOnce([]); // INSERT audit_log

    const result = (await capturedHandlers.handler!({
      step: makeStepMock(),
      runId: 'run-test-4',
    })) as Record<string, number>;

    expect(result.total_generated).toBe(1);
    // O INSERT deve ter usado starts_on (2026-05-10) como transaction_date.
    const insertCall = mocks.executeMock.mock.calls.find((c) =>
      queryText(c[0]).includes('insert into transactions'),
    );
    expect(queryText(insertCall?.[0])).toContain('2026-05-10');
  });

  it('(5) recurrence esgotada (endsOn passado) → INSERT + UPDATE active=false', async () => {
    mocks.executeMock.mockResolvedValueOnce([
      recurrenceRow({ next_run_on: '2026-05-08', ends_on: '2026-05-20' }),
    ]); // SELECT recurrences — próxima data (08 Jun) > ends_on (20 Mai) → esgotada
    mocks.executeMock.mockResolvedValueOnce([{ id: 'tx-5' }]); // INSERT transactions
    mocks.executeMock.mockResolvedValueOnce([]); // UPDATE recurrences (inactivate)
    mocks.executeMock.mockResolvedValueOnce([]); // INSERT audit_log

    const result = (await capturedHandlers.handler!({
      step: makeStepMock(),
      runId: 'run-test-5',
    })) as Record<string, number>;

    expect(result.total_generated).toBe(1);
    expect(result.inactivated_recurrences).toBe(1);

    const updateCall = mocks.executeMock.mock.calls.find((c) =>
      queryText(c[0]).includes('update recurrences'),
    );
    expect(queryText(updateCall?.[0])).toContain('active');
  });

  it('(6) recurrence active=false → SELECT filtra → não processada', async () => {
    // O SELECT inclui `where active = true` — uma recorrência inactiva nunca
    // é devolvida pela query. Confirma a cláusula da query.
    mocks.executeMock.mockResolvedValueOnce([]); // SELECT recurrences → vazio
    mocks.executeMock.mockResolvedValueOnce([]); // INSERT audit_log

    const result = (await capturedHandlers.handler!({
      step: makeStepMock(),
      runId: 'run-test-6',
    })) as Record<string, number>;

    expect(result.processed_recurrences).toBe(0);
    const selectCall = mocks.executeMock.mock.calls.find((c) =>
      queryText(c[0]).includes('from recurrences'),
    );
    expect(queryText(selectCall?.[0])).toContain('active = true');
  });

  it('(7) DB error durante SELECT → captureException + re-throw para Inngest retry', async () => {
    const dbError = new Error('Postgres connection refused');
    mocks.executeMock.mockRejectedValueOnce(dbError); // SELECT recurrences falha

    await expect(
      capturedHandlers.handler!({ step: makeStepMock(), runId: 'run-test-7' }),
    ).rejects.toThrow(/Postgres connection refused/);

    expect(mocks.loggerErrorMock).toHaveBeenCalledTimes(1);
    expect(mocks.captureExceptionMock).toHaveBeenCalledTimes(1);
    const captureCall = mocks.captureExceptionMock.mock.calls[0];
    expect(captureCall?.[0]).toBe(dbError);
    expect(captureCall?.[1]).toEqual({ tags: { job: 'generate-finance-recurrences' } });
  });

  it('(8) audit_log INSERT falha → warn não-fatal, handler conclui na mesma', async () => {
    mocks.executeMock.mockResolvedValueOnce([]); // SELECT recurrences → vazio
    mocks.executeMock.mockRejectedValueOnce(new Error('audit_log indisponível')); // audit falha

    const result = (await capturedHandlers.handler!({
      step: makeStepMock(),
      runId: 'run-test-8',
    })) as Record<string, number>;

    expect(result).toEqual({
      total_generated: 0,
      total_skipped: 0,
      processed_recurrences: 0,
      inactivated_recurrences: 0,
    });
    expect(mocks.loggerWarnMock).toHaveBeenCalled();
    const auditWarn = mocks.captureExceptionMock.mock.calls.find((c) => {
      const ctx = c[1] as { tags?: Record<string, unknown> } | undefined;
      return ctx?.tags?.phase === 'audit_log';
    });
    expect(auditWarn).toBeDefined();
  });

  it('(9) span attributes — whitelist sem PII (AC5)', async () => {
    mocks.executeMock.mockResolvedValueOnce([]); // SELECT recurrences
    mocks.executeMock.mockResolvedValueOnce([]); // audit_log

    await capturedHandlers.handler!({ step: makeStepMock(), runId: 'run-test-9' });

    const attrKeys = mocks.spanSetAttributeMock.mock.calls.map((c) => c[0] as string);
    expect(attrKeys).toContain('finance.recurrences.processed_count');
    expect(attrKeys).toContain('finance.recurrences.generated_count');
    expect(attrKeys).toContain('finance.recurrences.skipped_count');
    expect(attrKeys).toContain('finance.recurrences.inactivated_count');
    expect(attrKeys).toContain('finance.cron.duration_ms');
    expect(attrKeys).toContain('inngest.run_id');
    // Zero atributos com PII (description, householdId, recurrence id raw, valores).
    expect(attrKeys).not.toContain('household.id');
    expect(attrKeys).not.toContain('user.id');
    expect(attrKeys.some((k) => k.includes('description'))).toBe(false);
    expect(attrKeys.some((k) => k.includes('amount'))).toBe(false);
  });

  it('(10) 3 recurrences de households diferentes → processadas sequencialmente, counts somados', async () => {
    mocks.executeMock.mockResolvedValueOnce([
      recurrenceRow({ id: 'r1', household_id: 'hh-1' }),
      recurrenceRow({ id: 'r2', household_id: 'hh-2' }),
      recurrenceRow({ id: 'r3', household_id: 'hh-3' }),
    ]); // SELECT recurrences (3)
    // Para cada recurrence: 1 INSERT transactions + 1 UPDATE recurrences.
    for (let rec = 0; rec < 3; rec += 1) {
      mocks.executeMock.mockResolvedValueOnce([{ id: `tx-${rec}` }]); // INSERT
      mocks.executeMock.mockResolvedValueOnce([]); // UPDATE
    }
    mocks.executeMock.mockResolvedValueOnce([]); // audit_log

    const result = (await capturedHandlers.handler!({
      step: makeStepMock(),
      runId: 'run-test-10',
    })) as Record<string, number>;

    expect(result.processed_recurrences).toBe(3);
    expect(result.total_generated).toBe(3);
    expect(result.total_skipped).toBe(0);
  });
});
