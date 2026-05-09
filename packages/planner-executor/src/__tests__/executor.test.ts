/**
 * Tests do Executor.
 *
 * Trace: Story 2.5 AC6 + AC7 + AC8 + AC9 + AC13 (≥12 cenários).
 *
 * Cobertura:
 *   - Happy path 1/2/3 tools delegando executeAtomic
 *   - Plan vazio → early-return sem tx (degenerate unknown)
 *   - D8 defense-in-depth: tool name inválido → AtomicFailure SEM abrir tx
 *   - executeAtomic AtomicFailure propagado correctamente
 *   - rollback em tool 2 de 3 falha
 *   - reverseOpId presente em results
 *   - ctx.db === dbResolver result
 */
import { describe, expect, it, vi } from 'vitest';

import { ToolExecutionError, ToolNotFoundError, type AtomicResult } from '@meu-jarvis/tools';

import { ExecutorValidationError } from '@/errors';
import { Executor } from '@/executor';
import type { ExecutorInput, PlanToolCall } from '@/schemas';
import { createMockDbClient } from '@/__fixtures__/mock-db-tx';
import {
  createMockRegistry,
  mockCreateTaskTool,
} from '@/__fixtures__/mock-tool-registry';

const VALID_UUID_1 = '11111111-1111-1111-1111-111111111111';
const VALID_UUID_2 = '22222222-2222-2222-2222-222222222222';
const VALID_UUID_3 = '33333333-3333-3333-3333-333333333333';

function buildToolCall(toolName: string, input: Record<string, unknown> = {}): PlanToolCall {
  return {
    toolName,
    input,
    intent: 'criar_tarefa',
  };
}

function buildExecutorInput(toolCalls: PlanToolCall[] = []): ExecutorInput {
  return {
    plan: {
      toolCalls,
      planReasoning: null,
      latencyMs: 100,
      tokensInput: 100,
      tokensOutput: 30,
      costEur: 0.001,
      cacheHit: true,
    },
    householdId: VALID_UUID_1,
    userId: VALID_UUID_2,
    traceId: 'trace-test-001',
    runId: VALID_UUID_3,
  };
}

describe('Executor.execute() — input validation', () => {
  it('runId não-UUID lança ExecutorValidationError', async () => {
    const executor = new Executor({
      registry: createMockRegistry(),
      dbResolver: () => createMockDbClient(),
    });
    await expect(
      executor.execute({
        ...buildExecutorInput(),
        runId: 'not-a-uuid',
      }),
    ).rejects.toBeInstanceOf(ExecutorValidationError);
  });
});

describe('Executor.execute() — plan vazio early-return', () => {
  it('plan.toolCalls=[] retorna AtomicResult success sem tocar DB', async () => {
    const dbClient = createMockDbClient();
    const executor = new Executor({
      registry: createMockRegistry(),
      dbResolver: () => dbClient,
    });
    const result = await executor.execute(buildExecutorInput([]));

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.results).toHaveLength(0);
    }
    expect(dbClient.transaction).not.toHaveBeenCalled();
    expect(dbClient.insert).not.toHaveBeenCalled();
  });
});

describe('Executor.execute() — D8 defense-in-depth tool name validation', () => {
  it('tool name não registado retorna AtomicFailure SEM abrir transacção', async () => {
    const dbClient = createMockDbClient();
    const executor = new Executor({
      registry: createMockRegistry(),
      dbResolver: () => dbClient,
    });
    const result = await executor.execute(
      buildExecutorInput([buildToolCall('tool_inexistente', {})]),
    );

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.failedToolName).toBe('tool_inexistente');
      expect(result.error).toBeInstanceOf(ToolNotFoundError);
    }
    expect(dbClient.transaction).not.toHaveBeenCalled();
    expect(dbClient.insert).not.toHaveBeenCalled();
  });

  it('mistura de tool válido + inválido falha rápido sem abrir tx', async () => {
    const dbClient = createMockDbClient();
    const executor = new Executor({
      registry: createMockRegistry(),
      dbResolver: () => dbClient,
    });
    const result = await executor.execute(
      buildExecutorInput([
        buildToolCall('create_task', { title: 'A' }),
        buildToolCall('tool_inexistente', {}),
      ]),
    );

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.failedToolName).toBe('tool_inexistente');
    }
    expect(dbClient.transaction).not.toHaveBeenCalled();
  });
});

