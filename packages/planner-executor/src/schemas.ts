/**
 * Schemas Zod do package `@meu-jarvis/planner-executor`.
 *
 * Trace: Story 2.5 AC2 + Architecture §4.3 (`tool_calls[]` array do Sonnet) +
 *        Story 2.4 AC3 D8 (`max(5)` intents — fonte real do cap) + FR2
 *        (atomicidade multi-intent) + FR4 (preview hooks) + Architecture §4.5
 *        (reverse_op delegado a `executeAtomic` da 2.3).
 *
 * Fronteira do package:
 *   - Recebe `ClassificationResult` da Story 2.4 (`@meu-jarvis/classifier`)
 *     como input do Planner.
 *   - Produz `PlanResult` que o Executor consome (delegando atomicidade a
 *     `executeAtomic` da Story 2.3 `@meu-jarvis/tools`).
 *   - `runId` é o UUID de `agent_runs.id` populado pelo endpoint (Story 2.6).
 *
 * Article IV (No Invention):
 *   - `ClassificationSchema` é importado literal de `@meu-jarvis/classifier`.
 *   - `IntentSchema` (8 intents canónicas alinhadas com `agent_intent` enum
 *     Postgres) idem.
 *   - `TOOL_TO_INTENT_MAP` (D6) é um mapping declarativo estático para
 *     enriquecer `PlanToolCall.intent` durante mapping pós-LLM. Cobre as 8
 *     intents do `IntentSchema` — qualquer divergência partida pelo test
 *     `contract.test.ts`.
 */
import { z } from 'zod';

import { ClassificationSchema, IntentSchema, type Intent } from '@meu-jarvis/classifier';

// ─────────────────────────────────────────────────────────────────────────────
// PlanToolCall — uma tool call individual produzida pelo Sonnet
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Tool call individual dentro de um `PlanResult`.
 *
 * `intent` é enriquecida pelo Planner via `TOOL_TO_INTENT_MAP` após receber
 * o output do Sonnet — facilita debug/telemetria sem custo LLM extra (D6).
 *
 * `rawCallId` é o `tool_use_id` devolvido pelo Anthropic SDK (preservado
 * para correlação em audit log da Story 2.6).
 */
export const PlanToolCallSchema = z.object({
  toolName: z.string().min(1),
  input: z.record(z.string(), z.unknown()),
  intent: IntentSchema,
  rawCallId: z.string().optional(),
});

export type PlanToolCall = z.infer<typeof PlanToolCallSchema>;

// ─────────────────────────────────────────────────────────────────────────────
// PlanResult — output completo do Planner
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Resultado de uma chamada `Planner.plan(input)`.
 *
 * - `toolCalls.min(0)`: o LLM pode legitimamente devolver array vazio se
 *   `classification.intents` for `[{intent: 'unknown'}]` (degradação graceful
 *   sem tools = nada a executar). Caso permitido — não é erro.
 * - `toolCalls.max(10)` é guardrail anti-hallucination [AUTO-DECISION D5]
 *   análogo a Story 2.4 AC3 D8 (`max(5)` intents). Ver razão em story.
 * - `planReasoning` é texto livre que o Sonnet eventualmente produz entre
 *   `tool_use` blocks (preservado para debug/audit; não exibido ao utilizador).
 * - `cacheHit` propagado de `ProviderCompleteOutput.cacheHit` da 2.2.
 * - `costEur` propagado (em produção depende de `AGENT_USD_TO_EUR_RATE`).
 */
export const PlanResultSchema = z.object({
  toolCalls: z.array(PlanToolCallSchema).min(0).max(10),
  planReasoning: z.string().nullable(),
  latencyMs: z.number().int().nonnegative(),
  tokensInput: z.number().int().nonnegative(),
  tokensOutput: z.number().int().nonnegative(),
  costEur: z.number().nonnegative(),
  cacheHit: z.boolean(),
});

export type PlanResult = z.infer<typeof PlanResultSchema>;

// ─────────────────────────────────────────────────────────────────────────────
// PlannerInput — entrada de Planner.plan()
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Input do Planner — vindo do orquestrador (endpoint Story 2.6 ou benchmark
 * Story 2.10).
 *
 * `runId` é o UUID de `agent_runs.id` — o endpoint faz INSERT inicial (status
 * `classifying`) e UPDATE final (status `success/failed`). Esta story NÃO
 * persiste `agent_runs` directamente (delegado a Story 2.6).
 *
 * `traceId` propaga para deep-link Grafana. `householdId` e `userId` NUNCA
 * aparecem em logs raw — `hashForCorrelation` aplica-se em span attributes.
 *
 * `accountContext` (Story 2.13 AC6 — ponte Finanças ↔ Cérebro, ADR-002 §9.4):
 * contexto opcional de contas/cartões do household que o endpoint (`apps/web`)
 * monta via SELECT RLS-scoped e o Planner injecta como **prefixo da user
 * message** (NUNCA no `system`/`tools` — preserva o cache Anthropic). São DUAS
 * listas distintas porque cartões NÃO têm `account_type`. `type` é `z.string()`
 * (NÃO importa `accountTypeEnum` de `@meu-jarvis/db` — mantém o package
 * agnóstico de DDL; o endpoint faz o mapeamento da row para a string).
 */
