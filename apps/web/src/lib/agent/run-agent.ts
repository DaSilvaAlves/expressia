/**
 * runAgentForHousehold — pipeline AI multi-intent desacoplado da camada HTTP/Auth.
 *
 * Story J-2 (PRD-Jarvis §4.6) — o pipeline do cérebro AI estava colado a
 * `supabase.auth.getUser()` + `resolveHouseholdId()` no route handler
 * `POST /api/agent/prompt`. O Telegram não tem sessão Supabase (JWT): precisa de
 * uma função que aceite `{ userId, householdId }` directamente.
 *
 * Esta função executa o pipeline completo:
 *   Classifier (2.4) → cache (2.9) → cost-router (2.9) → preview-gate (2.7) →
 *   Planner+Executor atómico (2.5) → reverse-op (2.6) → audit-log (2.6).
 *
 * SEM chamar `supabase.auth.getUser()` nem `resolveHouseholdId()`. A tenancy
 * (RLS 2.ª rede) continua a passar por `withHousehold({ userId, householdId })`
 * de `@/lib/agent/db-shim` — SEM alterar `withHousehold` nem `db-shim.ts`
 * (SEC-8 HOLD). O desacoplamento é só na camada de autenticação.
 *
 * Esta função NÃO devolve `NextResponse` — devolve um `AgentRunOutcome`
 * discriminado. O route handler `POST /api/agent/prompt` (wrapper fino) mapeia
 * o outcome para a resposta HTTP snake_case actual; o webhook do Telegram mapeia
 * para mensagens da Bot API. Os erros do pipeline (ClassifierError, PlannerError,
 * etc.) são propagados por `throw` — cada caller mapeia-os para o seu protocolo.
 *
 * Trace: Story J-2 AC4/AC5, PRD-Jarvis §4.6 + directiva SEC-8.1.
 */
import { sql } from 'drizzle-orm';

// Side-effect: regista as calendar tools (Story J-5) no `toolRegistry` singleton
// ANTES de qualquer invocação do Planner/Executor. Forma side-effect sem
// desestruturar (resiste melhor a tree-shaking; ver registration.test.ts).
import '@/lib/agent/tools/calendar/index';
// Side-effect: regista a gmail tool (Story J-6) no `toolRegistry` singleton.
import '@/lib/agent/tools/gmail/index';

import { Classifier, type ClassificationResult } from '@meu-jarvis/classifier';
import { getDb, withHousehold } from '@/lib/agent/db-shim';
import { buildCacheKey, getCacheClient, CACHE_TTL_SECONDS } from '@/lib/agent/cache';
import { isSingleConsultarDados, executeDirectQuery } from '@/lib/agent/cost-router';
import { renderReadToolResults } from '@/lib/agent/format-results';
import { childLogger } from '@meu-jarvis/observability';
import {
  Executor,
  Planner,
  type AccountContext,
  type AtomicOutcome,
  type AtomicResult,
  type PlanResult,
} from '@meu-jarvis/planner-executor';
import { type OpenAIClientLike } from '@meu-jarvis/agent';

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
import { checkRateLimit, checkQuota } from '@/lib/agent/rate-limiter';
import { hashPrompt } from '@/lib/agent/redaction';
import type { IdempotentRunSnapshot } from '@/lib/agent/idempotency';

const ROUTE = '/api/agent/prompt';

/**
 * Story J-5 AC14 — intents do domínio Calendar. Escritas no Google Calendar não
 * participam em transacções Postgres: se uma tool irmã (tarefa/finança) falhar, o
 * rollback Postgres NÃO desfaz o evento já criado → evento órfão irrecuperável.
 * Por isso intents de Calendar não correm misturadas com outros domínios.
 */
const CALENDAR_INTENTS: ReadonlySet<string> = new Set([
  'criar_evento_calendario',
  'reagendar_evento_calendario',
]);

/**
 * Story J-5 AC14 — detecta um plano misto "Calendar + outro domínio".
 *
 * `true` quando existe ≥1 intent de Calendar E ≥1 intent de outro domínio
 * (tasks/finance/query — `unknown` é ignorado, não conta como domínio concreto).
 */
function isMixedCalendarPlan(intents: ReadonlyArray<{ intent: string }>): boolean {
  const hasCalendar = intents.some((i) => CALENDAR_INTENTS.has(i.intent));
  if (!hasCalendar) {
    return false;
  }
  const hasOtherDomain = intents.some(
    (i) => !CALENDAR_INTENTS.has(i.intent) && i.intent !== 'unknown',
  );
  return hasOtherDomain;
}

