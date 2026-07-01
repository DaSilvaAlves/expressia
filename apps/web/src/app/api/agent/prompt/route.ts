/**
 * POST /api/agent/prompt — Consumidor canónico do pipeline AI multi-intent.
 *
 * Story 2.6 — Endpoint que orquestra Classifier (2.4) → Planner (2.5) →
 * Executor (2.5). A partir da Story J-2 este handler é um **wrapper fino**:
 *   - Resolve `{ userId, householdId }` via Supabase Auth (sem alterar a lógica
 *     de auth actual).
 *   - Delega o pipeline completo em `runAgentForHousehold` (@/lib/agent/run-agent).
 *   - Mapeia o `AgentRunOutcome` (camelCase) para a resposta HTTP snake_case
 *     actual (`run_id`, `undo_url`, `undo_expires_at`, `results`, ...).
 *   - Gere os headers HTTP (Idempotency-Key, 4xx/5xx, OTel span) e a redacção
 *     de output (NFR12).
 *
 * O comportamento externo do endpoint é IDÊNTICO ao anterior (regressão zero).
 *
 * Garantias preservadas:
 *   - RLS multi-tenant (AC2, NFR5) — via withHousehold dentro de runAgentForHousehold
 *   - FR4 preview-then-confirm (confidence < 0.70) (AC4)
 *   - FR2 atomicidade Postgres via executeAtomic (AC5)
 *   - NFR9 idempotency 24h (AC8, D19)
 *   - Rate limit 10/min Postgres + quota mensal (AC9, D17/D18)
 *   - FR3 audit log em agent_runs (AC10)
 *   - NFR12 PII redaction defense-in-depth 4ª camada (AC11, D25)
 *   - NFR17 OTel + Sentry (AC12)
 *   - Taxonomia errors HTTP 400/401/409/429/500 (AC13)
 *
 * Trace: Story 2.6 AC1-AC16 + Story J-2 AC5, Architecture §4.1 + §4.4 + §4.5.
 */
import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';
import type { Span } from '@opentelemetry/api';

import { createServerSupabaseClient } from '@meu-jarvis/auth/server';
import { ClassifierError } from '@meu-jarvis/classifier';
import {
  PlannerError,
  ExecutorValidationError,
  ToolPlanGateError,
  ToolError,
} from '@meu-jarvis/planner-executor';
import {
  childLogger,
  captureException,
} from '@meu-jarvis/observability';

import { apiError } from '@/lib/errors';
import { RateLimitError, QuotaExceededError } from '@/lib/agent/rate-limiter';
import { redactEndpointOutput, sentrySafeContext } from '@/lib/agent/redaction';
import {
  runAgentForHousehold,
  AtomicExecutionError,
  type AgentRunOutcome,
} from '@/lib/agent/run-agent';
import type { IdempotentRunSnapshot } from '@/lib/agent/idempotency';
import {
  withAgentPromptSpan,
  annotateAgentPromptSpan,
} from '@/lib/agent/tracing';

/**
 * Zod schema do body — `prompt` string non-empty, ≤ 2000 chars.
 */
const PromptBodySchema = z.object({
  prompt: z.string().min(1).max(2000),
});

const ROUTE = '/api/agent/prompt';

