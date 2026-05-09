/**
 * POST /api/agent/prompt — Consumidor canónico do pipeline AI multi-intent.
 *
 * Story 2.6 — Endpoint que orquestra Classifier (2.4) → Planner (2.5) →
 * Executor (2.5) com:
 *   - RLS multi-tenant via getDb() role authenticated (AC2, NFR5)
 *   - FR4 preview-then-confirm (confidence < 0.70) (AC4)
 *   - FR2 atomicidade Postgres via executeAtomic (AC5)
 *   - NFR9 idempotency 24h (AC8, D19)
 *   - Rate limit 10/min Postgres + quota mensal (AC9, D17/D18)
 *   - FR3 audit log em agent_runs (AC10)
 *   - NFR12 PII redaction defense-in-depth 4ª camada (AC11, D25)
 *   - NFR17 OTel + Sentry (AC12)
 *   - Taxonomia errors HTTP 400/401/409/429/500 (AC13)
 *
 * Path normalization (DEV-DECISION-D21):
 *   Story usa path nested `/api/agent/prompt/[runId]/{confirm|undo}` para
 *   co-localização. Architecture §1.3 + §4.5 usam path flat
 *   `/api/agent/undo/{runId}`. @architect ratifica no gate. Decisão @dev:
 *   nested REST mantém-se — Next.js App Router é mais idiomático com
 *   `[runId]` dynamic segment co-localizado no feature directory; flat
 *   path seria refactor mecânico se architect rejeitar (move directory +
 *   ajustar imports). Justificação: idem D21 do @sm.
 *
 * Trace: Story 2.6 AC1-AC16, Architecture §4.1 + §4.4 + §4.5 + §7.1 + §7.2.
 */
import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';

import { createServerSupabaseClient } from '@meu-jarvis/auth/server';
import { Classifier, ClassifierError, type ClassificationResult } from '@meu-jarvis/classifier';
import { getDb } from '@/lib/agent/db-shim';
import {
  childLogger,
  hashForCorrelation,
  captureException,
} from '@meu-jarvis/observability';
import {
  Executor,
  Planner,
  PlannerError,
  ExecutorValidationError,
  ToolPlanGateError,
  ToolError,
  type AtomicOutcome,
  type AtomicResult,
  type PlanResult,
} from '@meu-jarvis/planner-executor';
import type { OpenAIClientLike } from '@meu-jarvis/agent';

import { apiError } from '@/lib/errors';
import {
  insertAgentRun,
  updateAfterClassifier,
  updateAfterPlanner,
  updateAfterExecutor,
  updatePreviewState,
  incrementQuota,
} from '@/lib/agent/audit-log';
import { lookupIdempotentRun } from '@/lib/agent/idempotency';
import {
  checkRateLimit,
  checkQuota,
  RateLimitError,
  QuotaExceededError,
} from '@/lib/agent/rate-limiter';
import {
  hashPrompt,
  redactEndpointOutput,
  sentrySafeContext,
} from '@/lib/agent/redaction';
import type { IdempotentRunSnapshot } from '@/lib/agent/idempotency';
import {
  withAgentPromptSpan,
  annotateAgentPromptSpan,
} from '@/lib/agent/tracing';

/**
 * Zod schema do body — `prompt` string non-empty, ≤ 2000 chars.
 * Architecture §7.1 (Route Handlers para endpoints contractuais).
 */
const PromptBodySchema = z.object({
  prompt: z.string().min(1).max(2000),
});

const ROUTE = '/api/agent/prompt';

/**
 * Resolve current_household_id a partir do membership do user.
 *
 * RLS via JWT requer `request.jwt.claims.household_id` populado pelo
 * Supabase Auth Hook (migration 0002). Aqui validamos defensivamente que
 * o user tem um household activo antes de prosseguir.
 */
async function resolveHouseholdId(userId: string): Promise<string | null> {
  const supabase = await createServerSupabaseClient();
  const { data, error } = await supabase
    .from('household_members')
    .select('household_id')
    .eq('user_id', userId)
    .limit(1)
    .maybeSingle<{ household_id: string }>();

  if (error || !data) {
    return null;
  }
  return data.household_id;
}

