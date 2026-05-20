// @vitest-environment node
/**
 * Tests — `generateRecurringTasks` Inngest function (Story 3.7 AC9).
 *
 * Mockable-only (D43): zero Inngest Dev Server, zero Postgres real. O handler
 * é extraído via mock de `inngest.createFunction` (pattern Story 2.8
 * `cleanup-expired-reverse-ops.test.ts:17-59` — `vi.hoisted` shared object).
 *
 * Cobertura ≥10 testes per AC9:
 *   zero recurrences + daily 90d + idempotency rerun + endsOn passed +
 *   template apagada + DB error + audit failure não-fatal + span attrs +
 *   3 recurrences sequencial + next_run_on NULL.
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
  expandRecurrenceMock: vi.fn(),
}));

/**
 * Constrói um `ExpandResult` com N ocorrências consecutivas — usado para
 * controlar deterministicamente o número de INSERTs nos tests do handler
 * (a expansão RRULE real é testada exaustivamente em `rrule-helpers.test.ts`).
 */
function expandWith(occurrenceCount: number, isExhausted = false) {
  return {
    occurrences: Array.from({ length: occurrenceCount }, (_, i) => ({
      targetDate: `2026-06-${String(i + 1).padStart(2, '0')}`,
    })),
    nextRunAfterHorizon: isExhausted ? null : '2026-09-01',
    isExhausted,
  };
}

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

// `expandRecurrence` é mockada para controlar o nº de ocorrências de forma
// determinística — a lógica RRULE/DST real é coberta em `rrule-helpers.test.ts`.
vi.mock('@/lib/recurrences/rrule-helpers', async (importOriginal) => {
  const actual = (await importOriginal()) as Record<string, unknown>;
  return {
    ...actual,
    expandRecurrence: mocks.expandRecurrenceMock,
  };
});

// Import APÓS os mocks para garantir createFunction mockado.
import { generateRecurringTasks } from '@/lib/inngest/functions/generate-recurring-tasks';

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

/** Row de recorrência de teste. */
function recurrenceRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'rec-1',
    household_id: 'hh-1',
    template_task_id: 'task-tmpl-1',
    frequency: 'daily',
    interval: 1,
    custom_rrule: null,
    starts_on: '2026-05-20',
    ends_on: null,
    next_run_on: null,
    ...overrides,
  };
}

