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
import { sql } from 'drizzle-orm';
import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';

import { createServerSupabaseClient } from '@meu-jarvis/auth/server';
import { Classifier, ClassifierError, type ClassificationResult } from '@meu-jarvis/classifier';
import { getDb, withHousehold } from '@/lib/agent/db-shim';
import { buildCacheKey, getCacheClient, CACHE_TTL_SECONDS } from '@/lib/agent/cache';
import { isSingleConsultarDados, executeDirectQuery } from '@/lib/agent/cost-router';
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
  type AccountContext,
  type AtomicOutcome,
  type AtomicResult,
  type PlanResult,
} from '@meu-jarvis/planner-executor';
import { CLAUDE_HAIKU_MODEL_ENUM, type OpenAIClientLike } from '@meu-jarvis/agent';

import { apiError } from '@/lib/errors';
import { revalidateTaskViews } from '@/lib/api-helpers/revalidate';
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
 * Constrói o `accountContext` (Story 2.13 AC6) — contas e cartões activos do
 * household para o Planner desambiguar conta/cartão nomeados pelo utilizador.
 *
 * RLS (ADR-002 §9.3): usa `getDb()` (role authenticated, JWT-scoped) — NUNCA
 * `getServiceDb()`. O Postgres garante que só vê entidades do próprio
 * household. Filtra `archived_at IS NULL` (a coluna de arquivamento é
 * `archived_at`, NÃO `is_archived`).
 *
 * O endpoint converte o `account_type` (pgEnum) para string — o package
 * planner é agnóstico de DDL (não conhece `accountTypeEnum`).
 *
 * Falha é não-fatal: devolve `undefined` (o fallback `resolveDefaultAccount`
 * das tools resolve a conta default a jusante).
 */
