/**
 * POST /api/agent/prompt/[runId]/confirm — Confirm endpoint (FR4 D20).
 *
 * Story 2.6 AC6 — utilizador confirma execução de uma run em
 * `status='pending_preview'` dentro da janela de 5min (D20). Re-executa
 * Planner+Executor com a `classification` JSONB persistida (evita re-chamar
 * Classifier — economiza tokens GPT-4o-mini + latência).
 *
 * Story J-2 (AC10): a lógica de confirmação é extraída para a função exportada
 * `executeConfirm({ runId, householdId, userId })`, chamável directamente sem
 * HTTP (o webhook do Telegram chama-a no callback `confirm:{runId}`). Este route
 * handler passa a ser um wrapper fino: resolve auth + household e delega.
 *
 * Validações:
 *   - SEC-1-F3: pertença do utilizador ao `run.household_id` verificada
 *     app-enforced (RLS inerte em runtime — `getDb()` liga como bypassrls).
 *   - status == 'pending_preview'
 *   - now() < confirm_expires_at
 *
 * Trace: Story 2.6 AC6 + D20 + Story J-2 AC10, FR4, Architecture §4.4.
 */
import { sql } from 'drizzle-orm';
import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';

import { createServerSupabaseClient } from '@meu-jarvis/auth/server';
import {
  ClassificationSchema,
  type ClassificationResult,
} from '@meu-jarvis/classifier';
import { getDb, withHousehold } from '@/lib/agent/db-shim';
import { renderReadToolResults } from '@/lib/agent/format-results';
import { outcomeHasIrreversibleWrite } from '@/lib/agent/irreversible';
import { resolveHouseholdId } from '@/lib/api-helpers/auth';
import {
  childLogger,
  captureException,
} from '@meu-jarvis/observability';
import {
  Executor,
  Planner,
  PlannerError,
  PlanToolCallSchema,
  ExecutorValidationError,
  ToolPlanGateError,
  ToolError,
  type AtomicOutcome,
  type AtomicResult,
  type PlanResult,
} from '@meu-jarvis/planner-executor';

// Side-effect: regista as calendar tools (Story J-5) no `toolRegistry` singleton.
// CRÍTICO: `reagendar_evento_calendario` força sempre `needs_confirmation`, pelo
// que a sua execução acontece NESTE route (confirm) — que NÃO importa run-agent.
// Sem este import, o Executor não encontraria a calendar tool (ToolNotFoundError).
import '@/lib/agent/tools/calendar/index';
// Side-effect: regista a gmail tool (Story J-6). `consultar_emails` é read-only e
// não força confirmação, mas mantemos o import por consistência com o padrão J-5
// e para que J-7 (`enviar_email`, que forçará confirmação) não exija alteração aqui.
import '@/lib/agent/tools/gmail/index';

import { apiError } from '@/lib/errors';
import { revalidateTaskViews } from '@/lib/api-helpers/revalidate';
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
  /**
   * Story J-7 SEND-PREVIEW-1 — plano persistido no preview (`tool_calls` JSONB).
   * Para runs de `enviar_email`, o preview já correu o Planner e persistiu o
   * rascunho; reutilizamo-lo aqui em vez de re-planear (binding preview==envio).
   */
  readonly tool_calls: unknown;
  readonly trace_id: string | null;
}

/**
 * Story J-7 SEND-PREVIEW-1 — intents cujo plano persistido no preview deve ser
 * REUTILIZADO no confirm (em vez de re-planear), garantindo que a escrita externa
 * executada é EXACTAMENTE o rascunho que o utilizador reviu. Restrito a
 * `enviar_email`: tarefas/finanças/calendar continuam a re-planear (regressão zero).
 */
const REUSE_PERSISTED_PLAN_INTENTS: ReadonlySet<string> = new Set(['enviar_email']);

/**
 * Resultado discriminado de `executeConfirm`. O caso de sucesso (`ok: true`)
 * embute o `AgentResult` `mode: 'executed'` (Story J-2 AC10 — formato camelCase
 * idêntico ao de `runAgentForHousehold`). Os erros são comunicados via `reason`
 * (sem `throw`) para o caller mapear (route handler → HTTP; webhook → mensagem).
 */
