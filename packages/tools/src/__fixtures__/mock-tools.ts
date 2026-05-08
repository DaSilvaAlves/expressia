/**
 * Mock tools APENAS para testes — nunca exportadas pelo barrel principal
 * `index.ts`.
 *
 * Trace: Story 2.3 AC11 (testing prep) — Task 6.
 *
 * Cobrem 3 padrões críticos:
 *   - `echoTool`: happy-path simples, reverse `delete_row`.
 *   - `failTool`: lança sempre — usado para testar rollback de transacção
 *     em `atomic.test.ts`.
 *   - `slowTool`: simulação de operação com delay (configurável); útil para
 *     testar que tools correm sequencialmente (não em paralelo) dentro da
 *     transacção.
 *
 * Padrão importante: estes mocks usam `randomUUID()` para gerar IDs
 * determinísticos por teste — os testes podem inspeccionar o output e validar
 * sem ter que mockar a tabela real `tasks` ou `transactions`.
 */
import { randomUUID } from 'node:crypto';

import { z } from 'zod';

import type { ReverseOpPayload, ToolDefinition, ToolExecutionContext } from '@/contracts';
import { ToolExecutionError } from '@/errors';

// ─────────────────────────────────────────────────────────────────────────────
// echoTool — happy-path básico
// ─────────────────────────────────────────────────────────────────────────────

const EchoInputSchema = z.object({ text: z.string().min(1) });
const EchoOutputSchema = z.object({ echoed: z.string(), id: z.string().uuid() });

type EchoInput = z.infer<typeof EchoInputSchema>;
type EchoOutput = z.infer<typeof EchoOutputSchema>;

export const echoTool: ToolDefinition<EchoInput, EchoOutput> = {
  name: 'echo_test',
  domain: 'system',
  description: 'Mock tool — repete o input. Usado apenas em testes.',
  inputSchema: EchoInputSchema,
  outputSchema: EchoOutputSchema,
  preview(input) {
    return `[mock] vai repetir: "${input.text}"`;
  },
  async execute(input) {
    return { echoed: input.text, id: randomUUID() };
  },
  async reverse(output): Promise<ReverseOpPayload> {
    return { kind: 'delete_row', table: 'mock_echoes', id: output.id };
  },
};

// ─────────────────────────────────────────────────────────────────────────────
// failTool — lança sempre
// ─────────────────────────────────────────────────────────────────────────────

const FailInputSchema = z.object({ shouldFail: z.literal(true) });
const FailOutputSchema = z.object({ ok: z.boolean() });

type FailInput = z.infer<typeof FailInputSchema>;
type FailOutput = z.infer<typeof FailOutputSchema>;

export const failTool: ToolDefinition<FailInput, FailOutput> = {
  name: 'fail_test',
  domain: 'system',
  description: 'Mock tool — lança sempre ToolExecutionError. Usado apenas em testes.',
  inputSchema: FailInputSchema,
  outputSchema: FailOutputSchema,
  preview() {
    return '[mock] vai falhar deterministicamente';
  },
  async execute(_input, _ctx: ToolExecutionContext): Promise<FailOutput> {
    throw new ToolExecutionError('fail_test', new Error('intentional failure for tests'));
  },
  async reverse(): Promise<ReverseOpPayload> {
    // Nunca chega a ser chamado — execute lança antes.
    return { kind: 'delete_row', table: 'mock_fail', id: randomUUID() };
  },
};

// ─────────────────────────────────────────────────────────────────────────────
// slowTool — simulação de delay
// ─────────────────────────────────────────────────────────────────────────────

const SlowInputSchema = z.object({ delayMs: z.number().int().min(0).max(1000) });
const SlowOutputSchema = z.object({ done: z.boolean(), id: z.string().uuid() });

type SlowInput = z.infer<typeof SlowInputSchema>;
type SlowOutput = z.infer<typeof SlowOutputSchema>;

export const slowTool: ToolDefinition<SlowInput, SlowOutput> = {
  name: 'slow_test',
  domain: 'system',
  description: 'Mock tool — completa após delayMs. Usado apenas em testes.',
  inputSchema: SlowInputSchema,
  outputSchema: SlowOutputSchema,
  preview(input) {
    return `[mock] vai esperar ${String(input.delayMs)}ms`;
  },
  async execute(input) {
    if (input.delayMs > 0) {
      await new Promise((resolve) => setTimeout(resolve, input.delayMs));
    }
    return { done: true, id: randomUUID() };
  },
  async reverse(output): Promise<ReverseOpPayload> {
    return { kind: 'delete_row', table: 'mock_slow', id: output.id };
  },
};
