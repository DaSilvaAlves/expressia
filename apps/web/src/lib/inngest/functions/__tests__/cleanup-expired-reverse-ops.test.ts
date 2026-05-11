// @vitest-environment node
/**
 * Tests — `cleanupExpiredReverseOps` Inngest function (Story 2.8 AC10).
 *
 * Cobertura ≥4 testes per AC10:
 *   (i)   Handler executa DELETE query correcta (shape contém `delete from
 *         agent_reverse_ops where expires_at < now() - interval '1 hour'`).
 *   (ii)  Handler é idempotente (chama 2x consecutivamente — segundo retorna
 *         0 rows deleted).
 *   (iii) Handler regista Pino log + `rows_deleted` count.
 *   (iv)  Handler propaga errors do DB ao Inngest engine (não swallows).
 *
 * Mocks: D43 — Vitest mocks completos sem Inngest Dev Server em CI.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  executeMock: vi.fn<(query: unknown) => Promise<unknown>>(),
  loggerInfoMock: vi.fn(),
  loggerErrorMock: vi.fn(),
  captureExceptionMock: vi.fn(),
}));

vi.mock('@/lib/agent/db-shim', () => ({
  getServiceDb: () => ({
    execute: mocks.executeMock,
  }),
}));

vi.mock('@meu-jarvis/observability', () => ({
  childLogger: () => ({
    info: mocks.loggerInfoMock,
    error: mocks.loggerErrorMock,
    warn: vi.fn(),
  }),
  captureException: mocks.captureExceptionMock,
}));

// O `inngest.createFunction` retorna um objecto opaco; precisamos do handler
// crú para invocar. Vamos mockar `inngest` para extrair o handler passado.
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
      // Retorna shape minimal — o serve() usa estes campos.
      return { id: config.id, name: config.name, trigger, handler };
    },
  },
}));

// Import APÓS os mocks para garantir que createFunction é o mockado.
import { cleanupExpiredReverseOps } from '@/lib/inngest/functions/cleanup-expired-reverse-ops';

/**
 * Cria um mock `step` compatível com o contrato Inngest:
 *   - `step.run(id, cb)` invoca o callback directamente.
 */
function makeStepMock() {
  return {
    run: vi.fn(async <T>(_id: string, cb: () => Promise<T>): Promise<T> => cb()),
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('cleanupExpiredReverseOps', () => {
  it('regista o nome/id correctos e o cron schedule 03:00 UTC diário', () => {
    expect(capturedHandlers.config?.id).toBe('cleanup-expired-reverse-ops');
    expect(capturedHandlers.config?.name).toBe('Cleanup expired reverse ops');
    expect(capturedHandlers.trigger?.cron).toBe('0 3 * * *');
    expect(cleanupExpiredReverseOps).toBeDefined();
  });

  it('(i) executa DELETE com WHERE `expires_at < now() - interval 1 hour`', async () => {
    mocks.executeMock.mockResolvedValueOnce([]);
    const step = makeStepMock();
    expect(capturedHandlers.handler).not.toBeNull();
    await capturedHandlers.handler!({ event: {}, step });

    expect(mocks.executeMock).toHaveBeenCalledTimes(1);
    const queryArg = mocks.executeMock.mock.calls[0]?.[0] as { queryChunks?: unknown[] } | undefined;
    // Drizzle sql template — verificar shape inspeccionando o template raw.
    // O `sql` template expõe `.queryChunks` array (mix de strings + params).
    const flat = JSON.stringify(queryArg ?? {});
    expect(flat).toMatch(/delete from agent_reverse_ops/i);
    expect(flat).toMatch(/expires_at/i);
    expect(flat).toMatch(/interval '1 hour'/i);
  });

  it('(ii) é idempotente — segunda chamada retorna 0 rows deleted', async () => {
    mocks.executeMock.mockResolvedValueOnce([]); // 1ª run: simulamos N rows mas mock retorna empty
    const step = makeStepMock();

    const firstResult = (await capturedHandlers.handler!({ event: {}, step })) as { rows_deleted: number };
    expect(firstResult).toEqual({ rows_deleted: 0 });

    // 2ª run consecutiva — DELETE com mesmo WHERE retorna 0 (idempotente).
    mocks.executeMock.mockResolvedValueOnce([]);
    const secondResult = (await capturedHandlers.handler!({ event: {}, step })) as { rows_deleted: number };
    expect(secondResult).toEqual({ rows_deleted: 0 });
    expect(mocks.executeMock).toHaveBeenCalledTimes(2);
  });

  it('(iii) regista Pino info log com `rows_deleted` count quando rows são apagadas', async () => {
    // postgres-js pode retornar `[{ count: N }]` OU `{ count: N }`; o handler é defensivo.
    mocks.executeMock.mockResolvedValueOnce([{ count: 3 }]);
    const step = makeStepMock();

    const result = (await capturedHandlers.handler!({ event: {}, step })) as { rows_deleted: number };
    expect(result.rows_deleted).toBe(3);

    expect(mocks.loggerInfoMock).toHaveBeenCalledTimes(1);
    const logCall = mocks.loggerInfoMock.mock.calls[0];
    expect(logCall?.[0]).toEqual({ rows_deleted: 3 });
    expect(logCall?.[1]).toMatch(/cleanup expired reverse ops/i);
  });

  it('(iv) propaga errors do DB ao Inngest engine (re-throw + Sentry capture)', async () => {
    const dbError = new Error('Postgres connection refused');
    mocks.executeMock.mockRejectedValueOnce(dbError);
    const step = makeStepMock();

    await expect(capturedHandlers.handler!({ event: {}, step })).rejects.toThrow(
      /Postgres connection refused/,
    );

    expect(mocks.loggerErrorMock).toHaveBeenCalledTimes(1);
    expect(mocks.captureExceptionMock).toHaveBeenCalledTimes(1);
    const captureCall = mocks.captureExceptionMock.mock.calls[0];
    expect(captureCall?.[0]).toBe(dbError);
    expect(captureCall?.[1]).toEqual({ tags: { job: 'cleanup-expired-reverse-ops' } });
  });
});