export type ConfirmResult =
  | {
      ok: true;
      runId: string;
      summary: string;
      results: AtomicOutcome;
      undoExpiresAt: string;
    }
  | {
      ok: false;
      runId: string;
      reason:
        | 'not_found'
        | 'invalid_state'
        | 'expired'
        | 'plan_error'
        | 'tool_error'
        | 'internal_error';
      errorCode: string;
      message: string;
      failedToolName?: string;
    };

/**
 * Executa a confirmação de uma run em `pending_preview` — chamável directamente.
 *
 * Story J-2 AC10 — usada pelo route handler abaixo E pelo webhook do Telegram
 * (callback `confirm:{runId}`), sem duplicar lógica nem fazer `fetch` interno.
 *
 * A auth da execução vem da RUN PERSISTIDA (`run.user_id`/`run.household_id`),
 * NUNCA da identidade do request — o `householdId` passado é apenas o filtro de
 * pertença (SEC-1-F3: cross-household → not_found).
 */
export async function executeConfirm(params: {
  runId: string;
  householdId: string;
  userId: string;
}): Promise<ConfirmResult> {
  const { runId, householdId } = params;
  const log = childLogger({ route: ROUTE_TEMPLATE, run_id: runId });

  const db = getDb();

  // Lookup run em pending_preview — filtro household_id app-enforced (SEC-1-F3).
  const rows = await db.execute<PendingPreviewRow>(sql`
    select id, household_id, user_id, status, confirm_expires_at,
           intents_detected, tool_calls, trace_id
    from agent_runs
    where id = ${runId}::uuid
      and household_id = ${householdId}::uuid
    limit 1
  `);

  if (rows.length === 0) {
    return {
      ok: false,
      runId,
      reason: 'not_found',
      errorCode: 'RUN_NOT_FOUND',
      message: 'Run não encontrado.',
    };
  }

  const run = rows[0]!;

  // Validar estado.
  if (run.status !== 'pending_preview') {
    return {
      ok: false,
      runId,
      reason: 'invalid_state',
      errorCode: 'CONFIRM_INVALID_STATE',
      message: `Esta acção já não está à espera de confirmação (estado actual: ${run.status}).`,
    };
  }

  // Validar TTL.
  const expiresAt = run.confirm_expires_at ? new Date(run.confirm_expires_at) : null;
  if (!expiresAt || expiresAt.getTime() < Date.now()) {
    return {
      ok: false,
      runId,
      reason: 'expired',
      errorCode: 'CONFIRM_EXPIRED',
      message: 'A janela de confirmação expirou (5 minutos). Faz novo pedido.',
    };
  }

  // Reconstituir classification do JSONB persistido.
  let classification: ClassificationResult;
  try {
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
    return {
      ok: false,
      runId,
      reason: 'internal_error',
      errorCode: 'INTERNAL_ERROR',
      message: 'Não foi possível reconstituir o plano de execução.',
    };
  }

  // Re-executar Planner + Executor.
  let plan: PlanResult;
  let outcome: AtomicOutcome;
  try {
    const planner = new Planner();

    // Story J-7 SEND-PREVIEW-1 — para runs de escrita externa irreversível
    // (enviar_email), reutilizamos o plano persistido no preview em vez de
    // re-planear: o email enviado é EXACTAMENTE o rascunho que o utilizador reviu
    // (binding preview==envio; a segurança de uma acção irreversível só é real se
    // o que se confirma for o que se vê). Fallback (parse falha / plano vazio):
    // re-planeia normalmente. Restantes intents: re-planeiam (regressão zero).
    const reusedPlan = shouldReusePersistedPlan(classification.intents)
      ? reconstructPersistedPlan(run.tool_calls)
      : null;

    plan =
      reusedPlan ??
      (await planner.plan({
        classification,
        householdId: run.household_id,
        userId: run.user_id,
        traceId: run.trace_id ?? `confirm-${Date.now()}`,
        runId,
      }));

    await updateAfterPlanner(
      runId,
      {
        toolCalls: plan.toolCalls,
        // Modelo realmente usado pelo Planner/Executor (produção: gpt-4o-mini).
        // Ao reutilizar o plano do preview, não há nova chamada LLM aqui →
        // tokens/custo do confirm são 0 (o custo do plano foi contabilizado no preview).
        executorModel: planner.model,
        tokensInput: reusedPlan ? 0 : plan.tokensInput,
        tokensOutput: reusedPlan ? 0 : plan.tokensOutput,
        costEur: reusedPlan ? 0 : plan.costEur,
      },
      db,
    );

    // SEC-8: tx de escrita aberta via withHousehold. A auth vem da RUN PERSISTIDA
    // (run.user_id/run.household_id) — o MESMO par passado a executor.execute.
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
      return { ok: false, runId, reason: 'plan_error', errorCode: 'TOOL_PLAN_GATE_ERROR', message: err.message };
    }
    if (err instanceof ExecutorValidationError) {
      await failUpdate('EXECUTOR_VALIDATION_ERROR', err.message);
      return { ok: false, runId, reason: 'plan_error', errorCode: 'EXECUTOR_VALIDATION_ERROR', message: err.message };
    }
    if (err instanceof PlannerError) {
      await failUpdate('PLANNER_ERROR', err.message);
      captureException(err, { ...sentrySafeContext({ route: ROUTE_TEMPLATE, householdId: run.household_id, runId }) });
      return { ok: false, runId, reason: 'plan_error', errorCode: 'PLANNER_ERROR', message: err.message };
    }
    if (err instanceof ToolError) {
      await failUpdate('TOOL_EXECUTION_ERROR', err.message);
      captureException(err, { ...sentrySafeContext({ route: ROUTE_TEMPLATE, householdId: run.household_id, runId }) });
      return { ok: false, runId, reason: 'tool_error', errorCode: 'TOOL_EXECUTION_ERROR', message: err.message };
    }

    log.error({ err }, 'Confirm pipeline crashed');
    captureException(err instanceof Error ? err : new Error(String(err)), {
      ...sentrySafeContext({ route: ROUTE_TEMPLATE, householdId: run.household_id, runId }),
    });
    await failUpdate('INTERNAL_ERROR', err instanceof Error ? err.message : 'Unknown');
    return {
      ok: false,
      runId,
      reason: 'internal_error',
      errorCode: 'INTERNAL_ERROR',
      message: 'Erro ao executar pipeline confirmado.',
    };
  }

  if (outcome.success === false) {
    const failure = outcome;
    // Observabilidade (hotfix J-6): aflorar a CAUSA real do erro. O
    // `ToolExecutionError.message` só inclui o *nome* da causa ("Error"),
    // descartando o detalhe (ex.: "A Gmail API recusou listar os emails (HTTP
    // 403)."). Sem isto, o detalhe fica invisível na DB, nos logs e no bot.
    const cause = (failure.error as { cause?: unknown } | undefined)?.cause;
    const detail =
      cause instanceof Error ? cause.message : (failure.error?.message ?? 'Execução falhou');
    await updateAfterExecutor(
      runId,
      {
        status: 'failed',
        latencyMs: 0,
        responseSummary: null,
        errorCode: failure.error?.constructor?.name ?? 'EXECUTION_FAILED',
        errorMessage: detail,
      },
      db,
    );
    return {
      ok: false,
      runId,
      reason: 'tool_error',
      errorCode: 'TOOL_EXECUTION_ERROR',
      message: detail,
      failedToolName: failure.failedToolName,
    };
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
    await incrementQuota(run.household_id);
  } catch (qerr) {
    log.warn({ err: qerr }, 'incrementQuota falhou (não-fatal)');
  }

  // W2: confirmação executa tools (tarefas/finanças) — invalida as vistas.
  revalidateTaskViews();

  const undoExpiresAt = new Date(Date.now() + 30 * 1000);
  return {
    ok: true,
    runId,
    summary,
    results: outcome,
    undoExpiresAt: undoExpiresAt.toISOString(),
  };
}