// ─────────────────────────────────────────────────────────────────────────────
// Tipos públicos
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Resultado "público" do pipeline (Story J-2 AC4): distingue `executed` de
 * `preview`. Usa camelCase — o wrapper HTTP serializa para o snake_case actual
 * (`run_id`, `undo_url`, etc.) sem alterar o contrato de API público.
 *
 * O webhook do Telegram consome directamente este tipo (`mode` discrimina a
 * mensagem a enviar).
 */
export type AgentResult =
  | {
      mode: 'executed';
      runId: string;
      summary: string;
      undoUrl: string;
      undoExpiresAt: string;
    }
  | {
      mode: 'preview';
      runId: string;
      planSummary: string[];
      confidence: number;
      confirmationUrl: string;
      expiresAt: string;
    };

/**
 * Outcome completo do pipeline — superset de `AgentResult` que inclui os casos
 * de controlo de fluxo que o route handler precisa de traduzir em códigos HTTP
 * específicos (idempotency replay/in-progress, rate-limit/quota). O webhook do
 * Telegram trata `executed`/`preview` e, para os restantes, responde com uma
 * mensagem neutra.
 *
 * Variantes `executed`:
 *   - `kind: 'pipeline'` — execução normal Planner+Executor (com `results`).
 *   - `kind: 'direct_query'` — cost-router bypass (read-only, sem undo).
 */
export type AgentRunOutcome =
  | { status: 'executed'; kind: 'pipeline'; runId: string; summary: string; results: AtomicOutcome; undoExpiresAt: string }
  | { status: 'executed'; kind: 'direct_query'; runId: string; summary: string; directResult: DirectQueryResult }
  | { status: 'preview'; runId: string; planSummary: string[]; confidence: number; expiresAt: string }
  | { status: 'replay'; run: IdempotentRunSnapshot }
  | { status: 'idempotency_in_progress'; runId: string }
  | { status: 'rate_limited'; error: unknown }
  | { status: 'quota_exceeded'; error: unknown };

interface DirectQueryResult {
  readonly templateUsed: string;
  readonly data: unknown;
  readonly summary: string;
}

export interface RunAgentParams {
  readonly userId: string;
  readonly householdId: string;
  readonly prompt: string;
  readonly idempotencyKey?: string | null;
}

// ─────────────────────────────────────────────────────────────────────────────
// runAgentForHousehold
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Executa o pipeline completo para `{ userId, householdId, prompt }`.
 *
 * Devolve `AgentRunOutcome` (nunca `NextResponse`). Lança os erros do pipeline
 * (Classifier/Planner/Executor/Tool) para o caller mapear.
 *
 * Comportamento idêntico ao bloco do route handler `POST /api/agent/prompt`
 * (passos 3-9) — extraído sem alteração funcional (regressão zero).
 */
