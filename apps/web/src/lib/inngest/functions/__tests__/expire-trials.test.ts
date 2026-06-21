// @vitest-environment node
/**
 * Tests — `expireTrials` Inngest function (Story 6.4 AC7).
 *
 * Mockable-only: zero Inngest Dev Server, zero Postgres real. O handler é
 * extraído via mock de `inngest.createFunction` (pattern Story 4.5
 * `generate-finance-recurrences.test.ts` — `vi.hoisted` shared object).
 *
 * **PO-MUST-FIX-2:** o mock de `@/lib/agent/db-shim` expõe `transaction:` além
 * de `execute:`. O callback de `transaction(cb)` recebe um `tx` cujo `.execute`
 * é o MESMO `executeMock` do db de topo — assim a sequência de queries
 * (SELECT → UPDATE subscriptions → UPDATE households → INSERT audit) é
 * observável numa única timeline e a atomicidade por-subscription é testável.
 *
 * Cobertura conforme AC7 (8 testes):
 *   registo id/cron + zero trials + 1 trial (2 UPDATEs na tx) + N trials +
 *   idempotência (UPDATE no-op) + erro DB (re-throw + captureException) +
 *   span attrs sem PII + audit usa enum existente (sem `trials_expired`).
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
    // PO-MUST-FIX-2: `transaction(cb)` invoca o callback com um `tx` cujo
    // `.execute` partilha o `executeMock` — sequência observável numa timeline.
    transaction: vi.fn(async <T>(cb: (tx: { execute: typeof mocks.executeMock }) => Promise<T>): Promise<T> =>
      cb({ execute: mocks.executeMock }),
    ),
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
import { expireTrials } from '@/lib/inngest/functions/expire-trials';

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

/** Row de subscription em trial expirado de teste. */
function trialRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'sub-1',
    household_id: 'hh-1',
    trial_ends_at: '2026-06-07T00:00:00.000Z',
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('expireTrials', () => {
  it('regista id/name correctos e cron 03:00 UTC diário (AC4/T3.7)', () => {
    expect(capturedHandlers.config?.id).toBe('expire-trials');
    expect(capturedHandlers.config?.name).toBe('Expire trials');
    expect(capturedHandlers.trigger?.cron).toBe('0 3 * * *');
    expect(expireTrials).toBeDefined();
  });

  it('(1) zero trials expirados → expired_count 0, zero UPDATEs (T3.2)', async () => {
    mocks.executeMock.mockResolvedValueOnce([]); // SELECT subscriptions → vazio
    mocks.executeMock.mockResolvedValueOnce([]); // INSERT audit_log

    const result = (await capturedHandlers.handler!({
      step: makeStepMock(),
      runId: 'run-test-1',
    })) as Record<string, number>;

    expect(result).toEqual({ expired_count: 0, skipped_count: 0 });

    const updateSubCalls = mocks.executeMock.mock.calls.filter((c) =>
      queryText(c[0]).includes('update subscriptions'),
    );
    const updateHhCalls = mocks.executeMock.mock.calls.filter((c) =>
      queryText(c[0]).includes('update households'),
    );
    expect(updateSubCalls).toHaveLength(0);
    expect(updateHhCalls).toHaveLength(0);

    // A SELECT filtra status='trialing' e trial_ends_at <= now() (AC1).
    const selectCall = mocks.executeMock.mock.calls.find((c) =>
      queryText(c[0]).includes('from subscriptions'),
    );
    expect(queryText(selectCall?.[0])).toContain("status = 'trialing'");
    expect(queryText(selectCall?.[0])).toContain('trial_ends_at <= now()');
  });

  it('(2) 1 trial expirado → 2 UPDATEs na mesma transacção + expired_count 1 (T3.3/AC2)', async () => {
    mocks.executeMock.mockResolvedValueOnce([trialRow()]); // SELECT
    mocks.executeMock.mockResolvedValueOnce([{ id: 'sub-1' }]); // UPDATE subscriptions (1 row)
    mocks.executeMock.mockResolvedValueOnce([]); // UPDATE households
    mocks.executeMock.mockResolvedValueOnce([]); // INSERT audit_log

    const result = (await capturedHandlers.handler!({
      step: makeStepMock(),
      runId: 'run-test-2',
    })) as Record<string, number>;

    expect(result.expired_count).toBe(1);
    expect(result.skipped_count).toBe(0);

    const updateSubCalls = mocks.executeMock.mock.calls.filter((c) =>
      queryText(c[0]).includes('update subscriptions'),
    );
    const updateHhCalls = mocks.executeMock.mock.calls.filter((c) =>
      queryText(c[0]).includes('update households'),
    );
    expect(updateSubCalls).toHaveLength(1);
    expect(updateHhCalls).toHaveLength(1);
    // UPDATE subscriptions regride status + plan; segunda linha de defesa no WHERE.
    expect(queryText(updateSubCalls[0]?.[0])).toContain("status = 'canceled'");
    expect(queryText(updateSubCalls[0]?.[0])).toContain("plan = 'free'");
    expect(queryText(updateSubCalls[0]?.[0])).toContain("and status = 'trialing'");
    // UPDATE households regride plan denormalizado.
    expect(queryText(updateHhCalls[0]?.[0])).toContain("plan = 'free'");
  });

  it('(3) múltiplos trials → todos processados sequencialmente, counts somados (T3.4)', async () => {
    mocks.executeMock.mockResolvedValueOnce([
      trialRow({ id: 'sub-1', household_id: 'hh-1' }),
      trialRow({ id: 'sub-2', household_id: 'hh-2' }),
      trialRow({ id: 'sub-3', household_id: 'hh-3' }),
    ]); // SELECT (3)
    // Para cada subscription: UPDATE subscriptions (1 row) + UPDATE households.
    for (let i = 0; i < 3; i += 1) {
      mocks.executeMock.mockResolvedValueOnce([{ id: `sub-${i + 1}` }]); // UPDATE subscriptions
      mocks.executeMock.mockResolvedValueOnce([]); // UPDATE households
    }
    mocks.executeMock.mockResolvedValueOnce([]); // INSERT audit_log

    const result = (await capturedHandlers.handler!({
      step: makeStepMock(),
      runId: 'run-test-3',
    })) as Record<string, number>;

    expect(result.expired_count).toBe(3);
    expect(result.skipped_count).toBe(0);

    const updateHhCalls = mocks.executeMock.mock.calls.filter((c) =>
      queryText(c[0]).includes('update households'),
    );
    expect(updateHhCalls).toHaveLength(3);
  });

  it('(4) idempotência — UPDATE subscriptions no-op (status já mudou) → households NÃO tocado (T3.5/AC3)', async () => {
    mocks.executeMock.mockResolvedValueOnce([trialRow()]); // SELECT
    mocks.executeMock.mockResolvedValueOnce([]); // UPDATE subscriptions → 0 rows (race)
    mocks.executeMock.mockResolvedValueOnce([]); // INSERT audit_log

    const result = (await capturedHandlers.handler!({
      step: makeStepMock(),
      runId: 'run-test-4',
    })) as Record<string, number>;

    expect(result.expired_count).toBe(0);
    expect(result.skipped_count).toBe(1);

    // Como o UPDATE subscriptions não tocou nenhuma row, o UPDATE households
    // é saltado — sem divergência, sem write desnecessário.
    const updateHhCalls = mocks.executeMock.mock.calls.filter((c) =>
      queryText(c[0]).includes('update households'),
    );
    expect(updateHhCalls).toHaveLength(0);
  });

  it('(5) erro DB no UPDATE → exception re-thrown + captureException (T3.5/AC6)', async () => {
    const dbError = new Error('Postgres connection refused');
    mocks.executeMock.mockResolvedValueOnce([trialRow()]); // SELECT ok
    mocks.executeMock.mockRejectedValueOnce(dbError); // UPDATE subscriptions falha

    await expect(
      capturedHandlers.handler!({ step: makeStepMock(), runId: 'run-test-5' }),
    ).rejects.toThrow(/Postgres connection refused/);

    expect(mocks.loggerErrorMock).toHaveBeenCalledTimes(1);
    expect(mocks.captureExceptionMock).toHaveBeenCalledTimes(1);
    const captureCall = mocks.captureExceptionMock.mock.calls[0];
    expect(captureCall?.[0]).toBe(dbError);
    expect(captureCall?.[1]).toEqual({ tags: { job: 'expire-trials' } });
  });

  it('(6) span attributes — whitelist sem PII (T3.6/AC5)', async () => {
    mocks.executeMock.mockResolvedValueOnce([]); // SELECT
    mocks.executeMock.mockResolvedValueOnce([]); // INSERT audit_log

    await capturedHandlers.handler!({ step: makeStepMock(), runId: 'run-test-6' });

    const attrKeys = mocks.spanSetAttributeMock.mock.calls.map((c) => c[0] as string);
    expect(attrKeys).toContain('billing.trials.expired_count');
    expect(attrKeys).toContain('billing.trials.skipped_count');
    expect(attrKeys).toContain('billing.cron.duration_ms');
    expect(attrKeys).toContain('inngest.run_id');
    // Zero atributos com PII (household id raw, user id, email, valores).
    expect(attrKeys).not.toContain('household.id');
    expect(attrKeys).not.toContain('user.id');
    expect(attrKeys.some((k) => k.includes('email'))).toBe(false);
    expect(attrKeys.some((k) => k.includes('amount'))).toBe(false);
  });

  it('(7) audit_log usa enum EXISTENTE `plan_changed` (PO-MUST-FIX-1), nunca `trials_expired`', async () => {
    mocks.executeMock.mockResolvedValueOnce([]); // SELECT
    mocks.executeMock.mockResolvedValueOnce([]); // INSERT audit_log

    await capturedHandlers.handler!({ step: makeStepMock(), runId: 'run-test-7' });

    const auditCall = mocks.executeMock.mock.calls.find((c) =>
      queryText(c[0]).includes('insert into audit_log'),
    );
    expect(auditCall).toBeDefined();
    const auditText = queryText(auditCall?.[0]);
    expect(auditText).toContain("'plan_changed'::audit_action");
    expect(auditText).not.toContain('trials_expired');
    expect(auditText).not.toContain('trial_expired');
    expect(auditText).toContain('subscriptions'); // entity_table
  });

  it('(8) audit_log INSERT falha → warn não-fatal, handler conclui na mesma', async () => {
    mocks.executeMock.mockResolvedValueOnce([]); // SELECT → vazio
    mocks.executeMock.mockRejectedValueOnce(new Error('audit_log indisponível')); // audit falha

    const result = (await capturedHandlers.handler!({
      step: makeStepMock(),
      runId: 'run-test-8',
    })) as Record<string, number>;

    expect(result).toEqual({ expired_count: 0, skipped_count: 0 });
    expect(mocks.loggerWarnMock).toHaveBeenCalled();
    const auditWarn = mocks.captureExceptionMock.mock.calls.find((c) => {
      const ctx = c[1] as { tags?: Record<string, unknown> } | undefined;
      return ctx?.tags?.phase === 'audit_log';
    });
    expect(auditWarn).toBeDefined();
  });
});