export async function POST(
  _req: NextRequest,
  ctx: { params: Promise<{ runId: string }> },
): Promise<NextResponse> {
  const { runId } = await ctx.params;

  return withAgentPromptSpan(
    'POST /api/agent/prompt/[runId]/confirm',
    { method: 'POST', route: ROUTE_TEMPLATE },
    async (span): Promise<NextResponse> => {
      // Auth
      const supabase = await createServerSupabaseClient();
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user) {
        annotateAgentPromptSpan(span, { status_code: 401 });
        return apiError('AUTH_REQUIRED', 'Sessão inválida.', 401);
      }

      // SEC-1-F3: resolver o household do utilizador autenticado.
      const userHouseholdId = await resolveHouseholdId(user.id);
      if (!userHouseholdId) {
        annotateAgentPromptSpan(span, { status_code: 404 });
        return apiError('RUN_NOT_FOUND', 'Run não encontrado.', 404, { run_id: runId });
      }

      const result = await executeConfirm({
        runId,
        householdId: userHouseholdId,
        userId: user.id,
      });

      if (result.ok) {
        annotateAgentPromptSpan(span, { mode: 'executed', status_code: 200 });
        const responseBody = {
          mode: 'executed' as const,
          run_id: runId,
          results: result.results,
          summary: result.summary,
          undo_url: `/api/agent/prompt/${runId}/undo`,
          undo_expires_at: result.undoExpiresAt,
        };
        return NextResponse.json(redactEndpointOutput(responseBody));
      }

      // Mapear `reason` → HTTP status + error code histórico (regressão zero).
      switch (result.reason) {
        case 'not_found':
          annotateAgentPromptSpan(span, { status_code: 404 });
          return apiError('RUN_NOT_FOUND', 'Run não encontrado.', 404, { run_id: runId });
        case 'invalid_state':
          annotateAgentPromptSpan(span, { status_code: 409 });
          return apiError(
            'CONFIRM_INVALID_STATE',
            `Run não está em estado de confirmação.`,
            409,
            { run_id: runId },
          );
        case 'expired':
          annotateAgentPromptSpan(span, { status_code: 409 });
          return apiError(
            'CONFIRM_EXPIRED',
            'Janela de confirmação expirou (5 minutos). Faz novo prompt.',
            409,
            { run_id: runId },
          );
        case 'plan_error':
          annotateAgentPromptSpan(span, { status_code: 400 });
          return apiError(result.errorCode, result.message, 400, { run_id: runId });
        case 'tool_error':
          annotateAgentPromptSpan(span, { mode: 'executed', status_code: 500 });
          return apiError('TOOL_EXECUTION_ERROR', result.message, 500, {
            run_id: runId,
            failed_tool: result.failedToolName,
          });
        case 'internal_error':
        default:
          annotateAgentPromptSpan(span, { status_code: 500 });
          return apiError('INTERNAL_ERROR', result.message, 500, { run_id: runId });
      }
    },
  );
}

