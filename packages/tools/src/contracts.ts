/**
 * Contratos públicos do package `@meu-jarvis/tools`.
 *
 * Trace: Story 2.3 AC2 + AC4 + AC5 (AtomicResult/AtomicFailure) + Architecture
 *        §4.3 (`ToolDefinition<I,O>`) + §4.5 (`reverse_op jsonb`) + PRD FR4
 *        (preview), FR6 (undo 30s).
 *
 * Princípio Article IV (No Invention): os 4 valores de `ToolDomain` e os 4
 * valores de `PlanTier` correspondem aos domínios/planos planeados no
 * Architecture §4.3 e PRD FR1-3 (Tarefas/Finanças/Cartões/Consultas) +
 * `plan_tier` enum em `@meu-jarvis/db/schema/tenancy`. O sanity-check em
 * `__tests__/contracts.test.ts` valida em runtime que os arrays alinham.
 */
import { z } from 'zod';

import { ToolValidationError } from './errors';

// ─────────────────────────────────────────────────────────────────────────────
// ToolDomain — domínios de tools previstos no MVP
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Tuple readonly dos domínios de tools suportados.
 *
 * Mapping:
 *   - `tasks`     — Story 2.6 (criar_tarefa, atualizar_tarefa, ...)
 *   - `finance`   — Story 2.7 (criar_financa_variavel, criar_financa_recorrente,
 *                              criar_cartao, criar_parcelada, ...)
 *   - `query`     — Story 2.8 (consultar_dados, consultar_balanco, ...)
 *   - `system`    — operações transversais (cancelar_ultima — FR6, ...)
 *   - `calendar`  — Story J-5 (criar_evento_calendario, reagendar_evento_calendario;
 *                              escrita no Google Calendar via API externa). As
 *                              calendar tools vivem em `apps/web` (direcção de
 *                              dependência — precisam de `@/lib/google/oauth`), NÃO
 *                              em `packages/tools`. Só o domínio é registado aqui.
 *   - `email`     — Story J-6 (consultar_emails; leitura readonly da caixa de
 *                              entrada do Gmail via API externa). Mesma direcção de
 *                              dependência que `calendar` — a tool vive em `apps/web`
 *                              (`@/lib/google/oauth`), só o domínio é registado aqui.
 *   - `memory`    — Story M-1 (memorizar; captura de memória explícita — grava
 *                              texto livre em `jarvis_memories`). Escrita INTERNA
 *                              Postgres pura, SEM dependência de API externa — por
 *                              isso a tool vive em `packages/tools/src/memory/`
 *                              (mesma direcção de dependência que `tasks`/`finance`),
 *                              ao contrário de `calendar`/`email` que vivem em
 *                              `apps/web`.
 */
export const TOOL_DOMAIN_VALUES = [
  'tasks',
  'finance',
  'query',
  'system',
  'calendar',
  'email',
  'memory',
] as const;

/**
 * Schema Zod aceitando qualquer dos domínios de tools suportados.
 */
export const ToolDomainSchema = z.enum(TOOL_DOMAIN_VALUES);

/**
 * Tipo TS derivado.
 */
export type ToolDomain = z.infer<typeof ToolDomainSchema>;

// ─────────────────────────────────────────────────────────────────────────────
// PlanTier — plano de subscrição (alinhado com `plan_tier` enum Postgres)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Tuple readonly dos planos suportados.
 *
 * Alinhado com `plan_tier` enum Postgres em
 * `packages/db/src/schema/tenancy.ts` — qualquer divergência deve ser
 * corrigida via migration + actualização aqui.
 */
export const PLAN_TIER_VALUES = ['free', 'pessoal', 'familia', 'pro'] as const;

/**
 * Schema Zod para PlanTier.
 */
export const PlanTierSchema = z.enum(PLAN_TIER_VALUES);

/**
 * Tipo TS derivado.
 */
export type PlanTier = z.infer<typeof PlanTierSchema>;