export const AccountContextSchema = z.object({
  accounts: z.array(
    z.object({
      id: z.string().uuid(),
      name: z.string(),
      type: z.string(),
    }),
  ),
  cards: z.array(
    z.object({
      id: z.string().uuid(),
      name: z.string(),
    }),
  ),
});

export type AccountContext = z.infer<typeof AccountContextSchema>;

/**
 * Story J-8 AC5 — shortlist de candidatos de resposta a email (`responder_email`).
 *
 * Um candidato é o metadado (SEM corpo) de um email recente do inbox. O endpoint
 * (`apps/web`) resolve a shortlist via Gmail API FORA do LLM (padrão idêntico ao
 * `accountContext`) e o Planner injecta-a como **prefixo da user message** (NUNCA
 * no `system`/`tools` — preserva o cache de prompt). O LLM escolhe o candidato
 * certo a partir da referência em linguagem natural do utilizador e popula
 * `threadId`/`messageId`/`to` (=`fromEmail`) na tool call `responder_email`.
 *
 * `fromEmail` é o endereço nu parseado (ex.: `pedro@x.pt`) — o `to` da tool é
 * `z.string().email()` e rejeita a forma "Nome <email>". Tipos `z.string()`
 * (agnóstico de DDL, como `accountContext`).
 */
export const EmailReplyCandidateSchema = z.object({
  threadId: z.string(),
  messageId: z.string(),
  from: z.string(),
  fromEmail: z.string(),
  subject: z.string(),
  receivedAt: z.string(),
});

export const EmailReplyContextSchema = z.array(EmailReplyCandidateSchema);

export type EmailReplyCandidate = z.infer<typeof EmailReplyCandidateSchema>;
export type EmailReplyContext = z.infer<typeof EmailReplyContextSchema>;

/**
 * Story M-2 AC2 — memórias do household (o que o Jarvis "sabe" sobre o Eurico),
 * lidas RLS-scoped de `jarvis_memories` (via `getDb()`) ANTES do Planner e
 * injectadas como **prefixo da user message** (NUNCA no `system`/`tools` —
 * preserva o prefixo cacheável do provider). Terceiro contexto do mesmo padrão
 * de `accountContext`/`emailReplyContext`.
 *
 * Só `content` é exposto ao Planner — metadados mínimos (sem `id`/`source`/
 * timestamps): reduz tokens e ruído, e `content` é o único campo com valor
 * semântico. `content` é PII sensível (comment da migration 0034): viaja em
 * `messages` (coberto por `redactProviderPayload`, NFR12), NUNCA em span
 * attributes/logs. Tipo `z.string()` (agnóstico de DDL, como os outros
 * contextos — o endpoint em `apps/web` faz o mapeamento da row para a string).
 */
export const MemoryContextSchema = z.array(z.object({ content: z.string() }));

export type MemoryContext = z.infer<typeof MemoryContextSchema>;

/**
 * Story M-4 AC4 — shortlist de memórias candidatas a esquecer (`esquecer`).
 *
 * DISTINTO do `MemoryContextSchema` (M-2), que deliberadamente NÃO expõe `id`
 * (só `content` — o motor não precisa do id para "saber sobre o Eurico"). Aqui o
 * `id` É necessário: o Planner escolhe QUAL memória apagar a partir da shortlist
 * e popula `memoryId` (o identificador AUTORITATIVO) no input da tool `esquecer`.
 *
 * O endpoint (`apps/web`) resolve a shortlist via SELECT RLS-scoped de
 * `jarvis_memories` ANTES do Planner (padrão idêntico ao `accountContext`/
 * `emailReplyContext`) e injecta-a como **prefixo da user message** SÓ quando o
 * plano contém `esquecer` (NUNCA no `system`/`tools` — preserva o cache de
 * prompt). `content` é PII sensível (migration 0034): viaja em `messages`
 * (coberto por `redactProviderPayload`, NFR12), NUNCA em span attributes/logs.
 */
