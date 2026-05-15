/**
 * Mock tools determinísticas para o benchmark E2E — Story 2.10 T6 SF3 absorvido
 * + QA2 (PO decision: mocks tools no E2E porque toolRegistry está vazio).
 *
 * Cada mock cobre uma intent accionável (excluindo `consultar_dados` que vai
 * por direct-DB e `unknown` que early-returns no Planner). Tools são registadas
 * no `toolRegistry` singleton via `registerMockBenchmarkTools()` antes do
 * pipeline E2E correr.
 *
 * `execute()` retorna `AtomicResult.success === true` determinísticamente
 * (sem efeito DB real — toda a transacção é rollback em Testcontainers).
 * `reverse()` produz `ReverseOpPayload` declarativo válido para feedback de
 * undo (FR6 — não testado em depth nesta story; é Story 2.8).
 *
 * Trace: Story 2.3 AC3 (`toolRegistry` SSoT); Story 2.10 AC6 (pipeline E2E);
 *        QA2 decision @po (mocks com LLM real porque tools concretas são
 *        Story 2.11+ / Epic 3).
 */
import { randomUUID } from 'node:crypto';

import { z } from 'zod';

import {
  toolRegistry,
  type ReverseOpPayload,
  type ToolDefinition,
} from '@meu-jarvis/tools';

// =============================================================================
// Helper genérico para construir um mock tool com forma idêntica.
// =============================================================================

function buildMockTool<I extends z.ZodTypeAny>(opts: {
  name: string;
  domain: 'tasks' | 'finance' | 'system';
  description: string;
  inputSchema: I;
  /** Table para o reverse_op `delete_row`. */
  reverseTable: string;
}): ToolDefinition<z.infer<I>, { id: string }> {
  return {
    name: opts.name,
    domain: opts.domain,
    description: opts.description,
    inputSchema: opts.inputSchema as z.ZodType<z.infer<I>>,
    outputSchema: z.object({ id: z.string().uuid() }),
    preview(input) {
      return `[mock benchmark] ${opts.name}: ${JSON.stringify(input).slice(0, 100)}`;
    },
    async execute(_input, _ctx) {
      // Mock determinístico — nenhuma operação real no DB. O Testcontainers
      // rollback do benchmark E2E garante zero persistência residual mesmo
      // que tools reais fossem chamadas.
      return { id: randomUUID() };
    },
    async reverse(output): Promise<ReverseOpPayload> {
      return { kind: 'delete_row', table: opts.reverseTable, id: output.id };
    },
  };
}

// =============================================================================
// Definições — uma por intent accionável (alinhada com TOOL_TO_INTENT_MAP
// em packages/planner-executor/src/schemas.ts)
// =============================================================================

/** intent criar_tarefa → tool name match em TOOL_TO_INTENT_MAP: 'create_task'. */
export const mockCreateTask = buildMockTool({
  name: 'create_task',
  domain: 'tasks',
  description: 'Mock benchmark — criar uma tarefa. Retorna ID ficcional.',
  inputSchema: z.object({
    title: z.string().min(1),
    due_at: z.string().datetime().optional(),
    description: z.string().optional(),
  }),
  reverseTable: 'tasks',
});

/** intent criar_financa_variavel → 'create_finance_variable'. */
export const mockCreateFinanceVariable = buildMockTool({
  name: 'create_finance_variable',
  domain: 'finance',
  description: 'Mock benchmark — registar uma despesa variável pontual.',
  inputSchema: z.object({
    amount_cents: z.number().int().nonnegative(),
    description: z.string().min(1),
    occurred_at: z.string().datetime().optional(),
    category: z.string().optional(),
  }),
  reverseTable: 'transactions',
});

/** intent criar_financa_recorrente → 'create_finance_recurrence'. */
export const mockCreateFinanceRecurrence = buildMockTool({
  name: 'create_finance_recurrence',
  domain: 'finance',
  description: 'Mock benchmark — registar uma despesa recorrente mensal.',
  inputSchema: z.object({
    amount_cents: z.number().int().nonnegative(),
    description: z.string().min(1),
    period: z.enum(['monthly', 'yearly']).optional(),
  }),
  reverseTable: 'recurrences',
});