async function buildAccountContext(
  db: ReturnType<typeof getDb>,
  log: ReturnType<typeof childLogger>,
  householdId: string,
): Promise<AccountContext | undefined> {
  try {
    // SEC-1: filtro household_id explícito — a RLS está inerte em runtime.
    const accountRows = await db.execute<{ id: string; name: string; account_type: string }>(sql`
      select id, name, account_type
      from public.accounts
      where household_id = ${householdId}::uuid and archived_at is null
      order by created_at asc
    `);
    const cardRows = await db.execute<{ id: string; name: string }>(sql`
      select id, name
      from public.cards
      where household_id = ${householdId}::uuid and archived_at is null
      order by created_at asc
    `);

    const accounts = accountRows.map((r) => ({
      id: r.id,
      name: r.name,
      type: r.account_type,
    }));
    const cards = cardRows.map((r) => ({ id: r.id, name: r.name }));

    if (accounts.length === 0 && cards.length === 0) {
      return undefined;
    }
    return { accounts, cards };
  } catch (err) {
    log.warn({ err }, 'buildAccountContext falhou — Planner sem accountContext (fallback resolve a jusante)');
    return undefined;
  }
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
          // Story 2.9 AC10 — headers HTTP 429 standard.
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

      // ─── 5b. Ler user_prefs.always_preview (Story 2.7 FR4) ────────
      // Lazy-init em /api/conta/preferencias GET — se row não existir aqui
      // (race), tratar como `false` (não crash). RLS-isolated via getDb().
      let alwaysPreview = false;
      try {
        const prefsRows = await db.execute<{ always_preview: boolean }>(sql`
          select always_preview from public.user_prefs
          where user_id = ${user.id}::uuid
          limit 1
        `);
        alwaysPreview = prefsRows[0]?.always_preview ?? false;
      } catch (err) {
        log.warn({ err }, 'user_prefs lookup falhou — assumindo always_preview=false');
      }

      annotateAgentPromptSpan(span, { always_preview_active: alwaysPreview });

      // ─── 5c. Resolver householdPlan (Story 2.9 DN11) ──────────────
      // Necessário para cacheKey (DN2 — householdPlan, NÃO householdId).
      // Fallback 'free' se row não encontrada (defensivo).
      let householdPlan: string = 'free';
      try {
        const planRows = await db.execute<{ plan: string }>(sql`
          select plan from public.households
          where id = ${householdId}::uuid
          limit 1
        `);
        householdPlan = planRows[0]?.plan ?? 'free';
      } catch (err) {
        log.warn({ err }, 'households.plan lookup falhou — assumindo plan=free');
      }

      // ─── 5d. Cache lookup ANTES do classifier (Story 2.9 AC3) ─────
      // Cache key = sha256(normalize(prompt) + householdPlan) per Architecture
      // §4.6 literal. HIT → bypass classifier (poupa ~€0.00006 + latency).
      // Modo degradado: se Upstash ausente, get() retorna null sem throw.
      const cacheKey = buildCacheKey(body.prompt, householdPlan);
      let classification: ClassificationResult | null = null;
      let cacheHit = false;
      try {
        const cached = await getCacheClient().get(cacheKey);
        if (cached) {
          try {
            classification = JSON.parse(cached) as ClassificationResult;
            cacheHit = true;
            log.info({ cache_key: cacheKey.slice(0, 16) }, 'Cache hit — a reutilizar classificação');
            // Persistir intents no audit log mesmo no path cache (FR3).
            await updateAfterClassifier(
              runId,
              {
                intentsDetected: classification.intents,
                confidence: classification.overall_confidence,
                classifierModel: 'gpt-4o-mini',
              },
              db,
            );
          } catch (parseErr) {
            log.warn({ err: parseErr }, 'Cache value inválido — a reclassificar');
            classification = null;
          }
        } else {
          log.info({ cache_key: cacheKey.slice(0, 16) }, 'Cache miss — a classificar');
        }
      } catch (err) {
        log.warn({ err }, 'Cache lookup falhou — a classificar');
      }

      annotateAgentPromptSpan(span, { cache_hit: cacheHit });

      // ─── 6. Classifier (se cache MISS) ────────────────────────────
      if (!classification) {
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
          // Cache SET — best-effort, falha é não-fatal.
          try {
            await getCacheClient().set(cacheKey, JSON.stringify(classification), {
              ex: CACHE_TTL_SECONDS,
            });
          } catch (cacheErr) {
            log.warn({ err: cacheErr }, 'Cache set falhou (não-fatal)');
          }
        } catch (err) {
          return handleClassifierError(err, span, runId, householdId, db);
        }
      }

      annotateAgentPromptSpan(span, {
        intent_class: classification.intents[0]?.intent,
        confidence_min: classification.overall_confidence,
      });

      // ─── 7. Branch FR4 — preview vs executed ──────────────────────
      // Story 2.7: gate adicional `alwaysPreview` (user pref) força preview
      // mesmo com confidence ≥ 0.70.
      //
      // Cost router (Story 2.9 AC6): bypass Planner+Executor para singleton
      // `consultar_dados` — apenas se NÃO estamos em preview mode (preview já
      // adia a execução até confirm; cost router é só para o path executed).
      if (
        !classification.needs_confirmation &&
        !alwaysPreview &&
        isSingleConsultarDados(classification.intents)
      ) {
        const rawSpan = classification.intents[0]?.raw_span;
        let directResult;
        try {
          directResult = await executeDirectQuery(rawSpan, householdId, db);
        } catch (err) {
          // Cost router error: degrada para path Planner+Executor normal
          // ao invés de devolver 500 — fallback graceful.
          log.warn({ err }, 'Cost router direct query falhou — degradando para executor');
          directResult = null;
        }

        if (directResult) {
          const latencyMs = Date.now() - startedAt;
          await updateAfterExecutor(
            runId,
            {
              status: 'success',
              latencyMs,
              responseSummary: directResult.summary,
              errorCode: null,
              errorMessage: null,
            },
            db,
          );

          // Quota increment — Story 2.9 DN10 (quota é por prompt, não por LLM call).
          try {
            await incrementQuota(householdId);
          } catch (err) {
            log.warn({ err }, 'incrementQuota falhou (não-fatal) — path direct-DB');
          }

          annotateAgentPromptSpan(span, {
            mode: 'executed',
            tool_count: 0,
            duration_ms: latencyMs,
            cache_hit: cacheHit,
            status_code: 200,
            classifier_model: 'gpt-4o-mini',
          });
          log.info(
            { run_id: runId, template: directResult.templateUsed },
            'Consulta directa DB — executor bypassed',
          );

          // Response shape direct-DB: sem undo_url/undo_expires_at (read-only — DN9).
          const directResponseBody = {
            mode: 'executed' as const,
            run_id: runId,
            results: {
              success: true,
              kind: 'direct_query',
              template_used: directResult.templateUsed,
              data: directResult.data,
            },
            summary: directResult.summary,
          };
          return NextResponse.json(redactEndpointOutput(directResponseBody));
        }
      }

      if (classification.needs_confirmation || alwaysPreview) {
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
      // Story 2.13 AC6 (ADR-002 §9.3): SELECT RLS-scoped (getDb(), NUNCA
      // getServiceDb()) das contas/cartões activos (archived_at IS NULL) do
      // household, para alimentar o accountContext do Planner. Falha é
      // não-fatal — o fallback resolveDefaultAccount das tools resolve a jusante.
      const accountContext = await buildAccountContext(db, log, householdId);

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
          accountContext,
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

        // SEC-8 (ADR-003 Fase 4 Fatia D): a transacção de escrita do cérebro AI
        // é aberta via `withHousehold` (role authenticated + claims JWT → RLS
        // viva, 2.ª rede) exactamente no loop de `executeAtomic`. O par
        // { userId, householdId } é IDÊNTICO ao passado a `executor.execute`
        // abaixo — a sessão RLS scopa o mesmo household dos inserts. App-enforced
        // (1.ª rede, SEC-1) mantém-se em todas as queries. `withHousehold` vem do
        // db-shim (REQ-INLINE-1), nunca directo de @meu-jarvis/db.
        const executor = new Executor({
          txRunner: (fn) => withHousehold({ userId: user.id, householdId }, fn),
        });
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

      // Increment quota (não-fatal se falhar) — Story 2.9 D50: usa getServiceDb()
      // internamente porque RLS bloqueia INSERT/UPDATE em agent_quotas a authenticated.
      try {
        await incrementQuota(householdId);
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
        // Story 2.12: span OTel (telemetria, string livre) — usa o short-form
        // por coerência com o enum.
        executor_model: CLAUDE_HAIKU_MODEL_ENUM,
      });

      // W2: o Cérebro AI pode mutar tarefas (e finanças) — invalida as vistas
      // dependentes para a Visão não ficar stale quando o chat é usado fora de
      // /tarefas. router.refresh() no ChatPanel só revalida o segmento actual.
      revalidateTaskViews();

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
    // `err.constructor.name` é minificado em produção (ex. "p") — inútil para
    // diagnóstico. Logar `error_code` + `err.message` (do ClassifierLLMError já
    // vem do ProviderError redacted — [REDACTED] visível, seguro para log).
    log.warn(
      { error_code: 'CLASSIFIER_ERROR', err_message: err.message },
      'Classifier error',
    );
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

  // NOTA: logar `error_code` + `err.message` (não `err.constructor.name`, que
  // o build de produção minifica para nomes inúteis tipo "p"). As mensagens
  // destes errors já são seguras para log (sem PII crua).
  if (err instanceof ToolPlanGateError) {
    await failUpdate('TOOL_PLAN_GATE_ERROR', err.message);
    log.warn(
      { error_code: 'TOOL_PLAN_GATE_ERROR', err_message: err.message },
      'Tool plan gate rejeitou plan',
    );
    captureException(err, { ...sentrySafeContext({ route: ROUTE, householdId, runId }) });
    span.setAttribute('agent.prompt.status_code', 400);
    return apiError('TOOL_PLAN_GATE_ERROR', err.message, 400, { run_id: runId });
  }
  if (err instanceof ExecutorValidationError) {
    await failUpdate('EXECUTOR_VALIDATION_ERROR', err.message);
    log.warn(
      { error_code: 'EXECUTOR_VALIDATION_ERROR', err_message: err.message },
      'Executor validation error',
    );
    captureException(err, { ...sentrySafeContext({ route: ROUTE, householdId, runId }) });
    span.setAttribute('agent.prompt.status_code', 400);
    return apiError('EXECUTOR_VALIDATION_ERROR', err.message, 400, { run_id: runId });
  }
  if (err instanceof PlannerError) {
    await failUpdate('PLANNER_ERROR', err.message);
    log.warn(
      { error_code: 'PLANNER_ERROR', err_message: err.message },
      'Planner error',
    );
    captureException(err, { ...sentrySafeContext({ route: ROUTE, householdId, runId }) });
    span.setAttribute('agent.prompt.status_code', 400);
    return apiError('PLANNER_ERROR', err.message, 400, { run_id: runId });
  }
  if (err instanceof ToolError) {
    await failUpdate('TOOL_EXECUTION_ERROR', err.message);
    log.error(
      { error_code: 'TOOL_EXECUTION_ERROR', err_message: err.message },
      'Tool execution error',
    );
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
