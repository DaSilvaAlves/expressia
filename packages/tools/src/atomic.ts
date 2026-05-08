/**
 * `executeAtomic` — orquestra N tools sequencialmente dentro de uma única
 * transacção Drizzle, persistindo um `agent_reverse_ops` declarativo por
 * tool com `expires_at = now() + interval '30 seconds'` (FR6 undo window).
 *
 * Trace: Story 2.3 AC5 + AC6 + AC7 + Architecture §4.3 (transacção Pg
 *        atomicidade) + §4.5 (`agent_reverse_ops.expires_at` SQL puro) +
 *        PRD FR2 (multi-intent atómico) + FR6 (undo 30s) + NFR5 (RLS).
 *
 * Atomicidade:
 *   - Abre transacção via `ctx.db.transaction(async (tx) => ...)`.
 *   - Cada tool corre sequencialmente (não paralelo — evita race conditions
 *     em estado partilhado Postgres dentro da mesma transacção).
 *   - `ctxWithTx` substitui apenas `db` pelo cliente da transacção; resto
 *     (householdId, userId, traceId, runId) é preservado.
 *   - Falha de qualquer tool → throw → Drizzle rollback automático →
 *     nenhum side-effect persiste (entidades + reverse_ops desfazem juntos).
 *
 * RLS (NFR5):
 *   - `ctx.db` é SEMPRE `getDb()` (authenticated, RLS via JWT). Nunca
 *     `getServiceDb()`.
 *   - O `tx` herda o role do cliente raiz — RLS continua activa dentro
 *     da transacção.
 *   - Insert em `agent_reverse_ops` carrega `householdId` obrigatório;
 *     Postgres rejeita NULL ou cross-household por policy `WITH CHECK`.
 *
 * PII (NFR12):
 *   - Tool inputs nunca são logados em claro — só `redactToolInputForLog`.
 *   - Span attributes seguem whitelist `TOOL_SPAN_ATTRIBUTE_KEYS`.
 *   - `householdId` é hashado para spans via `hashForCorrelation`.
 *
 * Cross-package boundary:
 *   - NÃO importa `agentReverseOps` (Drizzle table) de `@meu-jarvis/db` —
 *     mesma limitação documentada em `contracts.ts` sobre `paths` aliases
 *     do package db. Em vez disso usa SQL puro via `tx.execute(sql\`...\`)`,
 *     que é universalmente suportado pelo cliente postgres-js.
 */
import { sql } from 'drizzle-orm';

import { logger } from '@meu-jarvis/observability';

import type {
  AtomicFailure,
  AtomicResult,
  AtomicToolResult,
  DrizzleDbClient,
  ReverseOpPayload,
  ToolDefinition,
  ToolExecutionContext,
} from '@/contracts';
import { serializeReverseOp } from '@/contracts';
import {
  redactToolInputForLog,
  ToolError,
  ToolExecutionError,
  ToolTransactionError,
  ToolValidationError,
} from '@/errors';
import {
  annotateAtomicMetrics,
  annotateToolMetrics,
  withAtomicSpan,
  withToolSpan,
} from '@/tracing';

/**
 * Item de entrada de `executeAtomic`. O par `(definition, input)` é tipado
 * fracamente porque a invocação multi-tool tem inputs heterogéneos — cada
 * tool valida o seu próprio input via `inputSchema.parse`.
 */
export interface AtomicToolInput {
  readonly definition: ToolDefinition<unknown, unknown>;
  readonly input: unknown;
}

/**
 * Tipo de retorno de `executeAtomic` — discriminated union de sucesso
 * (todas as tools correram + reverse_ops persistidos) vs falha controlada
 * (rollback automático).
 *
 * Excepções não-capturadas (problemas de transacção) são re-lançadas como
 * `ToolTransactionError` (retryable).
 */
export type AtomicOutcome = AtomicResult | AtomicFailure;

/**
 * Forma esperada da row devolvida pelo INSERT INTO agent_reverse_ops
 * RETURNING id.
 */
interface ReverseOpInsertResult {
  readonly id: string;
}