// ─────────────────────────────────────────────────────────────────────────────
// ToolExecutionContext — contexto passado a cada tool durante execução
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Tipo estrutural mínimo do cliente Drizzle/Postgres usado pelas tools.
 *
 * Importante: em runtime, `db` é SEMPRE o cliente `getDb()` (role
 * `authenticated`, RLS activa via JWT do Supabase) ou um objecto de
 * transacção compatível. **NUNCA** usar `getServiceDb()` aqui — viola
 * NFR5 RLS.
 *
 * Não importamos `Database` de `@meu-jarvis/db` porque o TypeScript cross-package
 * não consegue resolver os `paths` aliases internos (`@/*`) do package db
 * — mesma limitação documentada em `packages/agent/src/contracts.ts`. A
 * fronteira fica garantida em runtime: o caller passa o resultado de
 * `getDb()` directamente, e o teste de integração `atomic-rls.test.ts`
 * (Story 1.4 bonus) valida a forma real.
 *
 * O tipo é deliberadamente `unknown`-permissive — as tools concretas
 * precisam apenas de `tx.insert(...)`, `tx.select(...)`, `tx.transaction(...)`,
 * que são polimórficos sobre o schema completo. Uma definição mais rica
 * causaria coupling cruzado e erros de typecheck no monorepo.
 */
export interface DrizzleDbClient {
  /** Drizzle `transaction` — o callback recebe um cliente compatível. */
  transaction<T>(fn: (tx: DrizzleDbClient) => Promise<T>): Promise<T>;
  /** Drizzle `insert(table)` — devolve um query builder. */
  insert(table: unknown): {
    values(values: unknown): {
      returning(columns?: unknown): Promise<Array<Record<string, unknown>>>;
    };
  };
  /** Drizzle `execute(sql)` — útil para SQL puro. */
  execute(query: unknown): Promise<unknown>;
}

// ─────────────────────────────────────────────────────────────────────────────
// TxRunner — abre a transacção que envolve o loop de `executeAtomic` (SEC-8)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * `TxRunner` — função que abre a transacção em torno do loop de `executeAtomic`
 * e devolve o resultado do callback.
 *
 * Contrato deliberadamente AGNÓSTICO: `@meu-jarvis/tools` nunca importa
 * `@meu-jarvis/db`. O `withHousehold` concreto só é conhecido no route
 * (`apps/web`) e é injectado por dependency injection.
 *
 * Em PRODUÇÃO (SEC-8 / ADR-003 Fase 4 Fatia D) é montado nos instanciadores de
 * `Executor` como `(fn) => withHousehold({ userId, householdId }, fn)` — abre a
 * transacção como role `authenticated` + claims JWT, activando a RLS viva em
 * runtime (2.ª rede) exactamente no ponto de escrita do cérebro AI. Quando
 * ausente, `executeAtomic` usa o default backward-compat
 * `(fn) => ctx.db.transaction(fn)` (preserva o comportamento histórico — testes
 * que injectam um `DrizzleDbClient` mockado passam sem reescrita).
 *
 * NUNCA deve resolver para `getServiceDb()` (role service_role ignora RLS — NFR5).
 */
export type TxRunner = <T>(fn: (tx: DrizzleDbClient) => Promise<T>) => Promise<T>;

/**
 * Contexto passado a cada chamada de `tool.preview`, `tool.execute` e
 * `tool.reverse`.
 *
 * Restrições anti-PII (NFR12):
 *   - NUNCA contém `promptText` ou `messages` (são apenas em `agent_runs`,
 *     não fluem para tools).
 *   - `householdId` é raw UUID — passa por `hashForCorrelation` antes de
 *     qualquer log via OTel span attributes.
 *   - `userId` é raw UUID — mesma regra.
 */
