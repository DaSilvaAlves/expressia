/**
 * `resolveDefaultAccount` — lookup determinístico da conta por defeito do
 * household quando o utilizador não fornece `accountId` nem `cardId`.
 *
 * Usado por `create_finance_variable`, `create_finance_recurrence` e
 * `create_card` quando o input não traz conta nem cartão explícito (Story 2.13
 * AC4 — ponte Finanças ↔ Cérebro, ADR-002 §3 racional + §9).
 *
 * Gémeo de `resolve-default-category.ts`, com uma divergência intencional de
 * shape de retorno (PO-FIX-A / DP-2.13.A): devolve
 * `{ accountId, accountType }` — NÃO apenas o UUID — porque o caller precisa
 * do tipo da conta resolvida para inferir o `paymentMethod`
 * (`'dinheiro'` → `'cash'`; outros → `'transfer'`).
 *
 * Schema (verificado contra `packages/db/src/schema/finance.ts:82-114`):
 *   - A coluna de arquivamento é `archived_at timestamptz` (NULL = activa).
 *     **NÃO existe `is_archived`** (Dev Notes T1 ponto 4). O SELECT filtra
 *     `archived_at IS NULL`.
 *   - `account_type` é o pgEnum `account_type` (`accountTypeEnum`,
 *     `finance.ts:39-46`) — o valor lido é a string (`'dinheiro'`, etc.).
 *
 * Precedência de fallback (ADR-002 §3, Story 2.13 Dev Notes):
 *   1. Conta `account_type='dinheiro'` activa do household (mais antiga se
 *      houver várias — edge case).
 *   2. Conta activa mais antiga do household (qualquer tipo) — households
 *      legacy pré-backfill da migration 0018.
 *   3. Nenhuma conta → `ToolExecutionError` PT-PT accionável (situação
 *      patológica pós-backfill — não deve ocorrer em produção).
 *
 * RLS (NFR5 / R-2.13.3): o cliente Drizzle (`db: DrizzleDbClient`) é o
 * `ctx.db` authenticated (JWT-scoped). NUNCA `getServiceDb()`. O Postgres
 * garante que o SELECT só vê contas do próprio household.
 *
 * Trace: Story 2.13 AC4 + T2.3 + ADR-002 §3/§9 + PO-FIX-A (DP-2.13.A).
 */
import { sql } from 'drizzle-orm';

import type { DrizzleDbClient } from '../../contracts';
import { ToolExecutionError } from '../../errors';

/**
 * Tipos de conta suportados — espelha o `accountTypeEnum` Postgres
 * (`packages/db/src/schema/finance.ts:39-46`). Declarado localmente para o
 * package `@meu-jarvis/tools` não acoplar ao runtime do schema DB (mesma
 * fronteira documentada em `contracts.ts` — não importamos `Database`).
 */
export type AccountType =
  | 'corrente'
  | 'poupanca'
  | 'credito_consignado'
  | 'investimentos'
  | 'dinheiro'
  | 'outro';

export interface ResolveDefaultAccountInput {
  readonly db: DrizzleDbClient;
  /** Nome da tool a propagar em caso de erro — para diagnóstico. */
  readonly toolName: string;
}

export interface ResolveDefaultAccountResult {
  readonly accountId: string;
  readonly accountType: AccountType;
}

interface AccountRow {
  readonly id: string;
  readonly account_type: AccountType;
}

/**
 * Resolve a conta default do household corrente.
 *
 * O `household_id` NÃO é parâmetro — o RLS via `ctx.db` (JWT) já restringe o
 * SELECT às contas do household autenticado (defesa em profundidade).
 *
 * @throws {ToolExecutionError} quando o household não tem nenhuma conta activa.
 */
export async function resolveDefaultAccount({
  db,
  toolName,
}: ResolveDefaultAccountInput): Promise<ResolveDefaultAccountResult> {
  // Precedência 1 e 2 numa única query: contas `dinheiro` activas primeiro,
  // depois qualquer conta activa, ambas ordenadas por `created_at` ascendente.
  // `account_type = 'dinheiro'` desce para o topo via ORDER BY booleano.
  const rows = (await db.execute(sql`
    select id, account_type
    from accounts
    where archived_at is null
    order by (account_type = 'dinheiro') desc, created_at asc
    limit 1
  `)) as ReadonlyArray<AccountRow>;

  const row = rows[0];
  if (!row) {
    throw new ToolExecutionError(
      toolName,
      new Error(
        'Nenhuma conta encontrada para este agregado. Cria uma conta primeiro (Definições → Contas) e tenta novamente.',
      ),
    );
  }

  return { accountId: row.id, accountType: row.account_type };
}