/**
 * Executa N tools dentro de uma única transacção Drizzle, persistindo um
 * `agent_reverse_ops` declarativo por tool (FR6 — janela de undo 30s).
 *
 * @param tools - Lista de `(definition, input)` a executar sequencialmente.
 * @param ctx - Contexto de execução (`db` é o cliente authenticated raiz —
 *   internamente substituído pelo `tx` da transacção).
 * @returns `AtomicResult` em sucesso completo; `AtomicFailure` em falha
 *   controlada (rollback feito).
 * @throws {ToolTransactionError} Se a transacção falha por causa transitória
 *   (deadlock, connection drop) — retryable pelo caller.
 *
 * @example
 *   const outcome = await executeAtomic(
 *     [
 *       { definition: criarTarefa, input: { titulo: 'comprar leite' } },
 *       { definition: criarFinancaVariavel, input: { montanteCents: 870, ... } },
 *     ],
 *     ctx,
 *   );
 *   if (outcome.success) {
 *     // outcome.results contém { toolName, output, reverseOpId } por tool
 *   }
 */
export async function executeAtomic(
  tools: ReadonlyArray<AtomicToolInput>,
  ctx: ToolExecutionContext,
): Promise<AtomicOutcome> {
  return withAtomicSpan(ctx.runId, tools.length, async (atomicSpan) => {
    try {
      const outcome = await ctx.db.transaction(async (tx: DrizzleDbClient) => {
        // O contexto que passa a cada tool tem `db` substituído pelo cliente
        // da transacção — assim os inserts heredam rollback automático.
        const ctxWithTx: ToolExecutionContext = {
          householdId: ctx.householdId,
          userId: ctx.userId,
          db: tx,
          traceId: ctx.traceId,
          runId: ctx.runId,
        };

        const results: AtomicToolResult[] = [];

        for (const item of tools) {
          const { definition, input } = item;

          const toolOutcome = await withToolSpan(
            definition.name,
            definition.domain,
            async (toolSpan): Promise<AtomicToolResult | { failure: ToolError }> => {
              const start = Date.now();

              // 1) Validar input.
              const inputParsed = definition.inputSchema.safeParse(input);
              if (!inputParsed.success) {
                const validationErr = new ToolValidationError(
                  definition.name,
                  inputParsed.error.issues[0]?.path.join('.') || 'input',
                  inputParsed.error.issues.map((i) => i.message).join('; '),
                );
                annotateToolMetrics(toolSpan, {
                  durationMs: Date.now() - start,
                  success: false,
                  householdId: ctx.householdId,
                  traceId: ctx.traceId,
                });
                logger.warn(
                  {
                    ...redactToolInputForLog(definition.name, input),
                    err: { name: validationErr.name, message: validationErr.message },
                    runId: ctx.runId,
                    traceId: ctx.traceId,
                  },
                  'Tool input validation failed inside executeAtomic',
                );
                return { failure: validationErr };
              }

              // 2) Executar.
              let output: unknown;
              try {
                output = await definition.execute(inputParsed.data, ctxWithTx);
              } catch (err) {
                const execErr =
                  err instanceof ToolError
                    ? err
                    : new ToolExecutionError(definition.name, err);
                annotateToolMetrics(toolSpan, {
                  durationMs: Date.now() - start,
                  success: false,
                  householdId: ctx.householdId,
                  traceId: ctx.traceId,
                });
                logger.warn(
                  {
                    ...redactToolInputForLog(definition.name, input),
                    err: { name: execErr.name, message: execErr.message },
                    runId: ctx.runId,
                    traceId: ctx.traceId,
                  },
                  'Tool execute() threw inside executeAtomic',
                );
                return { failure: execErr };
              }

              // 3) Validar output.
              const outputParsed = definition.outputSchema.safeParse(output);
              if (!outputParsed.success) {
                const outErr = new ToolValidationError(
                  definition.name,
                  `output.${outputParsed.error.issues[0]?.path.join('.') || 'unknown'}`,
                  outputParsed.error.issues.map((i) => i.message).join('; '),
                );
                annotateToolMetrics(toolSpan, {
                  durationMs: Date.now() - start,
                  success: false,
                  householdId: ctx.householdId,
                  traceId: ctx.traceId,
                });
                return { failure: outErr };
              }

              // 4) Reverse op declarativo.
              let reversePayload: ReverseOpPayload;
              try {
                reversePayload = await definition.reverse(outputParsed.data, ctxWithTx);
              } catch (err) {
                const revErr =
                  err instanceof ToolError
                    ? err
                    : new ToolExecutionError(definition.name, err);
                annotateToolMetrics(toolSpan, {
                  durationMs: Date.now() - start,
                  success: false,
                  householdId: ctx.householdId,
                  traceId: ctx.traceId,
                });
                return { failure: revErr };
              }

              // 5) Persistir agent_reverse_ops com expires_at via SQL puro
              //    (NÃO new Date(Date.now() + 30_000) — evita drift de clock).
              //
              //    Usamos SQL puro em vez de `tx.insert(agentReverseOps)` para
              //    evitar import cross-package de `@meu-jarvis/db` (mesma
              //    limitação de paths aliases documentada em contracts.ts).
              const serialized = serializeReverseOp(reversePayload);

              const insertResult = (await tx.execute(sql`
                insert into agent_reverse_ops
                  (agent_run_id, household_id, reverse_op, expires_at)
                values
                  (${ctx.runId}, ${ctx.householdId}, ${serialized}::jsonb, now() + interval '30 seconds')
                returning id
              `)) as ReadonlyArray<ReverseOpInsertResult>;

              const reverseOpRow = insertResult[0];
              if (!reverseOpRow) {
                // Defensivo — Postgres deveria sempre devolver a row inserida.
                throw new ToolExecutionError(
                  definition.name,
                  new Error('insert into agent_reverse_ops returned no row'),
                );
              }

              annotateToolMetrics(toolSpan, {
                durationMs: Date.now() - start,
                success: true,
                householdId: ctx.householdId,
                traceId: ctx.traceId,
              });

              return {
                toolName: definition.name,
                output: outputParsed.data,
                reverseOpId: reverseOpRow.id,
              };
            },
          );

          if ('failure' in toolOutcome) {
            // Throw para o Drizzle fazer rollback automático. Capturado fora
            // da transacção e convertido em AtomicFailure.
            throw new InternalAtomicAbort(definition.name, toolOutcome.failure);
          }

          results.push(toolOutcome);
        }

        return results;
      });

      annotateAtomicMetrics(atomicSpan, { success: true, rolledBack: false });
      return { success: true, results: outcome } satisfies AtomicResult;
    } catch (err) {
      // Falha controlada — InternalAtomicAbort foi propagado pelo throw
      // dentro da transacção. Drizzle já fez rollback.
      if (err instanceof InternalAtomicAbort) {
        annotateAtomicMetrics(atomicSpan, { success: false, rolledBack: true });
        return {
          success: false,
          failedToolName: err.failedToolName,
          error: err.toolError,
          rolledBack: true,
        } satisfies AtomicFailure;
      }

      // Falha não-prevista (deadlock, connection drop, etc.) — wrap como
      // ToolTransactionError (retryable) e re-lançar.
      annotateAtomicMetrics(atomicSpan, { success: false, rolledBack: true });
      throw err instanceof ToolError ? err : new ToolTransactionError(err);
    }
  });
}

/**
 * Marker class interno usado para sinalizar "rollback intencional por uma
 * tool específica" através do throw da transacção Drizzle.
 *
 * Não exportado — invisível fora deste ficheiro. O caller observa apenas
 * `AtomicFailure` ou `ToolTransactionError`.
 */
class InternalAtomicAbort extends Error {
  public readonly failedToolName: string;
  public readonly toolError: ToolError;

  constructor(failedToolName: string, toolError: ToolError) {
    super(`atomic abort: ${failedToolName}`);
    this.name = 'InternalAtomicAbort';
    this.failedToolName = failedToolName;
    this.toolError = toolError;
  }
}
