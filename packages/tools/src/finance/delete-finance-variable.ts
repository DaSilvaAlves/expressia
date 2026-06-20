/**
 * Tool `delete_finance_variable` — elimina (hard DELETE) uma transacção
 * variável manual.
 *
 * Domínio: `finance`. Naming EN per Epic §5 literal.
 *
 * Scope MVP (DP-2.14.A, idêntico a `update_finance_variable`): APENAS
 * `transactions` com `is_projected = false` AND `installment_id IS NULL`.
 *
 * **Preview obrigatório (DP-2.14.B):** sem `confirmed=true`, early-return com
 * `needsConfirmation: true` SEM DELETE e SEM reverse_op.
 *
 * Trace: Story 2.14 AC4 + PRD FR6 + Epic 2 §1 (conservador na destruição).
 *
 * Pattern reverse_op: hard DELETE → `{ kind: 'reinsert_row', table:
 * 'transactions', id, snapshot: {...row completa em snake_case...} }`.
 *
 * **PO-FIX-1 (Story 2.14):** snapshot em snake_case (kind/transaction_date,
 * etc.) porque o engine de undo usa as keys como nomes de coluna LITERALMENTE.
 * O INSERT do engine faz cast implícito via tipos das colunas — `transaction_date`
 * e `kind` (enum) re-inserem correctamente (testado em AC13 — PO-FIX-2).
 *
 * RLS (NFR5): `ctx.db` authenticated. NUNCA `getServiceDb()`.
 */
import { sql } from 'drizzle-orm';
import { z } from 'zod';

import type {
  ReverseOpPayload,
  ToolDefinition,
  ToolExecutionContext,
} from '../contracts';
import { ToolExecutionError } from '../errors';
import { formatEuroCents } from './_helpers/format-euro-cents';

// ─────────────────────────────────────────────────────────────────────────────
// Schemas
// ─────────────────────────────────────────────────────────────────────────────

const DeleteFinanceVariableInputSchema = z
  .object({
    transactionId: z.string().uuid().optional(),
    description: z.string().min(1).max(200).optional(),
    transactionDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
    amountCents: z.number().int().positive().optional(),
    // DP-2.14.B: ausência tratada como `false` a jusante (`execute` faz
    // `input.confirmed !== true`). NÃO usar `.default(false)` — incompatível
    // com `ToolDefinition<I, O>` (ver D-2.14.1 em eliminar-tarefa.ts).
    confirmed: z.boolean().optional(),
  })
  .refine((d) => d.transactionId !== undefined || d.description !== undefined, {
    message:
      'Fornecer transactionId ou description para identificar a transacção a eliminar',
  });

export type DeleteFinanceVariableInput = z.infer<
  typeof DeleteFinanceVariableInputSchema
>;

const DeleteFinanceVariableOutputSchema = z.object({
  transactionId: z.string().uuid(),
  description: z.string(),
  amountCents: z.number().int(),
  transactionDate: z.string(),
  needsConfirmation: z.boolean(),
  snapshot: z.record(z.unknown()).optional(), // snake_case (PO-FIX-1)
  warnings: z.array(z.string()).optional(),
});

export type DeleteFinanceVariableOutput = z.infer<
  typeof DeleteFinanceVariableOutputSchema
>;

// ─────────────────────────────────────────────────────────────────────────────
// Helpers internos
// ─────────────────────────────────────────────────────────────────────────────

/** Row completa (snake_case) — suficiente para re-inserir via reinsert_row. */
interface ResolvedTransactionRow {
  readonly id: string;
  readonly household_id: string;
  readonly created_by_user_id: string;
  readonly account_id: string | null;
  readonly card_id: string | null;
  readonly category_id: string | null;
  readonly amount_cents: number;
  readonly currency: string;
  readonly kind: string;
  readonly description: string;
  readonly transaction_date: string;
  readonly payment_method: string;
  readonly recurrence_id: string | null;
  readonly installment_id: string | null;
  readonly installment_index: number | null;
  readonly agent_run_id: string | null;
  readonly notes: string | null;
  readonly is_projected: boolean;
  readonly created_at: string;
  readonly match_count: number;
}

/** Match leve para a lista de desambiguação (R-2.14.2). */
interface MatchPreviewRow {
  readonly id: string;
  readonly description: string;
  readonly amount_cents: number;
  readonly transaction_date: string;
}

async function resolveTransaction(
  input: DeleteFinanceVariableInput,
  ctx: ToolExecutionContext,
): Promise<ResolvedTransactionRow | null> {
  if (input.transactionId !== undefined) {
    const result = (await ctx.db.execute(sql`
      select id, household_id, created_by_user_id, account_id, card_id,
             category_id, amount_cents, currency, kind, description,
             transaction_date, payment_method, recurrence_id, installment_id,
             installment_index, agent_run_id, notes, is_projected, created_at,
             1::int as match_count
      from transactions
      where id = ${input.transactionId}
        and is_projected = false
        and installment_id is null
      limit 1
    `)) as ReadonlyArray<ResolvedTransactionRow>;
    return result[0] ?? null;
  }

  const descPattern = `%${input.description ?? ''}%`;
  const dateFilter =
    input.transactionDate !== undefined
      ? sql`and transaction_date = ${input.transactionDate}::date`
      : sql``;
  const amountFilter =
    input.amountCents !== undefined
      ? sql`and amount_cents = ${input.amountCents}`
      : sql``;

  const result = (await ctx.db.execute(sql`
    with matches as (
      select id, household_id, created_by_user_id, account_id, card_id,
             category_id, amount_cents, currency, kind, description,
             transaction_date, payment_method, recurrence_id, installment_id,
             installment_index, agent_run_id, notes, is_projected, created_at
      from transactions
      where is_projected = false
        and installment_id is null
        and lower(description) like lower(${descPattern})
        ${dateFilter}
        ${amountFilter}
      order by transaction_date desc, created_at desc
    )
    select
      m.*,
      (select count(*)::int from matches) as match_count
    from matches m
    limit 1
  `)) as ReadonlyArray<ResolvedTransactionRow>;

  return result[0] ?? null;
}

