/**
 * Mock minimal `DrizzleDbClient` para testes do Executor.
 *
 * Trace: Story 2.5 AC12 + padrão mockability 2.3 atomic.test.ts.
 *
 * O mock simula:
 *   - `transaction(fn)` — executa `fn(tx)` (passa-se a si próprio como tx)
 *   - `insert(table)` — devolve query builder com `values(...).returning(...)`
 *   - `execute(sql)` — no-op para SQL puro (executeAtomic da 2.3 usa para
 *     persist em agent_reverse_ops com `now() + interval '30 seconds'`)
 *
 * O mock **NÃO** valida SQL — apenas regista calls e retorna outputs determinísticos.
 * Para testes de defesa-em-profundidade do Executor (D8), o registry mock
 * intercepta tool name validation ANTES de chegar ao DB.
 */
import { vi, type Mock } from 'vitest';

import type { DrizzleDbClient } from '@meu-jarvis/tools';

/**
 * Estado capturado pelo mock — útil para asserts em tests.
 */
export interface MockDbState {
  readonly insertCalls: Array<{ table: unknown; values: unknown }>;
  readonly executeCalls: Array<{ sql: unknown }>;
  readonly transactionCount: number;
  readonly returningResults: Array<Array<Record<string, unknown>>>;
}

/**
 * Mock client com vitest spies + estado partilhado.
 */
export interface MockDbClient extends DrizzleDbClient {
  readonly transaction: Mock;
  readonly insert: Mock;
  readonly execute: Mock;
  readonly state: MockDbState;
}

/**
 * Cria um `DrizzleDbClient` mock que captura todas as chamadas em `state`.
 *
 * Por default `insert(...).values(...).returning(...)` retorna
 * `[{ id: '<uuid generated>' }]` — útil para `executeAtomic` da 2.3 popular
 * `agent_reverse_ops.id`.
 *
 * Para testar rollback: o caller pode `mockClient.transaction.mockImplementationOnce`
 * que lança erro, ou pode injectar uma tool mock cujo `execute` lança.
 */
export function createMockDbClient(opts: { idGenerator?: () => string } = {}): MockDbClient {
  const idGen = opts.idGenerator ?? generateUuid;

  const state: MockDbState = {
    insertCalls: [],
    executeCalls: [],
    transactionCount: 0,
    returningResults: [],
  };

  const insertMock: Mock = vi.fn();
  const executeMock: Mock = vi.fn();
  const transactionMock: Mock = vi.fn();

  const client: MockDbClient = {
    transaction: transactionMock,
    insert: insertMock,
    execute: executeMock,
    state,
  };

  // Default behaviours (callers podem override via mockImplementationOnce)
  insertMock.mockImplementation((table: unknown) => ({
    values: (values: unknown) => ({
      returning: async () => {
        const id = idGen();
        const result = [{ id }];
        (state.insertCalls as Array<{ table: unknown; values: unknown }>).push({ table, values });
        (state.returningResults as Array<Array<Record<string, unknown>>>).push(result);
        return result;
      },
    }),
  }));

  executeMock.mockImplementation(async (sql: unknown) => {
    (state.executeCalls as Array<{ sql: unknown }>).push({ sql });
    // executeAtomic da Story 2.3 chama `tx.execute(sql\`insert into agent_reverse_ops ... returning id\`)`
    // e espera ReadonlyArray<{id: string}>. Mock retorna 1 row com UUID gerado per call.
    const id = idGen();
    return [{ id }];
  });

  transactionMock.mockImplementation(async <T>(fn: (tx: DrizzleDbClient) => Promise<T>): Promise<T> => {
    (state as { transactionCount: number }).transactionCount += 1;
    // Passa-se como tx — em produção Drizzle passa um sub-cliente da tx.
    return fn(client);
  });

  return client;
}

let counter = 0;
function generateUuid(): string {
  counter += 1;
  // UUID v4 formato; valor determinístico para testes (dependent of counter)
  const hex = counter.toString(16).padStart(8, '0');
  return `${hex}-0000-4000-8000-000000000000`;
}
