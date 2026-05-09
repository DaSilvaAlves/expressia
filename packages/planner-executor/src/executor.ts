/**
 * `Executor` — Estágio 3 do pipeline AI multi-intent.
 *
 * Trace: Story 2.5 AC6 + AC7 + AC8 + Architecture §4.3 (Executor — Sonnet+Tools)
 *        + §4.1 (BEGIN tx → loop → COMMIT) + §4.5 (agent_reverse_ops) + FR2
 *        (atomicidade) + FR6 (undo 30s) + NFR5 (RLS).
 *
 * Princípio: thin wrapper sobre `executeAtomic` da Story 2.3. Esta classe NÃO
 * recria transaction wrapper, NÃO recria RLS enforcement, NÃO recria
 * agent_reverse_ops persistence. Tudo delegado.
 *
 * Fluxo de `execute(input)`:
 *   1. Validar `ExecutorInputSchema.parse(input)` → `ExecutorValidationError`.
 *   2. Early-return: plan.toolCalls.length === 0 → `AtomicResult{success:true,
 *      results:[]}` SEM abrir transacção (degenerate case `unknown` intent).
 *   3. **Defense-in-depth (D8)**: validar cada tool name contra registry —
 *      se algum falha, retornar `AtomicFailure{rolledBack: false}` SEM
 *      abrir transacção (poupa Postgres round-trip).
 *   4. Construir array `tools` no formato `executeAtomic` espera.
 *   5. Construir `ToolExecutionContext` com `db: getDb()` (NUNCA `getServiceDb()`).
 *   6. Invocar `executeAtomic(tools, ctx)` — toda a lógica transaccional da 2.3.
 *   7. Retornar resultado directamente — preserva `reverseOpId` para Story 2.8 undo.
 *
 * `D13`: Executor delega `ToolError` da 2.3. Única excepção criada aqui é
 * `ExecutorValidationError` para input parsing.
 */
import { logger } from '@meu-jarvis/observability';
import {
  executeAtomic,
  toolRegistry,
  ToolNotFoundError,
  type AtomicFailure,
  type AtomicResult,
  type AtomicToolInput,
  type AtomicOutcome,
  type DrizzleDbClient,
  type ToolDefinition,
  type ToolExecutionContext,
  type ToolRegistry,
} from '@meu-jarvis/tools';

import { ExecutorValidationError } from './errors';
import {
  ExecutorInputSchema,
  type ExecutorInput,
  type PlanToolCall,
} from './schemas';
import {
  annotateExecutorMetrics,
  withExecutorSpan,
} from './tracing';

// ─────────────────────────────────────────────────────────────────────────────
// Configuração
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Resolver do cliente Drizzle — em produção é `getDb()` de `@meu-jarvis/db`,
 * em testes é mock injectado via `opts.dbResolver`.
 *
 * **Nunca** retorna `getServiceDb()` (NFR5 — viola RLS).
 */
export type DbResolver = () => DrizzleDbClient;

export interface ExecutorOpts {
  /** Override do registry para testes — em produção usa singleton `toolRegistry`. */
  readonly registry?: ToolRegistry;
  /**
   * Resolver do cliente DB. Em produção: `() => getDb()` da 2.x. Em testes:
   * mock que retorna `DrizzleDbClient` mockado.
   *
   * Default: lança erro construtivo se invocado sem mock — força o caller a
   * fornecer explicitamente em testes (sem fallback silencioso para serviço).
   */
  readonly dbResolver?: DbResolver;
}

// ─────────────────────────────────────────────────────────────────────────────
// Classe Executor
// ─────────────────────────────────────────────────────────────────────────────

export class Executor {
  private readonly registry: ToolRegistry;
  private readonly dbResolver: DbResolver;

  constructor(opts: ExecutorOpts = {}) {
    this.registry = opts.registry ?? toolRegistry;
    this.dbResolver = opts.dbResolver ?? defaultDbResolver;
  }

