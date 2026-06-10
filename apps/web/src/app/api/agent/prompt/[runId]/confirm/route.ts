/**
 * POST /api/agent/prompt/[runId]/confirm — Confirm endpoint (FR4 D20).
 *
 * Story 2.6 AC6 — utilizador confirma execução de uma run em
 * `status='pending_preview'` dentro da janela de 5min (D20). Re-executa
 * Planner+Executor com a `classification` JSONB persistida (evita re-chamar
 * Classifier — economiza tokens GPT-4o-mini + latência).
 *
 * Validações:
 *   - SEC-1-F3: pertença do utilizador autenticado ao `run.household_id`
 *     verificada app-enforced (a RLS está inerte em runtime — `getDb()` liga
 *     como role bypassrls). Sem este filtro, um membro do household B com um
 *     `runId` do household A executaria mutações reais do household A.
 *   - status == 'pending_preview'
 *   - now() < confirm_expires_at
 *
 * Erros:
 *   - 401 AUTH_REQUIRED
 *   - 404 RUN_NOT_FOUND (cross-household ou inexistente — 404 não revela existência)
 *   - 409 CONFIRM_EXPIRED (TTL passou)
 *   - 409 CONFIRM_INVALID_STATE (status != pending_preview)
 *
 * Trace: Story 2.6 AC6 + D20, FR4, Architecture §4.4.
 */
import { sql } from 'drizzle-orm';
import { NextResponse, type NextRequest } from 'next/server';

