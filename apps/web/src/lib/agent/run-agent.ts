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

import {
  Classifier,
  isReadOnlyIntent,
  type ClassificationResult,
} from '@meu-jarvis/classifier';
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
  type EmailReplyContext,
  type PlanResult,
} from '@meu-jarvis/planner-executor';
import {
  toolRegistry,
  type DrizzleDbClient,
  type ToolExecutionContext,
} from '@meu-jarvis/tools';
import { type OpenAIClientLike } from '@meu-jarvis/agent';

import { resolveReplyCandidates } from '@/lib/agent/tools/gmail/resolve-reply-target';

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
 * Story J-5 AC14 + Story J-7 AC9 — intents de **escrita externa**. Escritas em
 * sistemas externos (Google Calendar, Gmail send) NÃO participam em transacções
 * Postgres: se uma tool irmã (tarefa/finança) falhar, o rollback Postgres NÃO
 * desfaz o evento já criado nem o email já enviado → efeito órfão irrecuperável.
 *
 * O caso do Gmail send (J-7) é mais grave que o do Calendar (J-5): um email
 * enviado não tem sequer undo (o reverse é `_noop`). Por isso intents de escrita
 * externa não correm misturadas com outros domínios — o plano é bloqueado com um
 * preview a pedir separação.
 *
 * Generalizado de `CALENDAR_INTENTS` (J-5) para `EXTERNAL_WRITE_INTENTS` (J-7)
 * sem regressão: os 2 intents de Calendar de escrita continuam cobertos.
 */
const EXTERNAL_WRITE_INTENTS: ReadonlySet<string> = new Set([
  'criar_evento_calendario',
  'reagendar_evento_calendario',
  'enviar_email',
  'responder_email',
]);

/**
 * Story J-5 AC14 + Story J-7 AC9 — detecta um plano misto "escrita externa +
 * outro domínio".
 *
 * `true` quando existe ≥1 intent de escrita externa E ≥1 intent de outro domínio
 * (tasks/finance/query — `unknown` é ignorado, não conta como domínio concreto).
 */
function isMixedExternalWritePlan(intents: ReadonlyArray<{ intent: string }>): boolean {
  const hasExternalWrite = intents.some((i) => EXTERNAL_WRITE_INTENTS.has(i.intent));
  if (!hasExternalWrite) {
    return false;
  }
  const hasOtherDomain = intents.some(
    (i) => !EXTERNAL_WRITE_INTENTS.has(i.intent) && i.intent !== 'unknown',
  );
  return hasOtherDomain;
}

/**
 * Story J-7 SEND-PREVIEW-1 — intents cuja tool expõe um `preview()` com o
 * RASCUNHO REAL da acção (ex.: `enviar_email` mostra Para/Assunto/Corpo). Para
 * estes, a mensagem de confirmação enviada ao utilizador mostra o rascunho
 * produzido por `tool.preview(input)` — não o label genérico do intent
 * (`"enviar_email (92%)"`). É a rede de segurança de uma escrita irreversível: o
 * utilizador revê o destinatário/assunto/corpo ANTES de confirmar o envio.
 *
 * `enviar_email` (J-7, rascunho Para/Assunto/Corpo) + `responder_email` (J-8,
 * rascunho da resposta em thread): os previews de tarefas/finanças/calendar
 * mantêm o comportamento actual (label genérico) — regressão zero.
 */
const PREVIEW_RENDER_INTENTS: ReadonlySet<string> = new Set([
  'enviar_email',
  'responder_email',
]);

/**
 * Story J-8 — intents que exigem resolução do email-alvo (shortlist do inbox)
 * ANTES do Planner correr. Só `responder_email` (uma resposta refere-se a um email
 * existente); `enviar_email` compõe de raiz e não precisa de resolução.
 */
const REPLY_EMAIL_INTENTS: ReadonlySet<string> = new Set(['responder_email']);

/** Story J-8 — o plano contém alguma intent de resposta a email? */
function planHasReplyEmailIntent(intents: ReadonlyArray<{ intent: string }>): boolean {
  return intents.some((i) => REPLY_EMAIL_INTENTS.has(i.intent));
}