/**
 * Resolve current_household_id a partir do membership do user.
 *
 * RLS via JWT requer `request.jwt.claims.household_id` populado pelo Supabase
 * Auth Hook (migration 0002). Validamos defensivamente que o user tem um
 * household activo antes de prosseguir.
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

      const idempotencyKey = req.headers.get('Idempotency-Key');

      // ─── 3. Delegar pipeline em runAgentForHousehold ──────────────
      let outcome: AgentRunOutcome;
      try {
        outcome = await runAgentForHousehold({
          userId: user.id,
          householdId,
          prompt: body.prompt,
          idempotencyKey,
        });
      } catch (err) {
        return mapPipelineError(err, span, householdId, log);
      }

      // ─── 4. Mapear outcome → resposta HTTP (snake_case) ───────────
      return mapOutcomeToResponse(outcome, span, householdId, log);
    },
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Mapeamento outcome → NextResponse (snake_case, redaction, headers)
// ─────────────────────────────────────────────────────────────────────────────

function mapOutcomeToResponse(
  outcome: AgentRunOutcome,
  span: Span,
  householdId: string,
  log: ReturnType<typeof childLogger>,
): NextResponse {
  switch (outcome.status) {
    case 'replay': {
      annotateAgentPromptSpan(span, { status_code: 200 });
      log.info({ run_id: outcome.run.id, replay: true }, 'Idempotent replay servido');
      return NextResponse.json(buildReplayResponse(outcome.run, householdId), {
        status: 200,
        headers: { 'X-Idempotent-Replay': 'true' },
      });
    }

    case 'idempotency_in_progress':
      annotateAgentPromptSpan(span, { status_code: 409 });
      return apiError(
        'IDEMPOTENCY_IN_PROGRESS',
        'Pedido idempotente em curso. Aguarde a conclusão antes de retentar.',
        409,
        { run_id: outcome.runId },
      );

    case 'rate_limited': {
      annotateAgentPromptSpan(span, { status_code: 429 });
      const err = outcome.error as RateLimitError;
      return apiError('RATE_LIMIT_EXCEEDED', err.message, 429, {
        retry_after_seconds: err.retryAfterSeconds,
        limit: err.limit,
        current: err.currentCount,
      });
    }

    case 'quota_exceeded': {
      annotateAgentPromptSpan(span, { status_code: 429 });
      const err = outcome.error as QuotaExceededError;
      const secondsUntilReset = Math.max(
        1,
        Math.ceil((err.periodEnd.getTime() - Date.now()) / 1000),
      );
      const errResponse = apiError('QUOTA_EXCEEDED', err.message, 429, {
        plan: err.plan,
        used: err.used,
        limit: err.limit,
        period_end: err.periodEnd.toISOString(),
      });
      errResponse.headers.set('X-Quota-Reset', err.periodEnd.toISOString());
      errResponse.headers.set('Retry-After', String(secondsUntilReset));
      return errResponse;
    }

    case 'preview': {
      annotateAgentPromptSpan(span, { mode: 'preview', status_code: 200 });
      log.info({ run_id: outcome.runId, mode: 'preview' }, 'Preview mode');
      return NextResponse.json({
        mode: 'preview' as const,
        run_id: outcome.runId,
        plan_summary: outcome.planSummary,
        confidence: outcome.confidence,
        confirmation_url: `/api/agent/prompt/${outcome.runId}/confirm`,
        expires_at: outcome.expiresAt,
      });
    }

    case 'executed': {
      annotateAgentPromptSpan(span, { mode: 'executed', status_code: 200 });
      if (outcome.kind === 'direct_query') {
        // Response shape direct-DB: sem undo_url/undo_expires_at (read-only — DN9).
        const directResponseBody = {
          mode: 'executed' as const,
          run_id: outcome.runId,
          results: {
            success: true,
            kind: 'direct_query',
            template_used: outcome.directResult.templateUsed,
            data: outcome.directResult.data,
          },
          summary: outcome.summary,
        };
        return NextResponse.json(redactEndpointOutput(directResponseBody));
      }

      if (outcome.readOnly) {
        // Pipeline read-only (consultar_emails, listar_tarefas, ...) — devolve os
        // resultados mas SEM undo_url (reverter uma leitura não faz sentido). O
        // ResultMessage lida com `undo_url` ausente (compat Story 2.8 D40).
        const readResponseBody = {
          mode: 'executed' as const,
          run_id: outcome.runId,
          results: outcome.results,
          summary: outcome.summary,
        };
        return NextResponse.json(redactEndpointOutput(readResponseBody));
      }

      const responseBody = {
        mode: 'executed' as const,
        run_id: outcome.runId,
        results: outcome.results,
        summary: outcome.summary,
        undo_url: `/api/agent/prompt/${outcome.runId}/undo`,
        undo_expires_at: outcome.undoExpiresAt,
      };
      return NextResponse.json(redactEndpointOutput(responseBody));
    }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Mapeamento de erros do pipeline → NextResponse (taxonomia AC13)
// ─────────────────────────────────────────────────────────────────────────────

function mapPipelineError(
  err: unknown,
  span: Span,
  householdId: string,
  log: ReturnType<typeof childLogger>,
): NextResponse {
  const runId = err instanceof Error ? (err as Error & { runId?: string }).runId : undefined;

  // Rate-limit/quota podem ser lançados (não via outcome) caso a importação
  // dinâmica falhe — defensivo, mantém o contrato 429.
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
    return apiError('QUOTA_EXCEEDED', err.message, 429);
  }

  if (err instanceof ClassifierError) {
    log.warn({ error_code: 'CLASSIFIER_ERROR', err_message: err.message }, 'Classifier error');
    captureException(err, { ...sentrySafeContext({ route: ROUTE, householdId, runId }) });
    annotateAgentPromptSpan(span, { status_code: 400 });
    return apiError('CLASSIFIER_ERROR', err.message, 400, { run_id: runId });
  }
  if (err instanceof ToolPlanGateError) {
    log.warn({ error_code: 'TOOL_PLAN_GATE_ERROR', err_message: err.message }, 'Tool plan gate rejeitou plan');
    captureException(err, { ...sentrySafeContext({ route: ROUTE, householdId, runId }) });
    annotateAgentPromptSpan(span, { status_code: 400 });
    return apiError('TOOL_PLAN_GATE_ERROR', err.message, 400, { run_id: runId });
  }
  if (err instanceof ExecutorValidationError) {
    log.warn({ error_code: 'EXECUTOR_VALIDATION_ERROR', err_message: err.message }, 'Executor validation error');
    captureException(err, { ...sentrySafeContext({ route: ROUTE, householdId, runId }) });
    annotateAgentPromptSpan(span, { status_code: 400 });
    return apiError('EXECUTOR_VALIDATION_ERROR', err.message, 400, { run_id: runId });
  }
  if (err instanceof PlannerError) {
    log.warn({ error_code: 'PLANNER_ERROR', err_message: err.message }, 'Planner error');
    captureException(err, { ...sentrySafeContext({ route: ROUTE, householdId, runId }) });
    annotateAgentPromptSpan(span, { status_code: 400 });
    return apiError('PLANNER_ERROR', err.message, 400, { run_id: runId });
  }
  if (err instanceof ToolError) {
    log.error({ error_code: 'TOOL_EXECUTION_ERROR', err_message: err.message }, 'Tool execution error');
    captureException(err, { ...sentrySafeContext({ route: ROUTE, householdId, runId }) });
    annotateAgentPromptSpan(span, { status_code: 500 });
    return apiError('TOOL_EXECUTION_ERROR', err.message, 500, { run_id: runId });
  }
  if (err instanceof AtomicExecutionError) {
    // Rollback graceful (executor devolveu success:false).
    annotateAgentPromptSpan(span, { mode: 'executed', status_code: 500 });
    return apiError('TOOL_EXECUTION_ERROR', err.message, 500, {
      run_id: err.runId,
      failed_tool: err.failedToolName,
    });
  }

  log.error({ err }, 'Pipeline crashed inesperadamente');
  captureException(err instanceof Error ? err : new Error(String(err)), {
    ...sentrySafeContext({ route: ROUTE, householdId, runId }),
  });
  annotateAgentPromptSpan(span, { status_code: 500 });
  return apiError('INTERNAL_ERROR', 'Erro interno ao executar pipeline.', 500, { run_id: runId });
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