import { CLAUDE_HAIKU_MODEL_ENUM } from '@meu-jarvis/agent';
import { createServerSupabaseClient } from '@meu-jarvis/auth/server';
import {
  ClassificationSchema,
  type ClassificationResult,
} from '@meu-jarvis/classifier';
import { getDb, withHousehold } from '@/lib/agent/db-shim';
import { resolveHouseholdId } from '@/lib/api-helpers/auth';
import {
  childLogger,
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

import { apiError } from '@/lib/errors';
import {
  updateAfterPlanner,
  updateAfterExecutor,
  incrementQuota,
} from '@/lib/agent/audit-log';
import { redactEndpointOutput, sentrySafeContext } from '@/lib/agent/redaction';
import {
  withAgentPromptSpan,
  annotateAgentPromptSpan,
} from '@/lib/agent/tracing';

const ROUTE_TEMPLATE = '/api/agent/prompt/[runId]/confirm';

interface PendingPreviewRow extends Record<string, unknown> {
  readonly id: string;
  readonly household_id: string;
  readonly user_id: string;
  readonly status: string;
  readonly confirm_expires_at: string | null;
  readonly intents_detected: unknown;
  readonly trace_id: string | null;
}

export async function POST(
  req: NextRequest,
  ctx: { params: Promise<{ runId: string }> },
): Promise<NextResponse> {
  const { runId } = await ctx.params;

  return withAgentPromptSpan(
    'POST /api/agent/prompt/[runId]/confirm',
    { method: 'POST', route: ROUTE_TEMPLATE },
    async (span): Promise<NextResponse> => {
      const log = childLogger({ route: ROUTE_TEMPLATE, run_id: runId });

      // Auth
      const supabase = await createServerSupabaseClient();
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) {
        annotateAgentPromptSpan(span, { status_code: 401 });
        return apiError('AUTH_REQUIRED', 'Sessão inválida.', 401);
      }

      // SEC-1-F3: resolver o household do utilizador autenticado para isolar a
      // run por household app-enforced (RLS inerte em runtime). Sem household
      // activo → 404 (não revela se o run existe noutro household).
      const userHouseholdId = await resolveHouseholdId(user.id);
      if (!userHouseholdId) {
        annotateAgentPromptSpan(span, { status_code: 404 });
        return apiError('RUN_NOT_FOUND', 'Run não encontrado.', 404, { run_id: runId });
      }

      const db = getDb();

      // Lookup run em pending_preview — filtro household_id app-enforced
      // (SEC-1-F3): só o household dono do run o encontra; cross-household → 404.
      const rows = await db.execute<PendingPreviewRow>(sql`
        select id, household_id, user_id, status, confirm_expires_at,
               intents_detected, trace_id
        from agent_runs
        where id = ${runId}::uuid
          and household_id = ${userHouseholdId}::uuid
        limit 1
      `);

      if (rows.length === 0) {
        annotateAgentPromptSpan(span, { status_code: 404 });
        return apiError('RUN_NOT_FOUND', 'Run não encontrado.', 404, { run_id: runId });
      }

      const run = rows[0]!;
      annotateAgentPromptSpan(span, { household_id: run.household_id });

      // Validar estado
      if (run.status !== 'pending_preview') {
        annotateAgentPromptSpan(span, { status_code: 409 });
        return apiError(
          'CONFIRM_INVALID_STATE',
          `Run não está em estado de confirmação (status actual: ${run.status}).`,
          409,
          { run_id: runId, status: run.status },
        );
      }

      // Validar TTL
      const expiresAt = run.confirm_expires_at ? new Date(run.confirm_expires_at) : null;
      if (!expiresAt || expiresAt.getTime() < Date.now()) {
        annotateAgentPromptSpan(span, { status_code: 409 });
        return apiError(
          'CONFIRM_EXPIRED',
          'Janela de confirmação expirou (5 minutos). Faz novo prompt.',
          409,
          { run_id: runId, expires_at: expiresAt?.toISOString() ?? null },
        );
      }

      // Reconstituir classification do JSONB persistido
      let classification: ClassificationResult;
      try {
        // intents_detected guarda apenas o array de intents — reconstituir a
        // ClassificationResult full com os defaults.
        const intentsRaw = run.intents_detected as Array<{
          intent: string;
          confidence: number;
          raw_span?: string;
        }>;
        const minConfidence =
          Array.isArray(intentsRaw) && intentsRaw.length > 0
            ? Math.min(...intentsRaw.map((i) => Number(i.confidence ?? 0)))
            : 0;
        const reconstituted: ClassificationResult = {
          intents: intentsRaw.map((i) => ({
            intent: i.intent as ClassificationResult['intents'][number]['intent'],
            confidence: Number(i.confidence ?? 0),
            raw_span: i.raw_span ?? '',
          })),
          language: 'pt-PT',
          needs_confirmation: minConfidence < 0.7,
          overall_confidence: minConfidence,
        };
        classification = ClassificationSchema.parse(reconstituted);
      } catch (err) {
        log.error({ err }, 'Falha a reconstituir classification');
        captureException(err instanceof Error ? err : new Error(String(err)), {
          ...sentrySafeContext({ route: ROUTE_TEMPLATE, householdId: run.household_id, runId }),
        });
        annotateAgentPromptSpan(span, { status_code: 500 });
        return apiError(
          'INTERNAL_ERROR',
          'Não foi possível reconstituir o plano de execução.',
          500,
          { run_id: runId },
        );
      }

      // Re-executar Planner + Executor
      let plan: PlanResult;
      let outcome: AtomicOutcome;
      try {
        const planner = new Planner();
        plan = await planner.plan({
          classification,
          householdId: run.household_id,
          userId: run.user_id,
          traceId: run.trace_id ?? `confirm-${Date.now()}`,
          runId,
        });
        await updateAfterPlanner(
          runId,
          {
            toolCalls: plan.toolCalls,
            // Story 2.12: enum short-form gravado na coluna agent_runs.executor_model.
            executorModel: CLAUDE_HAIKU_MODEL_ENUM,
            tokensInput: plan.tokensInput,
            tokensOutput: plan.tokensOutput,
            costEur: plan.costEur,
          },
          db,
        );

        // SEC-8 (ADR-003 Fase 4 Fatia D): tx de escrita aberta via withHousehold
        // (role authenticated + claims → RLS viva, 2.ª rede). A auth vem da RUN
        // PERSISTIDA (run.user_id/run.household_id) — o MESMO par já passado a
        // executor.execute abaixo, NUNCA a identidade do request. Um membro
        // diferente do household a confirmar continua a passar
        // is_household_member(run.household_id). withHousehold via db-shim
        // (REQ-INLINE-1). App-enforced (1.ª rede) mantém-se.
        const executor = new Executor({
          txRunner: (fn) => withHousehold({ userId: run.user_id, householdId: run.household_id }, fn),
        });
        outcome = await executor.execute({
          plan,
          householdId: run.household_id,
          userId: run.user_id,
          traceId: run.trace_id ?? `confirm-${Date.now()}`,
          runId,
        });
      } catch (err) {
        const failUpdate = (errorCode: string, errorMessage: string): Promise<void> =>
          updateAfterExecutor(
            runId,
            { status: 'failed', latencyMs: 0, responseSummary: null, errorCode, errorMessage },
            db,
          );

        if (err instanceof ToolPlanGateError) {
          await failUpdate('TOOL_PLAN_GATE_ERROR', err.message);
          captureException(err, { ...sentrySafeContext({ route: ROUTE_TEMPLATE, householdId: run.household_id, runId }) });
          annotateAgentPromptSpan(span, { status_code: 400 });
          return apiError('TOOL_PLAN_GATE_ERROR', err.message, 400, { run_id: runId });
        }
        if (err instanceof ExecutorValidationError) {
          await failUpdate('EXECUTOR_VALIDATION_ERROR', err.message);
          annotateAgentPromptSpan(span, { status_code: 400 });
          return apiError('EXECUTOR_VALIDATION_ERROR', err.message, 400, { run_id: runId });
        }
        if (err instanceof PlannerError) {
          await failUpdate('PLANNER_ERROR', err.message);
          captureException(err, { ...sentrySafeContext({ route: ROUTE_TEMPLATE, householdId: run.household_id, runId }) });
          annotateAgentPromptSpan(span, { status_code: 400 });
          return apiError('PLANNER_ERROR', err.message, 400, { run_id: runId });
        }
        if (err instanceof ToolError) {
          await failUpdate('TOOL_EXECUTION_ERROR', err.message);
          captureException(err, { ...sentrySafeContext({ route: ROUTE_TEMPLATE, householdId: run.household_id, runId }) });
          annotateAgentPromptSpan(span, { status_code: 500 });
          return apiError('TOOL_EXECUTION_ERROR', err.message, 500, { run_id: runId });
        }

        log.error({ err }, 'Confirm pipeline crashed');
        captureException(err instanceof Error ? err : new Error(String(err)), {
          ...sentrySafeContext({ route: ROUTE_TEMPLATE, householdId: run.household_id, runId }),
        });
        await failUpdate('INTERNAL_ERROR', err instanceof Error ? err.message : 'Unknown');
        annotateAgentPromptSpan(span, { status_code: 500 });
        return apiError('INTERNAL_ERROR', 'Erro ao executar pipeline confirmado.', 500, { run_id: runId });
      }

      if (outcome.success === false) {
        const failure = outcome;
        await updateAfterExecutor(
          runId,
          {
            status: 'failed',
            latencyMs: 0,
            responseSummary: null,
            errorCode: failure.error?.constructor?.name ?? 'EXECUTION_FAILED',
            errorMessage: failure.error?.message ?? 'Execução falhou',
          },
          db,
        );
        annotateAgentPromptSpan(span, { mode: 'executed', status_code: 500 });
        return apiError(
          'TOOL_EXECUTION_ERROR',
          failure.error?.message ?? 'Execução falhou — operação revertida.',
          500,
          { run_id: runId, failed_tool: failure.failedToolName },
        );
      }

      const result = outcome as AtomicResult;
      const summary = buildConfirmSummary(result);
      await updateAfterExecutor(
        runId,
        {
          status: 'success',
          latencyMs: 0,
          responseSummary: summary,
          errorCode: null,
          errorMessage: null,
        },
        db,
      );

      try {
        // Story 2.9 D50 — incrementQuota usa getServiceDb() internamente.
        await incrementQuota(run.household_id);
      } catch (qerr) {
        log.warn({ err: qerr }, 'incrementQuota falhou (não-fatal)');
      }

      annotateAgentPromptSpan(span, {
        mode: 'executed',
        tool_count: plan.toolCalls.length,
        status_code: 200,
      });

      const undoExpiresAt = new Date(Date.now() + 30 * 1000);
      const responseBody = {
        mode: 'executed' as const,
        run_id: runId,
        results: outcome,
        summary,
        undo_url: `/api/agent/prompt/${runId}/undo`,
        undo_expires_at: undoExpiresAt.toISOString(),
      };
      return NextResponse.json(redactEndpointOutput(responseBody));
    },
  );
}

function buildConfirmSummary(result: AtomicResult): string {
  const count = result.results?.length ?? 0;
  if (count === 0) {
    return 'Confirmação aceite — nada a executar.';
  }
  return `Confirmaste a execução de ${count} operação(ões). Tens 30 segundos para reverter.`;
}