export async function runAgentForHousehold(
  params: RunAgentParams,
): Promise<AgentRunOutcome> {
  const { userId, householdId, prompt } = params;
  const idempotencyKey = params.idempotencyKey ?? null;

  const log = childLogger({ route: ROUTE, method: 'POST' });
  const startedAt = Date.now();

  const db = getDb();
  const traceId = `${Date.now()}-${userId.slice(0, 8)}`;
  const promptHash = hashPrompt(prompt);

  // ─── 3. Idempotency lookup ────────────────────────────────────────
  try {
    const verdict = await lookupIdempotentRun(idempotencyKey ?? undefined, householdId, db);
    if (verdict.kind === 'replay') {
      log.info(
        { run_id: verdict.run.id, replay: true },
        'Idempotent replay servido',
      );
      return { status: 'replay', run: verdict.run };
    }
    if (verdict.kind === 'in_progress') {
      return { status: 'idempotency_in_progress', runId: verdict.run.id };
    }
  } catch (err) {
    log.error({ err }, 'Idempotency lookup falhou — prosseguindo como new');
    // Não-fatal: prossegue sem replay (defensive)
  }

  // ─── 4. Rate limit + quota ────────────────────────────────────────
  try {
    await checkRateLimit(householdId, db);
    await checkQuota(householdId, db);
  } catch (err) {
    const { RateLimitError, QuotaExceededError } = await import('@/lib/agent/rate-limiter');
    if (err instanceof RateLimitError) {
      return { status: 'rate_limited', error: err };
    }
    if (err instanceof QuotaExceededError) {
      return { status: 'quota_exceeded', error: err };
    }
    throw err;
  }

  // ─── 5. INSERT agent_run inicial (audit log) ──────────────────────
  const { runId } = await insertAgentRun(
    {
      householdId,
      userId,
      promptText: prompt,
      promptHash,
      traceId,
      idempotencyKey: idempotencyKey || null,
    },
    db,
  );

  // ─── 5b. Ler user_prefs.always_preview (Story 2.7 FR4) ────────────
  let alwaysPreview = false;
  try {
    const prefsRows = await db.execute<{ always_preview: boolean }>(sql`
      select always_preview from public.user_prefs
      where user_id = ${userId}::uuid
      limit 1
    `);
    alwaysPreview = prefsRows[0]?.always_preview ?? false;
  } catch (err) {
    log.warn({ err }, 'user_prefs lookup falhou — assumindo always_preview=false');
  }

  // ─── 5c. Resolver householdPlan (Story 2.9 DN11) ──────────────────
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

  // ─── 5d. Cache lookup ANTES do classifier (Story 2.9 AC3) ─────────
  const cacheKey = buildCacheKey(prompt, householdPlan);
  let classification: ClassificationResult | null = null;
  try {
    const cached = await getCacheClient().get(cacheKey);
    if (cached) {
      try {
        classification = JSON.parse(cached) as ClassificationResult;
        log.info({ cache_key: cacheKey.slice(0, 16) }, 'Cache hit — a reutilizar classificação');
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

  // ─── 6. Classifier (se cache MISS) ────────────────────────────────
  // Erros do Classifier são propagados por throw (envolvidos para anexar o
  // `runId`) — o caller mapeia para o seu protocolo. O audit-log de `failed`
  // ocorre AQUI (pertence ao pipeline, não ao transporte).
  if (!classification) {
    try {
      const classifier = createClassifier();
      classification = await classifier.classify({
        text: prompt,
        householdId,
        userId,
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
      const { ClassifierError } = await import('@meu-jarvis/classifier');
      const isKnown = err instanceof ClassifierError;
      await updateAfterExecutor(
        runId,
        {
          status: 'failed',
          latencyMs: 0,
          responseSummary: null,
          errorCode: isKnown ? 'CLASSIFIER_ERROR' : 'INTERNAL_ERROR',
          errorMessage: err instanceof Error ? err.message : 'Classifier crashed',
        },
        db,
      );
      throw attachRunId(err, runId);
    }
  }

  // ─── 6b. Guard multi-intent Calendar (Story J-5 AC14) ─────────────
  // Se o plano mistura Calendar com outro domínio, NÃO executamos nada: a Google
  // Calendar API não participa na transacção Postgres (evento órfão se uma tool
  // irmã falhar). Devolvemos um preview a pedir ao utilizador que separe os
  // pedidos. Nenhuma tool é executada (Planner/Executor nem chegam a correr).
  if (isMixedCalendarPlan(classification.intents)) {
    const expiresAt = new Date(Date.now() + 5 * 60 * 1000); // 5min D20
    await updatePreviewState(runId, expiresAt, db);

    log.info(
      { run_id: runId, mode: 'preview', reason: 'mixed_calendar_plan' },
      'Preview mode — plano misto Calendar+outro domínio, a pedir separação',
    );

    return {
      status: 'preview',
      runId,
      planSummary: [
        'Não consigo tratar o calendário e outra coisa ao mesmo tempo. Começas pelo evento ou pela tarefa/finança?',
      ],
      confidence: classification.overall_confidence,
      expiresAt: expiresAt.toISOString(),
    };
  }

  // ─── 7. Branch FR4 — preview vs executed ──────────────────────────
  // Cost router (Story 2.9 AC6): bypass Planner+Executor para singleton
  // `consultar_dados` — apenas se NÃO estamos em preview mode.
  if (
    !classification.needs_confirmation &&
    !alwaysPreview &&
    isSingleConsultarDados(classification.intents)
  ) {
    const rawSpan = classification.intents[0]?.raw_span;
    let directResult: DirectQueryResult | null = null;
    try {
      directResult = await executeDirectQuery(rawSpan, householdId, db);
    } catch (err) {
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

      try {
        await incrementQuota(householdId);
      } catch (err) {
        log.warn({ err }, 'incrementQuota falhou (não-fatal) — path direct-DB');
      }

      log.info(
        { run_id: runId, template: directResult.templateUsed },
        'Consulta directa DB — executor bypassed',
      );

      return {
        status: 'executed',
        kind: 'direct_query',
        runId,
        summary: directResult.summary,
        directResult,
      };
    }
  }

  if (classification.needs_confirmation || alwaysPreview) {
    const expiresAt = new Date(Date.now() + 5 * 60 * 1000); // 5min D20
    await updatePreviewState(runId, expiresAt, db);

    const planSummary = classification.intents.map(
      (intent) => `${intent.intent} (${(intent.confidence * 100).toFixed(0)}%)`,
    );

    log.info(
      { run_id: runId, mode: 'preview', confidence: classification.overall_confidence },
      'Preview mode — aguarda confirmação 5min',
    );

    return {
      status: 'preview',
      runId,
      planSummary,
      confidence: classification.overall_confidence,
      expiresAt: expiresAt.toISOString(),
    };
  }

  // ─── 8. Planner + Executor (executed branch) ──────────────────────
  const accountContext = await buildAccountContext(db, log, householdId);

  let plan: PlanResult;
  let outcome: AtomicOutcome;
  try {
    const planner = new Planner();
    plan = await planner.plan({
      classification,
      householdId,
      userId,
      traceId,
      runId,
      accountContext,
    });
    await updateAfterPlanner(
      runId,
      {
        toolCalls: plan.toolCalls,
        // Modelo realmente usado pelo Planner/Executor (produção: gpt-4o-mini).
        executorModel: planner.model,
        tokensInput: plan.tokensInput,
        tokensOutput: plan.tokensOutput,
        costEur: plan.costEur,
      },
      db,
    );

    // SEC-8: a transacção de escrita do cérebro AI é aberta via `withHousehold`
    // (role authenticated + claims JWT → RLS viva, 2.ª rede). O par
    // { userId, householdId } é IDÊNTICO ao passado a `executor.execute`. App-enforced
    // (1.ª rede, SEC-1) mantém-se. `withHousehold` vem do db-shim (REQ-INLINE-1).
    const executor = new Executor({
      txRunner: (fn) => withHousehold({ userId, householdId }, fn),
    });
    outcome = await executor.execute({
      plan,
      householdId,
      userId,
      traceId,
      runId,
    });
  } catch (err) {
    await updateAfterExecutor(
      runId,
      {
        status: 'failed',
        latencyMs: 0,
        responseSummary: null,
        errorCode: classifyPipelineErrorCode(err),
        errorMessage: err instanceof Error ? err.message : 'Unknown error',
      },
      db,
    );
    throw attachRunId(err, runId);
  }

  // ─── 9. Resposta executed (sucesso ou rollback graceful) ──────────
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
    // Lança um erro estruturado para o caller mapear (HTTP 500 com failed_tool).
    throw new AtomicExecutionError(
      failure.error?.message ?? 'Execução falhou — operação revertida.',
      runId,
      failure.failedToolName,
    );
  }

  // ─── 8b. Guard needsConfirmation (Story 2.14 AC10) ────────────────
  if (outcomeNeedsConfirmation(outcome)) {
    const expiresAt = new Date(Date.now() + 5 * 60 * 1000); // 5min D20
    await updatePreviewState(runId, expiresAt, db);

    const pendingActions = collectPendingConfirmations(outcome);

    log.info(
      { run_id: runId, mode: 'preview', reason: 'needs_confirmation' },
      'Preview mode — acção destrutiva aguarda confirmação 5min',
    );

    return {
      status: 'preview',
      runId,
      planSummary: pendingActions,
      confidence: classification.overall_confidence,
      expiresAt: expiresAt.toISOString(),
    };
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

  try {
    await incrementQuota(householdId);
  } catch (err) {
    log.warn({ err }, 'incrementQuota falhou (não-fatal)');
  }

  // W2: o Cérebro AI pode mutar tarefas (e finanças) — invalida as vistas.
  revalidateTaskViews();

  const undoExpiresAt = new Date(Date.now() + 30 * 1000); // 30s FR6
  return {
    status: 'executed',
    kind: 'pipeline',
    runId,
    summary,
    results: outcome,
    undoExpiresAt: undoExpiresAt.toISOString(),
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Erro estruturado de execução atómica (rollback graceful → HTTP 500)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Lançado quando `executor.execute` devolve `success: false` (rollback completo
 * aplicado). Carrega o `runId` e o `failedToolName` para o caller mapear.
 */
export class AtomicExecutionError extends Error {
  readonly runId: string;
  readonly failedToolName?: string;

  constructor(message: string, runId: string, failedToolName?: string) {
    super(message);
    this.name = 'AtomicExecutionError';
    this.runId = runId;
    this.failedToolName = failedToolName;
  }
}

/**
 * Anexa o `runId` a um erro do pipeline (propriedade `runId`) para o caller
 * poder incluir `run_id` na resposta de erro sem perder a identidade do erro
 * original (mantém `instanceof ClassifierError`/`PlannerError`/etc.).
 */
function attachRunId(err: unknown, runId: string): unknown {
  if (err instanceof Error) {
    (err as Error & { runId?: string }).runId = runId;
  }
  return err;
}

/**
 * Mapeia um erro do Planner/Executor para o `error_code` gravado em
 * `agent_runs.status='failed'`. Usa o nome da classe do erro (não minificado
 * aqui — corre no servidor) para discriminar. Fallback `INTERNAL_ERROR`.
 */
function classifyPipelineErrorCode(err: unknown): string {
  const name = err instanceof Error ? err.constructor.name : '';
  switch (name) {
    case 'ToolPlanGateError':
      return 'TOOL_PLAN_GATE_ERROR';
    case 'ExecutorValidationError':
      return 'EXECUTOR_VALIDATION_ERROR';
    case 'PlannerError':
    case 'PlannerValidationError':
    case 'PlannerLLMError':
      return 'PLANNER_ERROR';
    case 'ToolError':
    case 'ToolExecutionError':
      return 'TOOL_EXECUTION_ERROR';
    default:
      return 'INTERNAL_ERROR';
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Helpers (movidos do route handler — sem alteração funcional)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Constrói o `accountContext` (Story 2.13 AC6) — contas e cartões activos do
 * household para o Planner desambiguar conta/cartão nomeados. Falha é não-fatal.
 */
async function buildAccountContext(
  db: ReturnType<typeof getDb>,
  log: ReturnType<typeof childLogger>,
  householdId: string,
): Promise<AccountContext | undefined> {
  try {
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
 * Cria instância do `Classifier` para produção. Em testes é mockado via
 * `vi.mock('@meu-jarvis/classifier')`. Lazy require para evitar resolver `openai`.
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
 * Story 2.14 AC10 — type guard: o output de uma tool sinaliza
 * `needsConfirmation: true`?
 */
function toolOutputNeedsConfirmation(output: unknown): output is { needsConfirmation: true } {
  return (
    typeof output === 'object' &&
    output !== null &&
    'needsConfirmation' in output &&
    (output as { needsConfirmation?: unknown }).needsConfirmation === true
  );
}

/** Story 2.14 AC10 — alguma tool do outcome pede confirmação? */
function outcomeNeedsConfirmation(outcome: AtomicOutcome): boolean {
  if (outcome.success === false) {
    return false;
  }
  const result = outcome as AtomicResult;
  return (result.results ?? []).some((r) => toolOutputNeedsConfirmation(r.output));
}

/** Story 2.14 AC10 — lista de acções destrutivas pendentes (sem PII). */
function collectPendingConfirmations(outcome: AtomicOutcome): string[] {
  if (outcome.success === false) {
    return [];
  }
  const result = outcome as AtomicResult;
  return (result.results ?? [])
    .filter((r) => toolOutputNeedsConfirmation(r.output))
    .map((r) => `${r.toolName} — confirmação necessária`);
}

/** Constrói summary PT-PT do `AtomicResult` (sucesso). */
function buildSummaryText(outcome: AtomicOutcome): string {
  if (outcome.success === false) {
    return 'Operação falhou — rollback completo aplicado.';
  }
  const result = outcome as AtomicResult;
  // Tools de leitura (ex.: consultar_emails) mostram os DADOS, não "N operações".
  const read = renderReadToolResults(result.results ?? []);
  if (read !== null) {
    return read;
  }
  const count = result.results?.length ?? 0;
  if (count === 0) {
    return 'Nada a executar — pedido reconhecido mas sem ações concretas.';
  }
  return `Executei ${count} operação(ões) com sucesso. Tens 30 segundos para reverter.`;
}