/** Row de task template de teste. */
function templateRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'task-tmpl-1',
    created_by_user_id: 'user-1',
    title: 'Pagar renda',
    description: 'Renda mensal',
    due_time: null,
    priority: 'medium',
    project: null,
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  // Default: cada recorrência expande para 4 ocorrências, não esgotada.
  mocks.expandRecurrenceMock.mockReturnValue(expandWith(4));
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('generateRecurringTasks', () => {
  it('regista id/name correctos e cron 03:00 UTC diário', () => {
    expect(capturedHandlers.config?.id).toBe('generate-recurring-tasks');
    expect(capturedHandlers.config?.name).toBe('Generate recurring tasks');
    expect(capturedHandlers.trigger?.cron).toBe('0 3 * * *');
    expect(generateRecurringTasks).toBeDefined();
  });

  it('(1) zero recurrences activas → handler retorna counts a zero, zero INSERTs em tasks', async () => {
    // 1ª query: SELECT recurrences → vazio. 2ª query: audit_log INSERT.
    mocks.executeMock.mockResolvedValueOnce([]); // SELECT task_recurrences
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
    // Nenhum INSERT em tasks.
    const insertTaskCalls = mocks.executeMock.mock.calls.filter((c) =>
      queryText(c[0]).includes('insert into tasks'),
    );
    expect(insertTaskCalls).toHaveLength(0);
  });

  it('(2) 1 recurrence devida → INSERTs em tasks + UPDATE next_run_on', async () => {
    mocks.expandRecurrenceMock.mockReturnValueOnce(expandWith(91));
    mocks.executeMock.mockResolvedValueOnce([recurrenceRow()]); // SELECT recurrences
    mocks.executeMock.mockResolvedValueOnce([templateRow()]); // SELECT template
    // 91 INSERTs — cada um retorna 1 id (geração bem sucedida).
    for (let i = 0; i < 91; i += 1) {
      mocks.executeMock.mockResolvedValueOnce([{ id: `gen-${i}` }]);
    }
    mocks.executeMock.mockResolvedValueOnce([]); // UPDATE task_recurrences
    mocks.executeMock.mockResolvedValueOnce([]); // INSERT audit_log

    const result = (await capturedHandlers.handler!({
      step: makeStepMock(),
      runId: 'run-test-2',
    })) as Record<string, number>;

    expect(result.processed_recurrences).toBe(1);
    expect(result.total_generated).toBe(91);
    expect(result.total_skipped).toBe(0);
    expect(result.inactivated_recurrences).toBe(0);

    const updateCalls = mocks.executeMock.mock.calls.filter((c) =>
      queryText(c[0]).includes('update task_recurrences'),
    );
    expect(updateCalls).toHaveLength(1);
    expect(queryText(updateCalls[0]?.[0])).toContain('next_run_on');
  });

  it('(3) idempotency rerun (R-3.7.1) → ON CONFLICT DO NOTHING, count_skipped alto', async () => {
    mocks.expandRecurrenceMock.mockReturnValueOnce(expandWith(91));
    mocks.executeMock.mockResolvedValueOnce([recurrenceRow()]); // SELECT recurrences
    mocks.executeMock.mockResolvedValueOnce([templateRow()]); // SELECT template
    // Rerun: todos os INSERTs colidem → retornam array vazio (DO NOTHING).
    for (let i = 0; i < 91; i += 1) {
      mocks.executeMock.mockResolvedValueOnce([]);
    }
    mocks.executeMock.mockResolvedValueOnce([]); // UPDATE
    mocks.executeMock.mockResolvedValueOnce([]); // audit_log

    const result = (await capturedHandlers.handler!({
      step: makeStepMock(),
      runId: 'run-test-3',
    })) as Record<string, number>;

    expect(result.total_generated).toBe(0);
    expect(result.total_skipped).toBe(91);

    // Confirma que o INSERT usa ON CONFLICT DO NOTHING.
    const insertCall = mocks.executeMock.mock.calls.find((c) =>
      queryText(c[0]).includes('insert into tasks'),
    );
    expect(queryText(insertCall?.[0])).toContain('on conflict');
    expect(queryText(insertCall?.[0])).toContain('do nothing');
  });

  it('(4) recurrence esgotada (endsOn no passado) → UPDATE active=false + zero tasks geradas', async () => {
    mocks.expandRecurrenceMock.mockReturnValueOnce(expandWith(0, true));
    mocks.executeMock.mockResolvedValueOnce([
      recurrenceRow({ starts_on: '2025-01-01', ends_on: '2025-12-31' }),
    ]); // SELECT recurrences
    mocks.executeMock.mockResolvedValueOnce([templateRow()]); // SELECT template
    mocks.executeMock.mockResolvedValueOnce([]); // UPDATE task_recurrences (inactivate)
    mocks.executeMock.mockResolvedValueOnce([]); // INSERT audit_log

    const result = (await capturedHandlers.handler!({
      step: makeStepMock(),
      runId: 'run-test-4',
    })) as Record<string, number>;

    expect(result.total_generated).toBe(0);
    expect(result.inactivated_recurrences).toBe(1);

    const updateCall = mocks.executeMock.mock.calls.find((c) =>
      queryText(c[0]).includes('update task_recurrences'),
    );
    expect(queryText(updateCall?.[0])).toContain('active');
  });

  it('(5) template task apagada → skip + warn log + continua restantes', async () => {
    mocks.expandRecurrenceMock.mockReturnValue(expandWith(4)); // só usada para rec-b
    mocks.executeMock.mockResolvedValueOnce([
      recurrenceRow({ id: 'rec-a' }),
      recurrenceRow({ id: 'rec-b', template_task_id: 'task-tmpl-2' }),
    ]); // SELECT recurrences (2)
    mocks.executeMock.mockResolvedValueOnce([]); // SELECT template rec-a → vazio (apagada)
    mocks.executeMock.mockResolvedValueOnce([templateRow({ id: 'task-tmpl-2' })]); // template rec-b
    for (let i = 0; i < 4; i += 1) {
      mocks.executeMock.mockResolvedValueOnce([{ id: `g-${i}` }]); // INSERTs rec-b
    }
    mocks.executeMock.mockResolvedValueOnce([]); // UPDATE rec-b
    mocks.executeMock.mockResolvedValueOnce([]); // audit_log

    const result = (await capturedHandlers.handler!({
      step: makeStepMock(),
      runId: 'run-test-5',
    })) as Record<string, number>;

    expect(result.processed_recurrences).toBe(2);
    expect(result.total_generated).toBe(4); // só rec-b gerou
    expect(mocks.loggerWarnMock).toHaveBeenCalled();
    const warnArg = mocks.loggerWarnMock.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(warnArg?.recurrence_id).toBe('rec-a');
  });

  it('(6) DB error durante SELECT → captureException + re-throw para Inngest retry', async () => {
    const dbError = new Error('Postgres connection refused');
    mocks.executeMock.mockRejectedValueOnce(dbError); // SELECT recurrences falha

    await expect(
      capturedHandlers.handler!({ step: makeStepMock(), runId: 'run-test-6' }),
    ).rejects.toThrow(/Postgres connection refused/);

    expect(mocks.loggerErrorMock).toHaveBeenCalledTimes(1);
    expect(mocks.captureExceptionMock).toHaveBeenCalledTimes(1);
    const captureCall = mocks.captureExceptionMock.mock.calls[0];
    expect(captureCall?.[0]).toBe(dbError);
    expect(captureCall?.[1]).toEqual({ tags: { job: 'generate-recurring-tasks' } });
  });

  it('(7) audit_log INSERT falha → warn não-fatal, handler conclui na mesma', async () => {
    mocks.executeMock.mockResolvedValueOnce([]); // SELECT recurrences → vazio
    mocks.executeMock.mockRejectedValueOnce(new Error('audit_log indisponível')); // audit INSERT falha

    const result = (await capturedHandlers.handler!({
      step: makeStepMock(),
      runId: 'run-test-7',
    })) as Record<string, number>;

    // O return statement ainda é alcançado (audit falha não aborta).
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

  it('(8) span attributes — whitelist sem PII (AC7)', async () => {
    mocks.executeMock.mockResolvedValueOnce([]); // SELECT recurrences
    mocks.executeMock.mockResolvedValueOnce([]); // audit_log

    await capturedHandlers.handler!({ step: makeStepMock(), runId: 'run-test-8' });

    const attrKeys = mocks.spanSetAttributeMock.mock.calls.map((c) => c[0] as string);
    expect(attrKeys).toContain('recurrences.processed_count');
    expect(attrKeys).toContain('recurrences.generated_count');
    expect(attrKeys).toContain('recurrences.skipped_count');
    expect(attrKeys).toContain('recurrences.inactivated_count');
    expect(attrKeys).toContain('recurrences.horizon_days');
    expect(attrKeys).toContain('recurrences.duration_ms');
    expect(attrKeys).toContain('inngest.run_id');
    // Zero atributos com PII (householdId, title, userId, recurrence id raw).
    expect(attrKeys).not.toContain('household.id');
    expect(attrKeys).not.toContain('user.id');
    expect(attrKeys.some((k) => k.includes('title'))).toBe(false);
  });

  it('(9) 3 recurrences de households diferentes → processadas sequencialmente, counts somados', async () => {
    mocks.expandRecurrenceMock.mockReturnValue(expandWith(4)); // 4 ocorrências cada
    mocks.executeMock.mockResolvedValueOnce([
      recurrenceRow({ id: 'r1', household_id: 'hh-1', frequency: 'monthly' }),
      recurrenceRow({ id: 'r2', household_id: 'hh-2', frequency: 'monthly' }),
      recurrenceRow({ id: 'r3', household_id: 'hh-3', frequency: 'monthly' }),
    ]); // SELECT recurrences (3)
    // Para cada recurrence: SELECT template + 4 INSERTs + UPDATE.
    for (let rec = 0; rec < 3; rec += 1) {
      mocks.executeMock.mockResolvedValueOnce([templateRow()]); // template
      for (let i = 0; i < 4; i += 1) {
        mocks.executeMock.mockResolvedValueOnce([{ id: `r${rec}-g${i}` }]); // INSERT
      }
      mocks.executeMock.mockResolvedValueOnce([]); // UPDATE
    }
    mocks.executeMock.mockResolvedValueOnce([]); // audit_log

    const result = (await capturedHandlers.handler!({
      step: makeStepMock(),
      runId: 'run-test-9',
    })) as Record<string, number>;

    expect(result.processed_recurrences).toBe(3);
    expect(result.total_generated).toBe(12); // 3 × 4
  });

  it('(10) recurrence com next_run_on NULL → tratada como devida + processada', async () => {
    // A query SELECT já filtra `next_run_on is null OR <= current_date`.
    // Confirma que o handler processa normalmente uma row com next_run_on null.
    mocks.expandRecurrenceMock.mockReturnValueOnce(expandWith(13));
    mocks.executeMock.mockResolvedValueOnce([
      recurrenceRow({ next_run_on: null, frequency: 'weekly' }),
    ]); // SELECT recurrences
    mocks.executeMock.mockResolvedValueOnce([templateRow()]); // template
    for (let i = 0; i < 13; i += 1) {
      mocks.executeMock.mockResolvedValueOnce([{ id: `w-${i}` }]); // INSERT
    }
    mocks.executeMock.mockResolvedValueOnce([]); // UPDATE
    mocks.executeMock.mockResolvedValueOnce([]); // audit_log

    const result = (await capturedHandlers.handler!({
      step: makeStepMock(),
      runId: 'run-test-10',
    })) as Record<string, number>;

    expect(result.processed_recurrences).toBe(1);
    expect(result.total_generated).toBe(13);

    // Confirma a cláusula da query SELECT.
    const selectCall = mocks.executeMock.mock.calls.find((c) =>
      queryText(c[0]).includes('from task_recurrences'),
    );
    expect(queryText(selectCall?.[0])).toContain('next_run_on is null');
  });
});
