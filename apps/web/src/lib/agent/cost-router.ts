/**
 * Cost router — Story 2.9 AC4+AC5+AC6.
 *
 * Bypass do Planner+Executor LLM quando o classifier detecta APENAS a intent
 * `consultar_dados` singleton — query directa à BD via `getDb()` (authenticated
 * + RLS). Poupa ~40% das chamadas executor Sonnet (Architecture §13.1) — R3
 * mitigação custo LLM ≤ 30% MRR (NFR20).
 *
 * Templates MVP mínimos (3) — catálogo expandido em Epic 3/4 quando tools de
 * domínio completas estiverem implementadas. Story 2.9 NÃO inventa templates
 * além dos 3 listados. Ver DN14 + Constitution Article IV.
 *
 * **Segurança crítica:** `executeDirectQuery` usa `getDb()` (authenticated,
 * RLS aplicada via JWT `current_household_id()`) — NUNCA `getServiceDb()`.
 * Reads de dados do utilizador requerem RLS. Ver DN6 + D54.
 *
 * Trace: Story 2.9 AC4-AC6, D47+D54, Architecture §4.6+§13.1+§14.9 (ADR-009).
 */
import { sql } from 'drizzle-orm';

import type { ClassificationResult } from '@meu-jarvis/classifier';
import type { DbExecutor } from '@/lib/agent/db-shim';

/** @see DbExecutor em db-shim.ts — tipo canónico para esta assinatura minimal. */
type Database = DbExecutor;

/**
 * Resultado de uma query directa à BD (cost router bypass).
 *
 * Shape minimalista — operação é read-only, sem `reverse_op`, sem `undo_url`
 * no response do handler. Ver DN9 + compat Story 2.8 D40 (ResultMessage lida
 * com `undoUrl` ausente).
 */
export interface DirectQueryResult {
  readonly kind: 'direct_query';
  readonly data: ReadonlyArray<Record<string, unknown>>;
  readonly templateUsed: TemplateName;
  readonly summary: string;
}

/**
 * Templates MVP mínimos para `consultar_dados` (DN14).
 * Catálogo será expandido em Epic 3/4 — Story 2.9 NÃO inventa templates.
 */
export type TemplateName = 'count_tasks' | 'count_finances' | 'balance_summary';

/**
 * Verifica se a classificação consiste EXACTAMENTE numa única intent
 * `consultar_dados`. Multi-intent (mesmo que inclua `consultar_dados`) retorna
 * `false` — o executor é necessário para side-effects das outras intents.
 *
 * Trace: Architecture §4.6 literal "if intents == [consultar_dados] AND
 * read-only → query DB direct, no executor". O "==" implica singleton.
 */
export function isSingleConsultarDados(intents: ClassificationResult['intents']): boolean {
  if (!Array.isArray(intents) || intents.length !== 1) {
    return false;
  }
  return intents[0]!.intent === 'consultar_dados';
}

/**
 * Heurística simples de selecção de template baseada no `raw_span` do classifier.
 *
 * Estratégia keyword-matching em ordem de prioridade — primeira keyword bate ganha.
 * Default: `count_tasks` (intent mais comum em utilizadores MVP).
 *
 * NOTA: implementação propositadamente simples — refactor para classifier-driven
 * template selection em Epic 3/4 quando catálogo expandir.
 */
export function selectTemplate(rawSpan: string | undefined): TemplateName {
  const span = (rawSpan ?? '').toLowerCase();

  // Saldo / finanças (preferir balance_summary sobre count_finances)
  if (span.includes('saldo') || span.includes('total') || span.includes('quanto tenho')) {
    return 'balance_summary';
  }
  // 'transa' cobre 'transação'/'transações' (ç ≠ c em PT-PT — keyword sem 'c').
  // 'finanç' cobre 'finanças'/'financ' (ASCII fold não-fiável em substring matching).
  if (
    span.includes('transa') ||
    span.includes('finanç') ||
    span.includes('financ') ||
    span.includes('despes') ||
    span.includes('receit')
  ) {
    return 'count_finances';
  }
  // Default: tarefas
  return 'count_tasks';
}

/**
 * Constrói summary PT-PT do resultado da query directa.
 *
 * NUNCA inclui PII — apenas counts agregados ou saldo total em EUR formato PT-PT
 * (vírgula decimal, símbolo `€`).
 */
function buildSummary(template: TemplateName, data: ReadonlyArray<Record<string, unknown>>): string {
  const row = data[0] ?? {};
  if (template === 'count_tasks') {
    const count = Number(row['count'] ?? 0);
    if (count === 0) return 'Não tens tarefas pendentes.';
    if (count === 1) return 'Tens 1 tarefa pendente.';
    return `Tens ${count} tarefas pendentes.`;
  }
  if (template === 'count_finances') {
    const count = Number(row['count'] ?? 0);
    if (count === 0) return 'Sem transações registadas.';
    if (count === 1) return 'Tens 1 transação registada.';
    return `Tens ${count} transações registadas.`;
  }
  // balance_summary
  const cents = Number(row['total_cents'] ?? 0);
  const euros = cents / 100;
  // Formato PT-PT: vírgula decimal, símbolo €
  const formatted = euros.toLocaleString('pt-PT', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
  return `O teu saldo total é €${formatted}.`;
}

/**
 * Executa query directa à BD via `getDb()` (authenticated + RLS).
 *
 * RLS garante que `tasks`/`transactions` retornadas pertencem APENAS ao
 * household do utilizador (via `current_household_id()` injectado pelo JWT
 * claim). Story 2.9 NÃO usa `getServiceDb()` aqui — D54 + DN6.
 *
 * **Não silencia erros DB** — propagação ao caller para retornar 500. DN6.
 *
 * @param rawSpan - `intents[0].raw_span` do classifier (heurística template)
 * @param householdId - UUID do household actual (logging only — RLS injecta via JWT)
 * @param db - cliente Drizzle authenticated
 */
export async function executeDirectQuery(
  rawSpan: string | undefined,
  householdId: string,
  db: Database,
): Promise<DirectQueryResult> {
  const template = selectTemplate(rawSpan);

  // RLS aplica `household_id = current_household_id()` automaticamente; o
  // parâmetro `${householdId}` no SQL é defesa em profundidade redundante mas
  // segura (mesmo valor injectado pelo JWT). Padrão consistente com rate-limiter.ts.
  let rows: Array<Record<string, unknown>> = [];
  if (template === 'count_tasks') {
    rows = await db.execute<{ count: number }>(sql`
      select count(*)::int as count
      from public.tasks
      where household_id = ${householdId}::uuid
        and completed_at is null
    `);
  } else if (template === 'count_finances') {
    rows = await db.execute<{ count: number }>(sql`
      select count(*)::int as count
      from public.transactions
      where household_id = ${householdId}::uuid
    `);
  } else {
    // balance_summary
    rows = await db.execute<{ total_cents: number }>(sql`
      select coalesce(sum(amount_cents), 0)::bigint as total_cents
      from public.transactions
      where household_id = ${householdId}::uuid
    `);
  }

  return {
    kind: 'direct_query',
    data: rows,
    templateUsed: template,
    summary: buildSummary(template, rows),
  };
}