/** Story J-7 — o plano tem alguma intent com preview de rascunho real? */
function planHasPreviewRenderIntent(intents: ReadonlyArray<{ intent: string }>): boolean {
  return intents.some((i) => PREVIEW_RENDER_INTENTS.has(i.intent));
}

/**
 * Story J-7 SEND-PREVIEW-1 — `db` placeholder para `tool.preview()`. O preview é
 * PURO (sem I/O — contrato `ToolDefinition`): não deve tocar na base de dados.
 * Este placeholder falha ruidosamente se algum caminho inesperado o usar
 * (defense-in-depth, espelha `TX_RUNNER_DB_PLACEHOLDER` do Executor).
 */
const PREVIEW_DB_PLACEHOLDER: DrizzleDbClient = {
  transaction() {
    throw new Error('preview() não deve abrir transacção — é uma operação pura (sem I/O).');
  },
  insert() {
    throw new Error('preview() não deve fazer insert — é uma operação pura (sem I/O).');
  },
  execute() {
    throw new Error('preview() não deve executar SQL — é uma operação pura (sem I/O).');
  },
};

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
  | { status: 'executed'; kind: 'pipeline'; runId: string; summary: string; results: AtomicOutcome; undoExpiresAt: string; readOnly: boolean }
  | { status: 'executed'; kind: 'direct_query'; runId: string; summary: string; directResult: DirectQueryResult }
  | {
      status: 'preview';
      runId: string;
      planSummary: string[];
      confidence: number;
      expiresAt: string;
      /**
       * Story J-7 SEND-PREVIEW-1 — quando `true`, `planSummary` contém o RASCUNHO
       * real de uma escrita externa (ex.: `enviar_email`: Para/Assunto/Corpo +
       * "Confirmas?"). A camada de resposta (webhook) apresenta-o directamente,
       * sem o embrulhar no wrapper genérico de baixa confiança ("Não tenho a
       * certeza (...)."). Ausente/`false` = preview genérico (comportamento actual).
       */
      awaitingExternalWriteConfirmation?: boolean;
    }
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

  // ─── 6b. Guard multi-intent escrita externa (Story J-5 AC14 + J-7 AC9) ─
  // Se o plano mistura uma escrita externa (Calendar, Gmail send) com outro
  // domínio, NÃO executamos nada: a API externa não participa na transacção
  // Postgres (evento órfão / email enviado sem undo se uma tool irmã falhar).
  // Devolvemos um preview a pedir ao utilizador que separe os pedidos. Nenhuma
  // tool é executada (Planner/Executor nem chegam a correr).
  if (isMixedExternalWritePlan(classification.intents)) {
    const expiresAt = new Date(Date.now() + 5 * 60 * 1000); // 5min D20
    await updatePreviewState(runId, expiresAt, db);

    log.info(
      { run_id: runId, mode: 'preview', reason: 'mixed_external_write_plan' },
      'Preview mode — plano misto escrita externa+outro domínio, a pedir separação',
    );

    return {
      status: 'preview',
      runId,
      planSummary: [
        'Não consigo tratar isto ao mesmo tempo que outro pedido. Fazemos um de cada vez?',
      ],
      confidence: classification.overall_confidence,
      expiresAt: expiresAt.toISOString(),
    };
  }

  // ─── 6c. Plano read-only? (Story J-6 follow-up) ───────────────────
  // Um plano cujos intents são TODOS de leitura (consultar_dados, listar_*,
  // consultar_emails) é seguro executar sem preview→confirm: não há nada a
  // confirmar nem a reverter. Usado abaixo para (a) saltar o preview mesmo com
  // `always_preview=true` e (b) não oferecer undo (sem `Feito.`+`Cancelar`).
  const isReadOnlyPlan =
    classification.intents.length > 0 &&
    classification.intents.every((i) => isReadOnlyIntent(i.intent));

  // ─── 7. Branch FR4 — preview vs executed ──────────────────────────
  // Cost router (Story 2.9 AC6): bypass Planner+Executor para singleton
  // `consultar_dados`. É read-only puro (sem side-effects) — corre em modo
  // directo mesmo com `always_preview=true` (não há nada a pré-visualizar numa
  // consulta). `needs_confirmation` (confiança baixa) continua a cair no preview.
  if (
    !classification.needs_confirmation &&
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

  // `always_preview` NÃO se aplica a leituras (Story J-6 follow-up): não há nada
  // a pré-visualizar/confirmar numa consulta. Escritas mantêm o preview forçado.
  // `needs_confirmation` (confiança baixa) continua a forçar preview em qualquer caso.
  if (classification.needs_confirmation || (alwaysPreview && !isReadOnlyPlan)) {
    const expiresAt = new Date(Date.now() + 5 * 60 * 1000); // 5min D20

    // Story J-7 SEND-PREVIEW-1 — para escritas externas com preview de rascunho
    // real (`enviar_email`), corremos o Planner AGORA para extrair o rascunho
    // (Para/Assunto/Corpo) e mostrá-lo na confirmação, em vez do label genérico
    // do intent. O plano é persistido (`updateAfterPlanner`) e REUTILIZADO no
    // confirm (binding preview==envio) — o nº de chamadas ao Planner no caminho
    // confirmado NÃO aumenta (move-se do confirm para aqui). Restantes intents
    // (tarefas/finanças/calendar) mantêm o label genérico — regressão zero.
    let previewResult: ExternalWritePreviewResult = null;
    if (planHasPreviewRenderIntent(classification.intents)) {
      previewResult = await renderExternalWritePreview({
        classification,
        householdId,
        userId,
        traceId,
        runId,
        db,
        log,
      });
    }

    // Story J-8 AC13 — zero-match honesto: pediram para responder mas não há
    // email-alvo (inbox vazio ou sem candidato válido). Resposta informativa, sem
    // envio e sem botões de confirmação (nunca inventamos um threadId). Reutiliza
    // a forma `direct_query` (o webhook mostra só o summary, sem "(Cancelar)").
    if (previewResult?.kind === 'reply_zero_match') {
      const latencyMs = Date.now() - startedAt;
      await updateAfterExecutor(
        runId,
        {
          status: 'success',
          latencyMs,
          responseSummary: previewResult.message,
          errorCode: null,
          errorMessage: null,
        },
        db,
      );
      log.info(
        { run_id: runId, reason: 'reply_zero_match' },
        'Zero-match honesto — nenhum email para responder (nenhum envio)',
      );
      return {
        status: 'executed',
        kind: 'direct_query',
        runId,
        summary: previewResult.message,
        directResult: {
          templateUsed: 'reply_zero_match',
          data: null,
          summary: previewResult.message,
        },
      };
    }

    const draftSummary = previewResult?.kind === 'draft' ? previewResult.drafts : null;

    // `updatePreviewState` DEPOIS de `renderExternalWritePreview` (que persiste o
    // plano com status='executing') — deixa o estado final em 'pending_preview'.
    await updatePreviewState(runId, expiresAt, db);

    const planSummary =
      draftSummary ??
      classification.intents.map(
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
      awaitingExternalWriteConfirmation: draftSummary !== null,
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
    // Leituras (ex.: consultar_emails, listar_tarefas) não oferecem undo — o
    // caller (webhook/HTTP) omite o botão/undo_url. Story J-6 follow-up.
    readOnly: isReadOnlyPlan,
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
 * Story J-7 SEND-PREVIEW-1 / J-8 — resultado de `renderExternalWritePreview`.
 *   - `{ kind: 'draft', drafts }` — rascunho(s) real(is) da escrita externa.
 *   - `{ kind: 'reply_zero_match', message }` — Story J-8 AC13: pediram uma
 *     resposta mas não há email-alvo (nenhum candidato no inbox). Falha honesta,
 *     sem envio, sem confirmação.
 *   - `null` — sem rascunho disponível (Planner falhou / sem preview): o caller
 *     cai no label genérico do intent.
 */
type ExternalWritePreviewResult =
  | { kind: 'draft'; drafts: string[] }
  | { kind: 'reply_zero_match'; message: string }
  | null;

/**
 * Story J-7 SEND-PREVIEW-1 — constrói o rascunho real de uma escrita externa
 * (`enviar_email`, `responder_email`) para a mensagem de confirmação.
 *
 * Corre o Planner para extrair o input estruturado (to/subject/body [+ threadId/
 * messageId no reply]) e invoca `tool.preview(input)` de cada tool com preview
 * disponível no registry. Persiste o plano (`updateAfterPlanner`) para o confirm o
 * REUTILIZAR — garantindo que o email enviado é EXACTAMENTE o rascunho que o
 * utilizador reviu (binding preview==envio; a segurança de uma escrita irreversível
 * só é real se o que se confirma for o que se vê).
 *
 * Story J-8 AC5 — para `responder_email`, resolve ANTES do Planner a shortlist de
 * candidatos do inbox (`resolveReplyCandidates`) e injecta-a como `emailReplyContext`
 * (prefixo da user message). Shortlist vazia → zero-match honesto (AC13): devolve
 * `{ kind: 'reply_zero_match' }` SEM correr o Planner nem enviar nada.
 *
 * Falha graciosamente: se o Planner falhar ou nenhum toolCall tiver preview,
 * devolve `null` e o caller cai no label genérico do intent (sem quebrar o
 * fluxo). Nesse caso o plano NÃO fica persistido e o confirm re-planeia (fallback).
 */
async function renderExternalWritePreview(params: {
  readonly classification: ClassificationResult;
  readonly householdId: string;
  readonly userId: string;
  readonly traceId: string;
  readonly runId: string;
  readonly db: ReturnType<typeof getDb>;
  readonly log: ReturnType<typeof childLogger>;
}): Promise<ExternalWritePreviewResult> {
  const { classification, householdId, userId, traceId, runId, db, log } = params;
  try {
    // Story J-8 AC5/AC13 — resolução do email-alvo para `responder_email`, ANTES
    // do Planner. Reutiliza a Gmail API (metadados apenas). Sem candidatos →
    // zero-match honesto (nunca inventar um threadId).
    let emailReplyContext: EmailReplyContext | undefined;
    if (planHasReplyEmailIntent(classification.intents)) {
      const candidates = await resolveReplyCandidates({
        householdId,
        userId,
        db: db as unknown as DrizzleDbClient,
        traceId,
        runId,
      });
      if (candidates.length === 0) {
        log.info({ run_id: runId }, 'Zero-match — inbox sem candidatos para responder');
        return { kind: 'reply_zero_match', message: 'Não encontrei esse email para responder.' };
      }
      emailReplyContext = candidates;
    }

    const accountContext = await buildAccountContext(db, log, householdId);
    const planner = new Planner();
    const plan = await planner.plan({
      classification,
      householdId,
      userId,
      traceId,
      runId,
      accountContext,
      emailReplyContext,
    });

    // Persistir o plano para o confirm o reutilizar (binding preview==envio).
    await updateAfterPlanner(
      runId,
      {
        toolCalls: plan.toolCalls,
        executorModel: planner.model,
        tokensInput: plan.tokensInput,
        tokensOutput: plan.tokensOutput,
        costEur: plan.costEur,
      },
      db,
    );

    const previewCtx: ToolExecutionContext = {
      householdId,
      userId,
      db: PREVIEW_DB_PLACEHOLDER,
      traceId,
      runId,
    };

    const drafts: string[] = [];
    for (const call of plan.toolCalls) {
      if (!toolRegistry.has(call.toolName)) {
        continue;
      }
      const tool = toolRegistry.get(call.toolName);
      // `preview` é síncrono e puro (contrato `ToolDefinition`). Valida o input
      // extraído pelo Planner contra o schema da tool antes de renderizar.
      const parsed = tool.inputSchema.safeParse(call.input);
      if (!parsed.success) {
        continue;
      }
      drafts.push(tool.preview(parsed.data, previewCtx));
    }

    return drafts.length > 0 ? { kind: 'draft', drafts } : null;
  } catch (err) {
    log.warn(
      { err },
      'renderExternalWritePreview falhou — a usar label genérico (confirm re-planeia)',
    );
    return null;
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