export const ForgetCandidatesContextSchema = z.array(
  z.object({ id: z.string().uuid(), content: z.string() }),
);

export type ForgetCandidatesContext = z.infer<typeof ForgetCandidatesContextSchema>;

export const PlannerInputSchema = z.object({
  classification: ClassificationSchema,
  householdId: z.string().uuid(),
  userId: z.string().uuid(),
  traceId: z.string().min(1),
  runId: z.string().uuid(),
  accountContext: AccountContextSchema.optional(),
  /**
   * Story J-8 AC5 — shortlist de candidatos de resposta a email (metadados
   * apenas), injectada como prefixo da user message quando o plano contém
   * `responder_email`. Ausente para todos os outros intents.
   */
  emailReplyContext: EmailReplyContextSchema.optional(),
  /**
   * Story M-2 AC2 — memórias do household (contexto passivo lido RLS-scoped ANTES
   * do Planner), injectadas como prefixo da user message para o assistente
   * "conhecer" o Eurico por defeito. Ausente para households sem memórias. Só
   * `content` (sem id/source/timestamps — ver `MemoryContextSchema`).
   */
  memoryContext: MemoryContextSchema.optional(),
  /**
   * Story M-4 AC4 — shortlist de memórias candidatas a esquecer (`{id, content}`),
   * resolvida RLS-scoped ANTES do Planner e injectada como prefixo da user
   * message SÓ quando o plano contém `esquecer`. O Planner escolhe a memória
   * certa e popula `memoryId` na tool call. Ausente para todos os outros intents.
   */
  forgetCandidatesContext: ForgetCandidatesContextSchema.optional(),
  /**
   * Data civil "de hoje" no fuso do utilizador (`YYYY-MM-DD`), injectada como
   * âncora para o cálculo de prazos relativos ("hoje", "amanhã", "dia 1") pelo
   * Planner — sem ela o LLM não sabe a data actual e copia as datas ilustrativas
   * dos exemplos few-shot (bug do "amanhã" → data errada). Opcional: quando
   * ausente, o Planner deriva a data corrente no fuso `Europe/Lisbon` (PT-PT,
   * CON — data residency UE). Override existe sobretudo para testes
   * determinísticos.
   */
  currentDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, 'currentDate deve ser YYYY-MM-DD')
    .optional(),
});

export type PlannerInput = z.infer<typeof PlannerInputSchema>;

// ─────────────────────────────────────────────────────────────────────────────
// ExecutorInput — entrada de Executor.execute()
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Input do Executor — composto pelo `PlanResult` do Planner mais o contexto
 * de execução (mesma estrutura que `PlannerInput` excepto `classification`).
 *
 * O Executor delega `executeAtomic` da Story 2.3 — `runId` é propagado para
 * `agent_reverse_ops.agent_run_id` (FK).
 */
export const ExecutorInputSchema = z.object({
  plan: PlanResultSchema,
  householdId: z.string().uuid(),
  userId: z.string().uuid(),
  traceId: z.string().min(1),
  runId: z.string().uuid(),
});

export type ExecutorInput = z.infer<typeof ExecutorInputSchema>;

// ─────────────────────────────────────────────────────────────────────────────
// TOOL_TO_INTENT_MAP — mapping declarativo (D6)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Mapping estático tool name → intent originária.
 *
 * [AUTO-DECISION D6] Razão: (1) determinístico e testável; (2) evita custo
 * LLM extra (alternativa: pedir ao LLM para anotar intent no input da tool);
 * (3) tools são single source of truth da Story 2.3 e não mudam entre runs;
 * (4) tool name fora do MAP → fallback `'unknown'` (graceful degradation).
 *
 * **Cobertura obrigatória:** as 23 intents do `IntentSchema` (Story 2.4 AC2
 * baseline 8 + Story 3.8 tools cérebro Tarefas +3 + Story 2.14 tools
 * UPDATE/DELETE +4 + Story J-5 tools Calendar +2 + Story J-6 tool Gmail readonly
 * +1 + Story J-7 tool Gmail send +1 + Story J-8 tool Gmail reply +1 + Story M-1
 * tool `memorizar` +1 + Story M-4 tool `esquecer` +1 + Story M-5 tool
 * `sugerir_memoria` +1) têm pelo menos 1 tool name mapeado. Validável em
 * `__tests__/contract.test.ts`.
 *
 * Nomenclatura tools snake_case lowercase (alinhada com Architecture §4.3
 * `create_task`, `query_finance_summary`, etc.).
 *
 * Tools concretas serão implementadas nas Stories 2.6 (Tarefas), 2.7 (Finanças),
 * 2.8 (Consultas/Sistema). Esta story usa apenas mocks em testes.
 *
 * Story 3.8 introduziu tools `criar_tarefa`/`completar_tarefa`/`listar_tarefas`/
 * `listar_atrasadas` em `@meu-jarvis/tools/tasks/` — o tool name JÁ coincide
 * com o intent name PT-PT (pattern intencional para LLM ergonomics PT-PT).
 */