/**
 * Lista os 3 primeiros matches para a lista de desambiguação (R-2.14.2) quando
 * há múltiplas transacções e nenhum desambiguador foi fornecido.
 */
async function listTopMatches(
  input: DeleteFinanceVariableInput,
  ctx: ToolExecutionContext,
): Promise<ReadonlyArray<MatchPreviewRow>> {
  const descPattern = `%${input.description ?? ''}%`;
  const rows = (await ctx.db.execute(sql`
    select id, description, amount_cents, transaction_date
    from transactions
    where is_projected = false
      and installment_id is null
      and lower(description) like lower(${descPattern})
    order by transaction_date desc, created_at desc
    limit 3
  `)) as ReadonlyArray<MatchPreviewRow>;
  return rows;
}

function buildSnapshot(row: ResolvedTransactionRow): Record<string, unknown> {
  return {
    household_id: row.household_id,
    created_by_user_id: row.created_by_user_id,
    account_id: row.account_id,
    card_id: row.card_id,
    category_id: row.category_id,
    amount_cents: row.amount_cents,
    currency: row.currency,
    kind: row.kind,
    description: row.description,
    transaction_date: row.transaction_date,
    payment_method: row.payment_method,
    recurrence_id: row.recurrence_id,
    installment_id: row.installment_id,
    installment_index: row.installment_index,
    agent_run_id: row.agent_run_id,
    notes: row.notes,
    is_projected: row.is_projected,
    created_at: row.created_at,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Tool definition
// ─────────────────────────────────────────────────────────────────────────────

export const deleteFinanceVariable: ToolDefinition<
  DeleteFinanceVariableInput,
  DeleteFinanceVariableOutput
> = {
  name: 'delete_finance_variable',
  domain: 'finance',
  description:
    'Usa esta tool quando o utilizador quer apagar ou eliminar uma transacção financeira manual. Requer confirmação explícita — gera sempre um preview. NÃO usar para prestações parceladas nem transacções projectadas. Aceita transactionId ou description (com desambiguadores opcionais transactionDate e amountCents).',
  inputSchema: DeleteFinanceVariableInputSchema,
  outputSchema: DeleteFinanceVariableOutputSchema,
  estimatedTokens: 110,

  preview(input) {
    const alvo = input.description ? `'${input.description}'` : 'a transacção indicada';
    return `Eliminar transacção ${alvo} — CONFIRMAR`;
  },

  async execute(
    input,
    ctx: ToolExecutionContext,
  ): Promise<DeleteFinanceVariableOutput> {
    // 1) Resolver transacção (guarda is_projected=false AND installment_id IS NULL).
    const resolved = await resolveTransaction(input, ctx);
    if (!resolved) {
      throw new ToolExecutionError(
        'delete_finance_variable',
        new Error(
          input.transactionId
            ? 'Transacção não encontrada ou não é uma transacção manual (prestações não podem ser eliminadas por este comando).'
            : 'Não encontrei nenhuma transacção manual com essa descrição. As transacções de parcelas não podem ser eliminadas individualmente.',
        ),
      );
    }

    // R-2.14.2: múltiplos matches sem desambiguador → lista os 3 primeiros no
    // warning para o utilizador escolher, e usa a mais recente como default.
    const warnings: string[] = [];
    const hasDisambiguator =
      input.transactionId !== undefined ||
      input.transactionDate !== undefined ||
      input.amountCents !== undefined;
    if (input.description && resolved.match_count > 1 && !hasDisambiguator) {
      const top = await listTopMatches(input, ctx);
      const lista = top
        .map(
          (m) =>
            `${m.description} (${formatEuroCents(m.amount_cents)}, ${m.transaction_date})`,
        )
        .join('; ');
      warnings.push(
        `Encontrei ${String(resolved.match_count)} transacções. As mais recentes: ${lista}. Vou usar a mais recente — indica a data ou o valor para escolher outra.`,
      );
    }

    // 2) Preview obrigatório (DP-2.14.B).
    if (input.confirmed !== true) {
      return {
        transactionId: resolved.id,
        description: resolved.description,
        amountCents: resolved.amount_cents,
        transactionDate: resolved.transaction_date,
        needsConfirmation: true,
        ...(warnings.length > 0 ? { warnings } : {}),
      };
    }

    // 3) Confirmado — capturar snapshot completo e executar DELETE.
    const snapshot = buildSnapshot(resolved);

    await ctx.db.execute(sql`
      delete from transactions
      where id = ${resolved.id}
    `);

    return {
      transactionId: resolved.id,
      description: resolved.description,
      amountCents: resolved.amount_cents,
      transactionDate: resolved.transaction_date,
      needsConfirmation: false,
      snapshot,
      ...(warnings.length > 0 ? { warnings } : {}),
    };
  },

  async reverse(output): Promise<ReverseOpPayload> {
    return {
      kind: 'reinsert_row',
      table: 'transactions',
      id: output.transactionId,
      snapshot: output.snapshot ?? {},
    };
  },
};