export interface ToolExecutionContext {
  /** UUID do household actual — populado por RLS via JWT. */
  readonly householdId: string;
  /** UUID do utilizador autenticado — usado em colunas `created_by`. */
  readonly userId: string;
  /** Cliente Drizzle (authenticated, RLS activa) ou cliente da transacção. */
  readonly db: DrizzleDbClient;
  /** Trace ID OTel para correlação Grafana — propagado de `ProviderCompleteInput.traceId`. */
  readonly traceId: string;
  /** UUID do `agent_runs.id` corrente — FK para persistir `agent_reverse_ops.agent_run_id`. */
  readonly runId: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// ReverseOpPayload — operação de undo declarativa (FR6 — 30s window)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Limite máximo de operações dentro de um `composite` reverse_op.
 *
 * Aplicado RECURSIVAMENTE em CADA NÍVEL do payload — i.e. um `composite`
 * pode conter até 10 sub-ops, cada uma das quais pode ser ela própria um
 * `composite` com até 10 sub-ops, e assim por diante. A escolha é defensiva:
 *
 *   - Top-level only seria mais permissivo mas permitiria payloads
 *     descontrolados via aninhamento (10 → 100 → 1000 ops em 3 níveis).
 *   - Per-level garante limite total bounded (10^depth) e o uso real
 *     espera-se ≤2 níveis (ex: criar_parcelada cria parent + 12 child
 *     installments → 1 composite com ~13 ops, sem aninhamento adicional).
 *
 * Trace: Story 2.3 AC2 + AC4 (suggested improvement #2 do PO @aiox-po Pax,
 *        gate 2026-05-08) — clarificação documentada e enforced via Zod
 *        recursive schema (ver `ReverseOpPayloadSchema`).
 */
export const COMPOSITE_REVERSE_OP_MAX_OPS = 10;

/**
 * Variante `delete_row` — usada quando a tool fez um INSERT que deve ser
 * revertido com DELETE.
 *
 * Exemplo: `criar_tarefa` cria 1 linha em `tasks` → reverse_op é
 * `{ kind: 'delete_row', table: 'tasks', id: '<uuid>' }`.
 */
export const ReverseOpDeleteRowSchema = z.object({
  kind: z.literal('delete_row'),
  table: z.string().min(1),
  id: z.string().uuid(),
});

/**
 * Variante `restore_row` — usada quando a tool fez um UPDATE que deve ser
 * revertido restaurando o snapshot prévio dos campos modificados.
 *
 * O snapshot é o estado pré-update do conjunto de colunas que a tool
 * alterou — não o estado completo da row (para limitar payload size).
 */
export const ReverseOpRestoreRowSchema = z.object({
  kind: z.literal('restore_row'),
  table: z.string().min(1),
  id: z.string().uuid(),
  snapshot: z.record(z.unknown()),
});

/**
 * Variante `reinsert_row` — usada quando a tool fez um hard DELETE que deve
 * ser revertido re-inserindo a row com o id original e o snapshot completo.
 *
 * Distinto de `restore_row` (que faz UPDATE): se a row foi eliminada,
 * UPDATE não atinge nenhuma linha e o undo seria no-op silencioso.
 *
 * Confirmado em `undo/route.ts` (branch `restore_row` faz apenas UPDATE).
 * Re-insert de row hard-deleted requer este novo kind.
 *
 * **IMPORTANTE (Story 2.14 PO-FIX-1):** as chaves do `snapshot` são usadas
 * LITERALMENTE como nomes de coluna no INSERT do engine de undo
 * (`insert into ${table} (${cols}) ...`). Por isso o snapshot DEVE usar
 * chaves em snake_case (ex: `transaction_date`, `created_by_user_id`), tal
 * como o snapshot de `restore_row` (precedente `completar-tarefa.ts` —
 * `completed_at`/`status`). camelCase resultaria em "coluna inexistente".
 *
 * Story 2.14 — FIX-1 (undo de eliminar_tarefa / delete_finance_variable).
 */
export const ReverseOpReinsertRowSchema = z.object({
  kind: z.literal('reinsert_row'),
  table: z.string().min(1),
  id: z.string().uuid(),
  snapshot: z.record(z.unknown()), // snapshot completo com todos os campos da row eliminada (snake_case)
});

/**
 * Variante `external_call` — usada quando a tool fez uma chamada de escrita a um
 * sistema EXTERNO ao Postgres (Story J-5: Google Calendar). Como a API externa
 * não participa na transacção Postgres, o undo não pode ser um simples SQL — é
 * uma nova chamada à API externa que desfaz a anterior.
 *
 * - `delete_event` — desfaz um `criar_evento_calendario` (DELETE do evento criado).
 * - `restore_event` — desfaz um `reagendar_evento_calendario` (PATCH de volta aos
 *   horários `originalStart`/`originalEnd`).
 *
 * O motor de undo (`executeUndo` em `undo/route.ts`) reconhece `provider` +
 * `operation` e chama a Google Calendar API com o `accessToken` obtido em runtime.
 *
 * Trace: Story J-5 AC8.
 */
export const ReverseOpExternalCallSchema = z.object({
  kind: z.literal('external_call'),
  provider: z.literal('google_calendar'),
  operation: z.union([z.literal('delete_event'), z.literal('restore_event')]),
  eventId: z.string().min(1),
  originalStart: z.string().optional(), // ISO-8601; para restore_event
  originalEnd: z.string().optional(), // ISO-8601; para restore_event
});

/**
 * Variante `composite` — lista de outras `ReverseOpPayload` (potencialmente
 * recursivas).
 *
 * Limitada a `COMPOSITE_REVERSE_OP_MAX_OPS` ops em CADA NÍVEL (per-level),
 * para prevenir explosão exponencial de payload via aninhamento profundo.
 *
 * Implementada via `z.lazy` para suportar a recursão Zod → TypeScript.
 */
export type ReverseOpPayload =
  | z.infer<typeof ReverseOpDeleteRowSchema>
  | z.infer<typeof ReverseOpRestoreRowSchema>
  | z.infer<typeof ReverseOpReinsertRowSchema> // NOVO — Story 2.14 FIX-1
  | z.infer<typeof ReverseOpExternalCallSchema> // NOVO — Story J-5 (Calendar)
  | { readonly kind: 'composite'; readonly ops: ReverseOpPayload[] };

export const ReverseOpPayloadSchema: z.ZodType<ReverseOpPayload> = z.lazy(() =>
  z.discriminatedUnion('kind', [
    ReverseOpDeleteRowSchema,
    ReverseOpRestoreRowSchema,
    ReverseOpReinsertRowSchema, // NOVO — Story 2.14 FIX-1
    ReverseOpExternalCallSchema, // NOVO — Story J-5 (Calendar)
    z.object({
      kind: z.literal('composite'),
      ops: z.array(ReverseOpPayloadSchema).max(COMPOSITE_REVERSE_OP_MAX_OPS),
    }),
  ]),
);

// ─────────────────────────────────────────────────────────────────────────────
// ToolDefinition<I, O> — contrato base de qualquer tool
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Contrato de uma tool — implementado por cada tool concreta nas Stories
 * 2.6 (Tarefas), 2.7 (Finanças), 2.8 (Consultas).
 *
 * Generic sobre `I` (tipo do input após `inputSchema.parse`) e `O` (tipo do
 * output após `outputSchema.parse`). Os schemas Zod são a fonte de verdade
 * dos tipos — declarações `I`/`O` apenas garantem inferência ergonómica.
 *
 * Workflow de uma chamada (orquestrado por `executeAtomic`):
 *   1. `inputSchema.parse(rawInput)` — valida input vindo do LLM.
 *   2. `preview(input, ctx)` — produz texto PT-PT para preview card (FR4)
 *      quando `confidence < 0.70`. Não tem efeito secundário.
 *   3. `execute(input, ctx)` — executa a operação dentro da transacção.
 *      O `ctx.db` é o cliente da transacção Drizzle.
 *   4. `outputSchema.parse(output)` — valida o resultado.
 *   5. `reverse(output, ctx)` — produz `ReverseOpPayload` declarativo para
 *      undo dentro de 30s (FR6). Não tem efeito secundário.
 */
export interface ToolDefinition<I, O> {
  /** Identificador único snake_case lowercase (ex: 'criar_tarefa'). */
  readonly name: string;
  /** Domínio funcional — usado pelo Planner para filtrar tools por intent. */
  readonly domain: ToolDomain;
  /** Descrição PT-PT do quando-usar — passada literalmente ao LLM. */
  readonly description: string;
  /** Schema Zod do input (validado antes de execute). */
  readonly inputSchema: z.ZodType<I>;
  /** Schema Zod do output (validado depois de execute). */
  readonly outputSchema: z.ZodType<O>;
  /** Plano mínimo necessário — ausência = disponível em todos os planos. */
  readonly requiredPlan?: PlanTier;
  /** Estimativa de tokens de output — dica para cost router (Story 2.9). */
  readonly estimatedTokens?: number;