  /**
   * Executa um `PlanResult` atomicamente (delegado a `executeAtomic` da 2.3).
   *
   * @param input - ExecutorInput com plan + ctx (household/user/run/trace).
   * @returns AtomicResult (sucesso) ou AtomicFailure (rollback controlado).
   * @throws {ExecutorValidationError} input estruturalmente inválido
   * @throws {ToolError} excepções não-controladas de `executeAtomic`
   */
  async execute(input: ExecutorInput): Promise<AtomicOutcome> {
    return withExecutorSpan(async (span) => {
      const start = Date.now();
      const validated = this.validateInput(input);
      const toolCalls = validated.plan.toolCalls;

      // Step 2: Early-return para plan vazio (degenerate case unknown)
      if (toolCalls.length === 0) {
        const result: AtomicResult = { success: true, results: [] };
        annotateExecutorMetrics(span, {
          toolCount: 0,
          durationMs: Date.now() - start,
          success: true,
          rolledBack: false,
          reverseOpCount: 0,
          runId: validated.runId,
          householdId: validated.householdId,
        });
        return result;
      }

      // Step 3: Defense-in-depth — validar tool names ANTES de abrir tx (D8)
      const definitions = this.resolveDefinitions(toolCalls);
      if (!definitions.success) {
        annotateExecutorMetrics(span, {
          toolCount: toolCalls.length,
          durationMs: Date.now() - start,
          success: false,
          rolledBack: false,
          failedToolName: definitions.failedToolName,
          reverseOpCount: 0,
          runId: validated.runId,
          householdId: validated.householdId,
        });
        return definitions.failure;
      }

      // Step 4-5: Construir AtomicToolInput[] e ToolExecutionContext
      const atomicInputs: AtomicToolInput[] = toolCalls.map((call, idx) => ({
        definition: definitions.defs[idx]!,
        input: call.input,
      }));

      const ctx: ToolExecutionContext = {
        householdId: validated.householdId,
        userId: validated.userId,
        db: this.dbResolver(),
        traceId: validated.traceId,
        runId: validated.runId,
      };

      // Step 6: Delegar a executeAtomic da 2.3
      const outcome = await executeAtomic(atomicInputs, ctx);

      // Step 7: Anotar span e retornar
      annotateExecutorMetrics(span, {
        toolCount: toolCalls.length,
        durationMs: Date.now() - start,
        success: outcome.success,
        rolledBack: outcome.success ? false : outcome.rolledBack,
        failedToolName: outcome.success ? undefined : outcome.failedToolName,
        reverseOpCount: outcome.success ? outcome.results.length : 0,
        runId: validated.runId,
        householdId: validated.householdId,
      });
      return outcome;
    });
  }

  // ───────────────────────────────────────────────────────────────────────────
  // Internals
  // ───────────────────────────────────────────────────────────────────────────

  private validateInput(input: ExecutorInput): ExecutorInput {
    const parsed = ExecutorInputSchema.safeParse(input);
    if (!parsed.success) {
      const issue = parsed.error.issues[0];
      throw new ExecutorValidationError(
        issue?.path.join('.') ?? 'unknown',
        issue?.message ?? 'ExecutorInputSchema parse failed',
      );
    }
    return parsed.data;
  }

  /**
   * Defense-in-depth: resolve cada tool name contra registry ANTES de abrir
   * transacção. Falha rápida sem custo Postgres.
   */
  private resolveDefinitions(toolCalls: ReadonlyArray<PlanToolCall>):
    | { success: true; defs: ToolDefinition<unknown, unknown>[] }
    | { success: false; failedToolName: string; failure: AtomicFailure } {
    const defs: ToolDefinition<unknown, unknown>[] = [];
    for (const call of toolCalls) {
      try {
        defs.push(this.registry.get(call.toolName));
      } catch (err) {
        if (err instanceof ToolNotFoundError) {
          logger.warn({ toolName: call.toolName }, 'Executor defense-in-depth: tool name não encontrada no registry');
          return {
            success: false,
            failedToolName: call.toolName,
            failure: {
              success: false,
              failedToolName: call.toolName,
              error: err,
              rolledBack: true,
            },
          };
        }
        throw err;
      }
    }
    return { success: true, defs };
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Default DB resolver
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Default dbResolver — em produção retorna `getDb()` de `@meu-jarvis/db`.
 *
 * Para evitar coupling cross-package em testes (paths aliases não resolvíveis),
 * o caller em produção deve fornecer explicitamente:
 *
 * ```ts
 * import { getDb } from '@meu-jarvis/db';
 * const executor = new Executor({ dbResolver: () => getDb() });
 * ```
 *
 * Se invocado sem override, lança erro construtivo (NUNCA retorna service_role
 * silenciosamente — viola NFR5).
 */
function defaultDbResolver(): DrizzleDbClient {
  throw new Error(
    'Executor: dbResolver não foi fornecido no constructor. ' +
      'Em produção: new Executor({ dbResolver: () => getDb() }). ' +
      'Em testes: forneça mock DrizzleDbClient. NUNCA usar getServiceDb() (NFR5 RLS).',
  );
}