export const TOOL_TO_INTENT_MAP: Record<string, Intent> = {
  // criar_tarefa — Story 3.8 tool name PT-PT
  create_task: 'criar_tarefa',
  criar_tarefa: 'criar_tarefa',
  // criar_financa_variavel
  create_finance_variable: 'criar_financa_variavel',
  // criar_financa_recorrente
  create_finance_recurrence: 'criar_financa_recorrente',
  // criar_cartao
  create_card: 'criar_cartao',
  // criar_parcelada — pode expandir-se em múltiplas tool calls
  create_installment: 'criar_parcelada',
  create_card_transaction: 'criar_parcelada',
  create_installment_plan: 'criar_parcelada',
  // consultar_dados
  query_finance_summary: 'consultar_dados',
  query_tasks: 'consultar_dados',
  query_overdue: 'consultar_dados',
  // cancelar_ultima
  cancel_last_run: 'cancelar_ultima',
  // unknown — fallback intencional
  noop: 'unknown',
  // Story 3.8 — tools cérebro do domínio Tarefas (tool name === intent name PT-PT)
  completar_tarefa: 'completar_tarefa',
  listar_tarefas: 'listar_tarefas',
  listar_atrasadas: 'listar_atrasadas',
  // Story 2.14 — tools UPDATE/DELETE Tarefas e Finanças (tool name === intent name)
  atualizar_tarefa: 'atualizar_tarefa',
  eliminar_tarefa: 'eliminar_tarefa',
  update_finance_variable: 'update_finance_variable',
  delete_finance_variable: 'delete_finance_variable',
  // Story J-5 — tools Calendar escrita (tool name === intent name PT-PT).
  // As calendar tools vivem em `apps/web/src/lib/agent/tools/calendar/` (direcção
  // de dependência), mas o mapping tool→intent é estático e vive aqui.
  criar_evento_calendario: 'criar_evento_calendario',
  reagendar_evento_calendario: 'reagendar_evento_calendario',
  // Story J-6 — tool Gmail readonly (tool name === intent name PT-PT).
  // A gmail tool vive em `apps/web/src/lib/agent/tools/gmail/` (mesma direcção de
  // dependência que as calendar tools), mas o mapping tool→intent vive aqui.
  consultar_emails: 'consultar_emails',
  // Story J-7 — tool Gmail send (tool name === intent name PT-PT). Mesma
  // direcção de dependência que a gmail readonly; o mapping tool→intent vive aqui.
  enviar_email: 'enviar_email',
  // Story J-8 — tool Gmail reply (tool name === intent name PT-PT). Escrita
  // externa irreversível (mesma família de `enviar_email`, com threading).
  responder_email: 'responder_email',
  // Story M-1 — tool `memorizar` (tool name === intent name PT-PT). Escrita
  // INTERNA reversível (INSERT em jarvis_memories + delete_row), mesmo perfil
  // de `criar_tarefa`. A tool vive em `packages/tools/src/memory/` (escrita
  // Postgres pura, sem API externa); o mapping tool→intent vive aqui.
  memorizar: 'memorizar',
  // Story M-4 — tool `esquecer` (tool name === intent name PT-PT). Escrita
  // INTERNA destrutiva mas reversível (DELETE em jarvis_memories +
  // reinsert_row para undo real). A tool vive em `packages/tools/src/memory/`;
  // o mapping tool→intent vive aqui.
  esquecer: 'esquecer',
  // Story M-5 — tool `sugerir_memoria` (tool name === intent name PT-PT).
  // Captura INFERIDA de memória com confirmação SEMPRE obrigatória (R5). Escrita
  // INTERNA reversível (INSERT em jarvis_memories com source='inferred' +
  // delete_row), mesmo perfil de `memorizar`. A tool vive em
  // `packages/tools/src/memory/`; o mapping tool→intent vive aqui.
  sugerir_memoria: 'sugerir_memoria',
};

/**
 * Resolve a intent associada a um tool name. Fallback `'unknown'` se ausente.
 *
 * @param toolName - Nome da tool (ex: 'create_task').
 * @returns Intent associada (ou 'unknown' se tool name fora do MAP).
 */
export function resolveIntentFromToolName(toolName: string): Intent {
  return TOOL_TO_INTENT_MAP[toolName] ?? 'unknown';
}