/**
 * POST /api/agent/prompt
 *
 * Body: `{ prompt: string }` (1-2000 chars)
 * Headers: `Idempotency-Key` (UUID, opcional)
 *
 * Responses:
 *   - 200 `{ mode: 'executed', run_id, results, summary, undo_url, undo_expires_at }`
 *   - 200 `{ mode: 'preview',  run_id, plan_summary, confidence, confirmation_url, expires_at }`
 *   - 400 ClassifierError | PlannerError | ExecutorValidationError | ToolPlanGateError | ZodError
 *   - 401 AUTH_REQUIRED
 *   - 409 IDEMPOTENCY_IN_PROGRESS
 *   - 429 RATE_LIMIT_EXCEEDED | QUOTA_EXCEEDED
 *   - 500 ToolError | INTERNAL_ERROR
 */
export async function POST(req: NextRequest): Promise<NextResponse> {
  return withAgentPromptSpan(
    'POST /api/agent/prompt',
    { method: 'POST', route: ROUTE },
    async (span): Promise<NextResponse> => {
      const log = childLogger({ route: ROUTE, method: 'POST' });
      const startedAt = Date.now();

      // ─── 1. Auth ──────────────────────────────────────────────────
      const supabase = await createServerSupabaseClient();
      const {
        data: { user },
        error: authError,
      } = await supabase.auth.getUser();

      if (authError || !user) {
        annotateAgentPromptSpan(span, { status_code: 401 });
        return apiError(
          'AUTH_REQUIRED',
          'Sessão inválida ou expirada. Por favor inicie sessão novamente.',
          401,
        );
      }

      const householdId = await resolveHouseholdId(user.id);
      if (!householdId) {
        annotateAgentPromptSpan(span, { status_code: 404 });
        return apiError(
          'HOUSEHOLD_NOT_FOUND',
          'Household não encontrado. Por favor complete o registo.',
          404,
        );
      }

      annotateAgentPromptSpan(span, { household_id: householdId });

      // ─── 2. Body validation ───────────────────────────────────────
      let body: { prompt: string };
      try {
        const raw = await req.json();
        body = PromptBodySchema.parse(raw);
      } catch (err: unknown) {
        annotateAgentPromptSpan(span, { status_code: 400 });
        if (err instanceof z.ZodError) {
          return apiError('VALIDATION_ERROR', 'Body inválido — campo `prompt` obrigatório (1-2000 caracteres).', 400, {
            issues: err.issues.map((i: z.ZodIssue) => ({ path: i.path as unknown[], message: i.message })),
          });
        }
        return apiError('VALIDATION_ERROR', 'Body inválido — JSON malformado.', 400);
      }

      const db = getDb();
      const traceId = `${Date.now()}-${user.id.slice(0, 8)}`;
      const promptHash = hashPrompt(body.prompt);
      const idempotencyKey = req.headers.get('Idempotency-Key');

      // ─── 3. Idempotency lookup ────────────────────────────────────
      try {
        const verdict = await lookupIdempotentRun(idempotencyKey ?? undefined, householdId, db);
        if (verdict.kind === 'replay') {
          annotateAgentPromptSpan(span, { status_code: 200 });
          log.info(
            { user_hash: hashForCorrelation(user.id), run_id: verdict.run.id, replay: true },
            'Idempotent replay servido',
          );
          return NextResponse.json(
            buildReplayResponse(verdict.run, householdId),
            { status: 200, headers: { 'X-Idempotent-Replay': 'true' } },
          );
        }
        if (verdict.kind === 'in_progress') {
          annotateAgentPromptSpan(span, { status_code: 409 });
          return apiError(
            'IDEMPOTENCY_IN_PROGRESS',
            'Pedido idempotente em curso. Aguarde a conclusão antes de retentar.',
            409,
            { run_id: verdict.run.id },
          );
        }
      } catch (err) {
        log.error({ err }, 'Idempotency lookup falhou — prosseguindo como new');
        // Não-fatal: prossegue sem replay (defensive)
      }

      // ─── 4. Rate limit + quota ────────────────────────────────────
      try {
        await checkRateLimit(householdId, db);
        await checkQuota(householdId, db);
      } catch (err) {
        if (err instanceof RateLimitError) {
          annotateAgentPromptSpan(span, { status_code: 429 });
          return apiError('RATE_LIMIT_EXCEEDED', err.message, 429, {
            retry_after_seconds: err.retryAfterSeconds,
            limit: err.limit,
            current: err.currentCount,
          });
        }
        if (err instanceof QuotaExceededError) {
          annotateAgentPromptSpan(span, { status_code: 429 });
          return apiError('QUOTA_EXCEEDED', err.message, 429, {
            plan: err.plan,
            used: err.used,
            limit: err.limit,
          });
        }
        throw err;
      }

      // ─── 5. INSERT agent_run inicial (audit log) ──────────────────
      const { runId } = await insertAgentRun(
        {
          householdId,
          userId: user.id,
          promptText: body.prompt,
          promptHash,
          traceId,
          idempotencyKey: idempotencyKey || null,
        },
        db,
      );

      // ─── 6. Classifier ────────────────────────────────────────────
      let classification: ClassificationResult;
      try {
        const classifier = createClassifier();
        classification = await classifier.classify({
          text: body.prompt,
          householdId,
          userId: user.id,
          traceId,
        });
        await updateAfterClassifier(
          runId,
          {
            intentsDetected: classification.intents,
            confidence: classification.overall_confidence,
            classifierModel: 'gpt-4o-mini',
          },
          db,
        );
      } catch (err) {
        return handleClassifierError(err, span, runId, householdId, db);
      }

      annotateAgentPromptSpan(span, {
        intent_class: classification.intents[0]?.intent,
        confidence_min: classification.overall_confidence,
      });

      // ─── 7. Branch FR4 — preview vs executed ──────────────────────
      if (classification.needs_confirmation) {
        const expiresAt = new Date(Date.now() + 5 * 60 * 1000); // 5min D20
        await updatePreviewState(runId, expiresAt, db);

        const planSummary = classification.intents.map((intent) =>
          `${intent.intent} (${(intent.confidence * 100).toFixed(0)}%)`,
        );

        annotateAgentPromptSpan(span, {
          mode: 'preview',
          status_code: 200,
          duration_ms: Date.now() - startedAt,
        });
        log.info(
          { run_id: runId, mode: 'preview', confidence: classification.overall_confidence },
          'Preview mode — aguarda confirmação 5min',
        );

        return NextResponse.json({
          mode: 'preview' as const,
          run_id: runId,
          plan_summary: planSummary,
          confidence: classification.overall_confidence,
          confirmation_url: `/api/agent/prompt/${runId}/confirm`,
          expires_at: expiresAt.toISOString(),
        });
      }

      // ─── 8. Planner + Executor (executed branch) ──────────────────
      let plan: PlanResult;
      let outcome: AtomicOutcome;
      try {
        const planner = new Planner();
        plan = await planner.plan({
          classification,
          householdId,
          userId: user.id,
          traceId,
          runId,
        });
        await updateAfterPlanner(
          runId,
          {
            toolCalls: plan.toolCalls,
            executorModel: 'claude-sonnet-4-5',
            tokensInput: plan.tokensInput,
            tokensOutput: plan.tokensOutput,
            costEur: plan.costEur,
          },
          db,
        );

        const executor = new Executor({ dbResolver: () => db });
        outcome = await executor.execute({
          plan,
          householdId,
          userId: user.id,
          traceId,
          runId,
        });
      } catch (err) {
        return handlePlannerExecutorError(err, span, runId, householdId, db);
      }

      // ─── 9. Resposta executed (sucesso ou rollback graceful) ──────
      const latencyMs = Date.now() - startedAt;
      if (outcome.success === false) {
        const failure = outcome;
        await updateAfterExecutor(
          runId,
          {
            status: 'failed',
            latencyMs,
            responseSummary: null,
            errorCode: failure.error?.constructor?.name ?? 'EXECUTION_FAILED',
            errorMessage: failure.error?.message ?? 'Execução falhou — rollback completo aplicado',
          },
          db,
        );
        annotateAgentPromptSpan(span, {
          mode: 'executed',
          tool_count: plan.toolCalls.length,
          duration_ms: latencyMs,
          status_code: 500,
        });
        return apiError(
          'TOOL_EXECUTION_ERROR',
          failure.error?.message ?? 'Execução falhou — operação revertida.',
          500,
          { run_id: runId, failed_tool: failure.failedToolName },
        );
      }

      // Success path
      const summary = buildSummaryText(outcome);
      await updateAfterExecutor(
        runId,
        {
          status: 'success',
          latencyMs,
          responseSummary: summary,
          errorCode: null,
          errorMessage: null,
        },
        db,
      );

      // Increment quota (não-fatal se falhar)
      try {
        await incrementQuota(householdId, db);
      } catch (err) {
        log.warn({ err }, 'incrementQuota falhou (não-fatal)');
      }

      annotateAgentPromptSpan(span, {
        mode: 'executed',
        tool_count: plan.toolCalls.length,
        duration_ms: latencyMs,
        cache_hit: plan.cacheHit,
        status_code: 200,
        classifier_model: 'gpt-4o-mini',
        executor_model: 'claude-sonnet-4-5',
      });

      const undoExpiresAt = new Date(Date.now() + 30 * 1000); // 30s FR6
      const responseBody = {
        mode: 'executed' as const,
        run_id: runId,
        results: outcome,
        summary,
        undo_url: `/api/agent/prompt/${runId}/undo`,
        undo_expires_at: undoExpiresAt.toISOString(),
      };

      // Layer 4b — output redaction antes de serializar response
      return NextResponse.json(redactEndpointOutput(responseBody));
    },
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Helpers — error handling + summary building
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Mapeia errors do Classifier para HTTP responses (AC13).
 * Sempre actualiza `agent_runs.status='failed'` antes de retornar.
 */
async function handleClassifierError(
  err: unknown,
  span: { setAttribute: (k: string, v: string | number | boolean) => void },
  runId: string,
  householdId: string,
  db: ReturnType<typeof getDb>,
): Promise<NextResponse> {
  const log = childLogger({ route: ROUTE, run_id: runId });
  if (err instanceof ClassifierError) {
    await updateAfterExecutor(
      runId,
      {
        status: 'failed',
        latencyMs: 0,
        responseSummary: null,
        errorCode: 'CLASSIFIER_ERROR',
        errorMessage: err.message,
      },
      db,
    );
    log.warn({ err_class: err.constructor.name }, 'Classifier error');
    captureException(err, { ...sentrySafeContext({ route: ROUTE, householdId, runId }) });
    span.setAttribute('agent.prompt.status_code', 400);
    return apiError('CLASSIFIER_ERROR', err.message, 400, { run_id: runId });
  }
  log.error({ err }, 'Classifier crashed inesperadamente');
  captureException(err instanceof Error ? err : new Error(String(err)), {
    ...sentrySafeContext({ route: ROUTE, householdId, runId }),
  });
  await updateAfterExecutor(
    runId,
    {
      status: 'failed',
      latencyMs: 0,
      responseSummary: null,
      errorCode: 'INTERNAL_ERROR',
      errorMessage: 'Classifier crashed',
    },
    db,
  );
  span.setAttribute('agent.prompt.status_code', 500);
  return apiError('INTERNAL_ERROR', 'Erro interno ao classificar prompt.', 500, { run_id: runId });
}

/**
 * Mapeia errors do Planner+Executor para HTTP responses (AC13).
 */
async function handlePlannerExecutorError(
  err: unknown,
  span: { setAttribute: (k: string, v: string | number | boolean) => void },
  runId: string,
  householdId: string,
  db: ReturnType<typeof getDb>,
): Promise<NextResponse> {
  const log = childLogger({ route: ROUTE, run_id: runId });
  const failUpdate = (errorCode: string, errorMessage: string): Promise<void> =>
    updateAfterExecutor(
      runId,
      { status: 'failed', latencyMs: 0, responseSummary: null, errorCode, errorMessage },
      db,
    );

  if (err instanceof ToolPlanGateError) {
    await failUpdate('TOOL_PLAN_GATE_ERROR', err.message);
    log.warn({ err_class: 'ToolPlanGateError' }, 'Tool plan gate rejeitou plan');
    captureException(err, { ...sentrySafeContext({ route: ROUTE, householdId, runId }) });
    span.setAttribute('agent.prompt.status_code', 400);
    return apiError('TOOL_PLAN_GATE_ERROR', err.message, 400, { run_id: runId });
  }
  if (err instanceof ExecutorValidationError) {
    await failUpdate('EXECUTOR_VALIDATION_ERROR', err.message);
    captureException(err, { ...sentrySafeContext({ route: ROUTE, householdId, runId }) });
    span.setAttribute('agent.prompt.status_code', 400);
    return apiError('EXECUTOR_VALIDATION_ERROR', err.message, 400, { run_id: runId });
  }
  if (err instanceof PlannerError) {
    await failUpdate('PLANNER_ERROR', err.message);
    log.warn({ err_class: err.constructor.name }, 'Planner error');
    captureException(err, { ...sentrySafeContext({ route: ROUTE, householdId, runId }) });
    span.setAttribute('agent.prompt.status_code', 400);
    return apiError('PLANNER_ERROR', err.message, 400, { run_id: runId });
  }
  if (err instanceof ToolError) {
    await failUpdate('TOOL_EXECUTION_ERROR', err.message);
    log.error({ err_class: err.constructor.name }, 'Tool execution error');
    captureException(err, { ...sentrySafeContext({ route: ROUTE, householdId, runId }) });
    span.setAttribute('agent.prompt.status_code', 500);
    return apiError('TOOL_EXECUTION_ERROR', err.message, 500, { run_id: runId });
  }

  log.error({ err }, 'Pipeline crashed inesperadamente');
  captureException(err instanceof Error ? err : new Error(String(err)), {
    ...sentrySafeContext({ route: ROUTE, householdId, runId }),
  });
  await failUpdate('INTERNAL_ERROR', err instanceof Error ? err.message : 'Unknown error');
  span.setAttribute('agent.prompt.status_code', 500);
  return apiError('INTERNAL_ERROR', 'Erro interno ao executar pipeline.', 500, { run_id: runId });
}

/**
 * Cria instância do `Classifier` para produção.
 *
 * Em produção, instancia OpenAI SDK directamente. Em testes, este helper é
 * mockado via `vi.mock('@meu-jarvis/classifier')`. Lazy require para evitar
 * resolver `openai` em testes mocked.
 */
function createClassifier(): Classifier {
  // eslint-disable-next-line @typescript-eslint/no-var-requires, @typescript-eslint/no-require-imports
  const OpenAIModule = require('openai');
  const OpenAICtor = OpenAIModule.default ?? OpenAIModule.OpenAI;
  const client = new OpenAICtor({
    apiKey: process.env.OPENAI_API_KEY ?? 'unset',
  }) as OpenAIClientLike;
  return new Classifier(client);
}

/**
 * Constrói summary PT-PT do `AtomicResult` (sucesso).
 */
function buildSummaryText(outcome: AtomicOutcome): string {
  if (outcome.success === false) {
    return 'Operação falhou — rollback completo aplicado.';
  }
  const result = outcome as AtomicResult;
  const count = result.results?.length ?? 0;
  if (count === 0) {
    return 'Nada a executar — pedido reconhecido mas sem ações concretas.';
  }
  return `Executei ${count} operação(ões) com sucesso. Tens 30 segundos para reverter.`;
}

/**
 * Constrói response cached para idempotency replay (AC8).
 */
function buildReplayResponse(
  run: IdempotentRunSnapshot,
  _householdId: string,
): unknown {
  if (run.status === 'pending_preview') {
    return {
      mode: 'preview' as const,
      run_id: run.id,
      plan_summary: Array.isArray(run.intentsDetected)
        ? (run.intentsDetected as Array<{ intent?: string; confidence?: number }>).map(
            (i) => `${i.intent ?? 'unknown'} (${((i.confidence ?? 0) * 100).toFixed(0)}%)`,
          )
        : [],
      confidence: Number(run.confidence),
      confirmation_url: `/api/agent/prompt/${run.id}/confirm`,
      expires_at: run.confirmExpiresAt?.toISOString() ?? null,
    };
  }
  if (run.status === 'success') {
    return {
      mode: 'executed' as const,
      run_id: run.id,
      results: { success: true, results: run.toolCalls ?? [] },
      summary: run.responseSummary ?? '',
      undo_url: `/api/agent/prompt/${run.id}/undo`,
      undo_expires_at: null, // janela 30s já passou em replays — caller verifica
    };
  }
  // failed | reverted
  return {
    mode: 'executed' as const,
    run_id: run.id,
    error: run.errorCode,
    error_message: run.errorMessage,
    status: run.status,
  };
}
