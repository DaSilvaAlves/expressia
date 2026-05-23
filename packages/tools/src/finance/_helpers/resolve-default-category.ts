/**
 * `resolveDefaultCategory` — lookup determinístico da categoria global
 * "Outros gastos" / "Outros rendimentos" por `kind` (PO_FIX_INLINE F6).
 *
 * Usado por `create_finance_variable`, `create_finance_recurrence` e
 * `create_installment` quando o utilizador não fornece `categoryId` explícito
 * (DP-4.10.D ratificada pelo @po).
 *
 * Schema (verificado contra `packages/db/src/schema/finance.ts:184-204`):
 *   - `categories.slug` **NÃO EXISTE** — lookup por `kind` + `name`.
 *   - Seed (`packages/db/migrations/seeds/0001_default_categories.sql`):
 *     - 'Outros gastos'      (expense, sort 999, household_id NULL, is_default=true)
 *     - 'Outros rendimentos' (income,  sort 990, household_id NULL, is_default=true)
 *
 * Comportamento:
 *   - Faz SELECT scoped por `household_id IS NULL` (templates globais).
 *   - Lança `ToolExecutionError` PT-PT se a row de seed estiver ausente —
 *     situação patológica (seed deveria garantir), mas defensive.
 *
 * RLS: o cliente Drizzle (`db: DbShim`) é authenticated — RLS deixa LER
 * categories globais (policy `categories_select_global_or_own`), portanto
 * SELECT funciona sem service_role.
 *
 * Trace: Story 4.10 PO_FIX_INLINE F6 + D-4.10.8 + Task T2.4.
 */
import { sql } from 'drizzle-orm';

import type { DrizzleDbClient } from '../../contracts';
import { ToolExecutionError } from '../../errors';

export interface ResolveDefaultCategoryInput {
  readonly db: DrizzleDbClient;
  readonly kind: 'expense' | 'income';
  /** Nome da tool a propagar em caso de erro — para diagnóstico. */
  readonly toolName: string;
}

interface CategoryRow {
  readonly id: string;
}

const DEFAULT_NAMES = {
  expense: 'Outros gastos',
  income: 'Outros rendimentos',
} as const;

export async function resolveDefaultCategory({
  db,
  kind,
  toolName,
}: ResolveDefaultCategoryInput): Promise<string> {
  const expectedName = DEFAULT_NAMES[kind];
  const rows = (await db.execute(sql`
    select id
    from categories
    where household_id is null
      and kind = ${kind}::category_kind
      and name = ${expectedName}
    limit 1
  `)) as ReadonlyArray<CategoryRow>;

  const row = rows[0];
  if (!row) {
    throw new ToolExecutionError(
      toolName,
      new Error(
        `Categoria por defeito "${expectedName}" (kind=${kind}) não encontrada. Contacta o suporte.`,
      ),
    );
  }
  return row.id;
}