function buildConfirmSummary(result: AtomicResult): string {
  // Tools de leitura (ex.: consultar_emails) mostram os DADOS, não "N operações".
  const read = renderReadToolResults(result.results ?? []);
  if (read !== null) {
    return read;
  }
  // Story J-7 UNDO-MISLEAD-1 — escrita externa IRREVERSÍVEL (enviar_email): NÃO
  // prometer reversão ("Tens 30 segundos para reverter") sobre um email já
  // enviado. Mensagem honesta — a acção é definitiva.
  if (outcomeHasIrreversibleWrite(result)) {
    return 'Email enviado. Emails enviados não podem ser recuperados.';
  }
  const count = result.results?.length ?? 0;
  if (count === 0) {
    return 'Confirmação aceite — nada a executar.';
  }
  return `Confirmaste a execução de ${count} operação(ões). Tens 30 segundos para reverter.`;
}

/**
 * Story J-7 SEND-PREVIEW-1 — o run deve reutilizar o plano persistido no preview?
 * (Restrito a `enviar_email` — binding preview==envio; ver `REUSE_PERSISTED_PLAN_INTENTS`.)
 */
function shouldReusePersistedPlan(intents: ReadonlyArray<{ intent: string }>): boolean {
  return intents.some((i) => REUSE_PERSISTED_PLAN_INTENTS.has(i.intent));
}

/**
 * Story J-7 SEND-PREVIEW-1 — reconstrói um `PlanResult` a partir do `tool_calls`
 * JSONB persistido no preview. Métricas a zero (não houve chamada LLM no confirm).
 * Devolve `null` se o payload não validar ou estiver vazio → o caller re-planeia
 * (fallback seguro).
 */
function reconstructPersistedPlan(rawToolCalls: unknown): PlanResult | null {
  const parsed = z.array(PlanToolCallSchema).safeParse(rawToolCalls);
  if (!parsed.success || parsed.data.length === 0) {
    return null;
  }
  return {
    toolCalls: parsed.data,
    planReasoning: null,
    latencyMs: 0,
    tokensInput: 0,
    tokensOutput: 0,
    costEur: 0,
    cacheHit: false,
  };
}
