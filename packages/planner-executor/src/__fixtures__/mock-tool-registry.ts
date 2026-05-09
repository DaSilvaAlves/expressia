/**
 * Mock `ToolRegistry` com 3 tools determinísticas para testes.
 *
 * Trace: Story 2.5 AC12 + padrão mockability 2.3 mock-tools.ts.
 *
 * As 3 tools mock:
 *   - `mockCreateTaskTool`: `name: 'create_task'`, echo input, reverse delete_row
 *   - `mockCreateFinanceVariableTool`: `name: 'create_finance_variable'`, calc
 *      `amountCents`, reverse delete_row
 *   - `mockQueryTool`: `name: 'query_tasks'`, read-only, reverse composite vazio
 *
 * Os nomes coincidem com `TOOL_TO_INTENT_MAP` para que `resolveIntentFromToolName`
 * produza intent não-`'unknown'` (testável em `contract.test.ts`).
 *
 * NÃO importar este ficheiro do package barrel `index.ts` — APENAS testes.
 */
import { z } from 'zod';

import { ToolRegistry, type ToolDefinition } from '@meu-jarvis/tools';

// ─────────────────────────────────────────────────────────────────────────────
// Mock tool 1: create_task
// ─────────────────────────────────────────────────────────────────────────────

const CreateTaskInputSchema = z.object({
  title: z.string().min(1),
  due_at: z.string().optional(),
});

const CreateTaskOutputSchema = z.object({
  id: z.string().uuid(),
  title: z.string(),
});

export const mockCreateTaskTool: ToolDefinition<
  z.infer<typeof CreateTaskInputSchema>,
  z.infer<typeof CreateTaskOutputSchema>
> = {
  name: 'create_task',
  domain: 'tasks',
  description: 'Cria uma tarefa no household actual.',
  inputSchema: CreateTaskInputSchema,
  outputSchema: CreateTaskOutputSchema,
  preview: (input) => `Vais criar 1 tarefa: "${input.title}"`,
  execute: async (input) => ({
    id: '11111111-1111-1111-1111-111111111111',
    title: input.title,
  }),
  reverse: async (output) => ({
    kind: 'delete_row',
    table: 'tasks',
    id: output.id,
  }),
};

// ─────────────────────────────────────────────────────────────────────────────
// Mock tool 2: create_finance_variable
// ─────────────────────────────────────────────────────────────────────────────

const CreateFinanceVariableInputSchema = z.object({
  description: z.string().min(1),
  amountEur: z.number().positive(),
});

const CreateFinanceVariableOutputSchema = z.object({
  id: z.string().uuid(),
  description: z.string(),
  amountCents: z.number().int().positive(),
});

export const mockCreateFinanceVariableTool: ToolDefinition<
  z.infer<typeof CreateFinanceVariableInputSchema>,
  z.infer<typeof CreateFinanceVariableOutputSchema>
> = {
  name: 'create_finance_variable',
  domain: 'finance',
  description: 'Regista uma transação financeira variável (compra, despesa pontual).',
  inputSchema: CreateFinanceVariableInputSchema,
  outputSchema: CreateFinanceVariableOutputSchema,
  preview: (input) => `Vais registar transação: ${input.description} (€${input.amountEur.toFixed(2)})`,
  execute: async (input) => ({
    id: '22222222-2222-2222-2222-222222222222',
    description: input.description,
    amountCents: Math.round(input.amountEur * 100),
  }),
  reverse: async (output) => ({
    kind: 'delete_row',
    table: 'transactions',
    id: output.id,
  }),
};

// ─────────────────────────────────────────────────────────────────────────────
// Mock tool 3: query_tasks (read-only)
// ─────────────────────────────────────────────────────────────────────────────

const QueryTasksInputSchema = z.object({
  status: z.string().optional(),
  due_today: z.boolean().optional(),
});

const QueryTasksOutputSchema = z.object({
  tasks: z.array(z.object({ id: z.string(), title: z.string() })),
  count: z.number().int().nonnegative(),
});

export const mockQueryTool: ToolDefinition<
  z.infer<typeof QueryTasksInputSchema>,
  z.infer<typeof QueryTasksOutputSchema>
> = {
  name: 'query_tasks',
  domain: 'query',
  description: 'Consulta tarefas no household actual (read-only).',
  inputSchema: QueryTasksInputSchema,
  outputSchema: QueryTasksOutputSchema,
  preview: (input) => `Vais consultar tarefas (filtros: ${JSON.stringify(input)})`,
  execute: async () => ({ tasks: [], count: 0 }),
  reverse: async () => ({ kind: 'composite', ops: [] }),
};

// ─────────────────────────────────────────────────────────────────────────────
// Factory de registry com as 3 tools
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Cria um `ToolRegistry` novo com as 3 tools mock registadas.
 *
 * Cada teste deve criar a sua própria instância para evitar pollution
 * cross-test (não usar singleton `toolRegistry` do package tools — esse é
 * partilhado em produção e tests podem deixá-lo num estado inconsistente).
 */
export function createMockRegistry(): ToolRegistry {
  const registry = new ToolRegistry();
  registry.register(mockCreateTaskTool);
  registry.register(mockCreateFinanceVariableTool);
  registry.register(mockQueryTool);
  return registry;
}