/** intent criar_cartao → 'create_card'. */
export const mockCreateCard = buildMockTool({
  name: 'create_card',
  domain: 'finance',
  description: 'Mock benchmark — adicionar um cartão de crédito/débito.',
  inputSchema: z.object({
    issuer: z.string().min(1),
    type: z.enum(['credit', 'debit']).optional(),
    credit_limit_cents: z.number().int().nonnegative().optional(),
  }),
  reverseTable: 'cards',
});

/** intent criar_parcelada → 'create_installment'. */
export const mockCreateInstallment = buildMockTool({
  name: 'create_installment',
  domain: 'finance',
  description: 'Mock benchmark — registar uma compra parcelada.',
  inputSchema: z.object({
    total_amount_cents: z.number().int().nonnegative(),
    installments: z.number().int().min(2),
    description: z.string().min(1),
  }),
  reverseTable: 'installments',
});

/** intent cancelar_ultima → 'cancel_last_run'. */
export const mockCancelLastRun = buildMockTool({
  name: 'cancel_last_run',
  domain: 'system',
  description: 'Mock benchmark — desfazer a última operação dentro da janela 30s.',
  inputSchema: z.object({
    // cancelar_ultima é nullary efectivo — schema permite payload vazio.
    confirm: z.boolean().optional(),
  }),
  reverseTable: 'agent_runs',
});

// =============================================================================
// Helper de registo
// =============================================================================

/**
 * Lista canónica das 6 mock tools — uma por intent accionável.
 *
 * `consultar_dados` toma o caminho direct-DB (cost router) sem invocar Planner;
 * `unknown` early-returns no Planner sem tool calls. Portanto não precisam de
 * mock tool registada.
 */
/**
 * Lista canónica das 6 mock tools — uma por intent accionável.
 *
 * Tipada como `ToolDefinition<unknown, unknown>[]` para permitir homogeneidade
 * no array — cada tool tem `inputSchema` Zod específico, mas o `toolRegistry`
 * aceita `unknown,unknown` via cast interno (padrão da Story 2.3).
 */
export const MOCK_BENCHMARK_TOOLS: readonly ToolDefinition<unknown, unknown>[] = [
  mockCreateTask as unknown as ToolDefinition<unknown, unknown>,
  mockCreateFinanceVariable as unknown as ToolDefinition<unknown, unknown>,
  mockCreateFinanceRecurrence as unknown as ToolDefinition<unknown, unknown>,
  mockCreateCard as unknown as ToolDefinition<unknown, unknown>,
  mockCreateInstallment as unknown as ToolDefinition<unknown, unknown>,
  mockCancelLastRun as unknown as ToolDefinition<unknown, unknown>,
];

/**
 * Regista todas as mock tools no `toolRegistry` singleton.
 *
 * Idempotente — chamada repetida é no-op (a `ToolRegistry.register` detecta
 * idempotência por referência de objecto). Útil para chamadas em loop nos
 * testes Vitest sem reset explícito.
 */
export function registerMockBenchmarkTools(): void {
  for (const tool of MOCK_BENCHMARK_TOOLS) {
    toolRegistry.register(tool);
  }
}

/**
 * Remove apenas as mock tools deste fixture do registry — usado em
 * `afterEach` dos tests para isolamento entre suites quando necessário.
 *
 * NOTA: `ToolRegistry.clear()` é demasiado agressivo (limpa todas as tools).
 * Esta função usa uma abordagem cirúrgica via re-instanciação do registry —
 * mas como `toolRegistry` é singleton exportado, a alternativa pragmática é
 * `clear()` total (aceitável em tests). Para o benchmark E2E (single-run),
 * registo idempotente cobre o caso de uso sem precisar de remover.
 */
export function clearMockBenchmarkTools(): void {
  // Para esta story, o `toolRegistry.clear()` é apropriado em afterEach:
  // os tests do benchmark E2E criam o seu próprio universo isolado.
  toolRegistry.clear();
}