  /**
   * Produz texto PT-PT human-friendly para preview card (FR4).
   *
   * @param input - Input já validado por `inputSchema.parse`.
   * @param ctx - Contexto de execução (read-only durante preview).
   * @returns Texto PT-PT que descreve o que `execute` faria.
   */
  preview(input: I, ctx: ToolExecutionContext): string;

  /**
   * Executa a operação dentro da transacção Drizzle.
   *
   * **Contrato crítico:**
   *   - `ctx.db` é o cliente da TRANSACÇÃO (não o cliente raiz). Inserts e
   *     updates feitos aqui herdam o rollback automático.
   *   - NUNCA fazer chamadas externas (HTTP, LLM, email) — quebra atomicidade.
   *   - Excepções propagam via `ToolExecutionError` ao caller (`executeAtomic`).
   *
   * @param input - Input já validado.
   * @param ctx - Contexto com `db` = cliente da transacção.
   * @returns Output da operação (validado contra `outputSchema`).
   * @throws Qualquer excepção é capturada e mapeada para `ToolExecutionError`
   *   pelo caller, com rollback completo da transacção.
   */
  execute(input: I, ctx: ToolExecutionContext): Promise<O>;

  /**
   * Produz uma `ReverseOpPayload` declarativa para suporte a undo (FR6).
   *
   * @param output - Output produzido por `execute`.
   * @param ctx - Contexto de execução.
   * @returns Payload reverso que `cancelar_ultima` (Story 2.7) consome para
   *   desfazer a operação dentro da janela de 30s.
   */
  reverse(output: O, ctx: ToolExecutionContext): Promise<ReverseOpPayload>;
}

// ─────────────────────────────────────────────────────────────────────────────
// AtomicResult — saída de `executeAtomic`
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Resultado individual de uma tool dentro de `executeAtomic`.
 */
export interface AtomicToolResult {
  readonly toolName: string;
  readonly output: unknown;
  /** UUID gerado por `gen_random_uuid()` para a row em `agent_reverse_ops`. */
  readonly reverseOpId: string;
}

/**
 * Sucesso de `executeAtomic` — todas as N tools executaram + os N
 * `agent_reverse_ops` foram persistidos numa única transacção.
 *
 * Trace: Story 2.3 AC5.
 */
export interface AtomicResult {
  readonly success: true;
  readonly results: AtomicToolResult[];
}

/**
 * Falha controlada de `executeAtomic` — uma tool falhou; a transacção foi
 * rolled back; nenhum side-effect persiste.
 *
 * Distinto de excepções não-capturadas (essas propagam-se como
 * `ToolTransactionError` para o caller).
 *
 * Trace: Story 2.3 AC5.
 */
export interface AtomicFailure {
  readonly success: false;
  readonly failedToolName: string;
  readonly error: import('./errors').ToolError;
  readonly rolledBack: true;
}

// ─────────────────────────────────────────────────────────────────────────────
// Serialização de ReverseOpPayload para coluna jsonb
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Serializa um `ReverseOpPayload` para string JSON, validando primeiro
 * contra `ReverseOpPayloadSchema`.
 *
 * @param op - Payload a serializar.
 * @returns String JSON pronta para insert em `agent_reverse_ops.reverse_op`.
 * @throws {ToolValidationError} se o payload é inválido (ex: composite com
 *   mais de 10 ops, kind desconhecido, snapshot não-objecto).
 */
export function serializeReverseOp(op: ReverseOpPayload): string {
  const parsed = ReverseOpPayloadSchema.safeParse(op);
  if (!parsed.success) {
    throw new ToolValidationError(
      'serializeReverseOp',
      'op',
      `payload inválido: ${parsed.error.issues.map((i) => i.message).join('; ')}`,
    );
  }
  return JSON.stringify(parsed.data);
}

/**
 * Deserializa uma string JSON para `ReverseOpPayload`, validando contra
 * `ReverseOpPayloadSchema`.
 *
 * @param raw - String JSON vinda da coluna `agent_reverse_ops.reverse_op`.
 * @returns Payload tipado.
 * @throws {ToolValidationError} se `raw` não é JSON válido ou se o payload
 *   resultante não passa schema (kind desconhecido, composite oversize, etc.).
 */
export function deserializeReverseOp(raw: string): ReverseOpPayload {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    throw new ToolValidationError(
      'deserializeReverseOp',
      'raw',
      `string não é JSON parseável: ${err instanceof Error ? err.name : 'unknown'}`,
    );
  }

  const result = ReverseOpPayloadSchema.safeParse(parsed);
  if (!result.success) {
    throw new ToolValidationError(
      'deserializeReverseOp',
      'raw',
      `JSON parseou mas não corresponde a ReverseOpPayload: ${result.error.issues.map((i) => i.message).join('; ')}`,
    );
  }
  return result.data;
}