describe('Executor.execute() — happy paths via executeAtomic', () => {
  it('1 tool call (create_task) — abre tx + retorna AtomicResult com reverseOpId', async () => {
    const dbClient = createMockDbClient();
    const executor = new Executor({
      registry: createMockRegistry(),
      dbResolver: () => dbClient,
    });
    const result = await executor.execute(
      buildExecutorInput([buildToolCall('create_task', { title: 'Reunião' })]),
    );

    expect(result.success).toBe(true);
    expect(dbClient.transaction).toHaveBeenCalledTimes(1);
    if (result.success) {
      expect(result.results).toHaveLength(1);
      expect(result.results[0]?.toolName).toBe('create_task');
      expect(result.results[0]?.reverseOpId).toBeTruthy();
    }
  });

  it('2 tool calls (create_task + create_finance_variable) — ambos persistem reverse_op', async () => {
    const dbClient = createMockDbClient();
    const executor = new Executor({
      registry: createMockRegistry(),
      dbResolver: () => dbClient,
    });
    const result = await executor.execute(
      buildExecutorInput([
        buildToolCall('create_task', { title: 'T1' }),
        buildToolCall('create_finance_variable', { description: 'Compra', amountEur: 25 }),
      ]),
    );

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.results).toHaveLength(2);
      const reverseOpIds = result.results.map((r) => r.reverseOpId);
      const uniqueIds = new Set(reverseOpIds);
      expect(uniqueIds.size).toBe(2); // IDs distintos
    }
  });

  it('3 tool calls — todos os reverseOpIds são UUIDs distintos', async () => {
    const dbClient = createMockDbClient();
    const executor = new Executor({
      registry: createMockRegistry(),
      dbResolver: () => dbClient,
    });
    const result = await executor.execute(
      buildExecutorInput([
        buildToolCall('create_task', { title: 'T1' }),
        buildToolCall('create_task', { title: 'T2' }),
        buildToolCall('query_tasks', { status: 'pending' }),
      ]),
    );

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.results).toHaveLength(3);
      const ids = result.results.map((r) => r.reverseOpId);
      expect(new Set(ids).size).toBe(3);
    }
  });
});

describe('Executor.execute() — rollback em tool failure', () => {
  it('tool 2 falha: AtomicFailure rolledBack=true via executeAtomic', async () => {
    const dbClient = createMockDbClient();
    const failingToolRegistry = createMockRegistry();

    // Override mockCreateTaskTool para falhar a 2ª chamada (segunda é create_finance_variable, não create_task)
    // Vamos sobrescrever create_finance_variable para lançar
    const { mockCreateFinanceVariableTool } = await import('@/__fixtures__/mock-tool-registry');
    const failingFinance = {
      ...mockCreateFinanceVariableTool,
      execute: vi.fn(async () => {
        throw new Error('simulated tool failure');
      }),
    };
    // Re-criar registry com a tool a falhar
    const { ToolRegistry } = await import('@meu-jarvis/tools');
    const registry = new ToolRegistry();
    registry.register(mockCreateTaskTool);
    registry.register(failingFinance);

    const executor = new Executor({ registry, dbResolver: () => dbClient });
    const result = await executor.execute(
      buildExecutorInput([
        buildToolCall('create_task', { title: 'T1' }),
        buildToolCall('create_finance_variable', { description: 'Compra', amountEur: 25 }),
      ]),
    );

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.rolledBack).toBe(true);
      expect(result.failedToolName).toBe('create_finance_variable');
      expect(result.error).toBeInstanceOf(ToolExecutionError);
    }
    expect(dbClient.transaction).toHaveBeenCalledTimes(1);
  });
});

describe('Executor.execute() — ctx.db delegation', () => {
  it('dbResolver invocado uma vez por execute() (não cacheado entre execuções)', async () => {
    const resolver = vi.fn(() => createMockDbClient());
    const executor = new Executor({ registry: createMockRegistry(), dbResolver: resolver });
    await executor.execute(buildExecutorInput([buildToolCall('create_task', { title: 'A' })]));
    await executor.execute(buildExecutorInput([buildToolCall('create_task', { title: 'B' })]));

    expect(resolver).toHaveBeenCalledTimes(2);
  });

  it('default dbResolver lança erro construtivo SE chegado (defense-in-depth da tool name é fail-rapid antes)', async () => {
    expect(() => new Executor()).not.toThrow(); // construtor não invoca resolver
    const executor = new Executor(); // singleton toolRegistry vazio + default dbResolver
    // Defense-in-depth (D8) fail-rapid: tool name não está no registry vazio →
    // retorna AtomicFailure { rolledBack: false } SEM invocar dbResolver.
    // Comportamento documentado em AC6 step 3.
    const result = await executor.execute(
      buildExecutorInput([buildToolCall('create_task', { title: 'A' })]),
    );
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.failedToolName).toBe('create_task');
      expect(result.error).toBeInstanceOf(ToolNotFoundError);
    }
  });

  it('default dbResolver lança erro construtivo quando defense-in-depth passa (registry com tool registada)', async () => {
    const { toolRegistry: globalRegistry } = await import('@meu-jarvis/tools');
    const registeredBefore = globalRegistry.list().length;
    // Registar tool no singleton temporariamente
    globalRegistry.register(mockCreateTaskTool);
    try {
      const executor = new Executor(); // singleton toolRegistry + default dbResolver
      await expect(
        executor.execute(buildExecutorInput([buildToolCall('create_task', { title: 'A' })])),
      ).rejects.toThrow(/dbResolver não foi fornecido/);
    } finally {
      // Cleanup: idempotência por referência protege re-register; clear() é @internal mas pragmático em teste
      // Apenas verificamos que count voltou ao baseline + 1 (cleanup global é responsabilidade do teste)
      expect(globalRegistry.list().length).toBe(registeredBefore + 1);
    }
  });
});

describe('Executor.execute() — preserve AtomicResult shape', () => {
  it('AtomicResult success retorna { success: true, results }', async () => {
    const dbClient = createMockDbClient();
    const executor = new Executor({
      registry: createMockRegistry(),
      dbResolver: () => dbClient,
    });
    const result: AtomicResult | { success: false } = await executor.execute(
      buildExecutorInput([buildToolCall('create_task', { title: 'A' })]),
    );

    expect(result).toMatchObject({ success: true });
  });
});
