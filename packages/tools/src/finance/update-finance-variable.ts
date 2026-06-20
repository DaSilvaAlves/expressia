/**
 * Tool `update_finance_variable` — actualiza uma transacção variável manual.
 *
 * Domínio: `finance`. Naming EN per Epic §5 literal (precedente `create-finance-
 * variable.ts`, D-4.10.1).
 *
 * Scope MVP (DP-2.14.A): APENAS `transactions` com `is_projected = false` AND
 * `installment_id IS NULL`. Prestações (parcelas) e transacções projectadas são
 * geridas pelo reverse_op de `create_installment` — editar individualmente
 * quebraria a coerência da composite reverse_op.
 *
 * Trace: Story 2.14 AC3 + PRD FR13/FR15 + DP-2.14.C (resolução fuzzy por
 *        description + desambiguadores transactionDate/amountCents).
 *
 * Pattern reverse_op: UPDATE → `{ kind: 'restore_row', table: 'transactions',
 * id, snapshot: {...campos pré-update em snake_case...} }`.
 *
 * **PO-FIX-1 (Story 2.14):** snapshot em snake_case (o engine de undo usa as
 * keys como nomes de coluna LITERALMENTE).
 *
 * RLS (NFR5): `ctx.db` é cliente authenticated. NUNCA `getServiceDb()`.
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

const PAYMENT_METHOD_VALUES = [
  'cash',
  'card',
  'transfer',
  'direct_debit',
  'multibanco',
  'mb_way',
  'other',
] as const;

const UpdateFinanceVariableInputSchema = z
  .object({
    transactionId: z.string().uuid().optional(),
    description: z.string().min(1).max(200).optional(), // resolução fuzzy
    transactionDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(), // desambiguador (DP-2.14.C)
    amountCents: z.number().int().positive().optional(), // desambiguador
    // Campos a actualizar:
    newAmountCents: z.number().int().positive().optional(),
    newDescription: z.string().min(1).max(500).optional(),
    newTransactionDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
    newCategoryId: z.string().uuid().optional(),
    newPaymentMethod: z.enum(PAYMENT_METHOD_VALUES).optional(),
  })
  .refine((d) => d.transactionId !== undefined || d.description !== undefined, {
    message: 'Fornecer transactionId ou description para identificar a transacção',
  })
  .refine(
    (d) =>
      [
        d.newAmountCents,
        d.newDescription,
        d.newTransactionDate,
        d.newCategoryId,
        d.newPaymentMethod,
      ].some((v) => v !== undefined),
    {
      message: 'Fornecer pelo menos um campo para actualizar',
    },
  );

export type UpdateFinanceVariableInput = z.infer<
  typeof UpdateFinanceVariableInputSchema
>;

const UpdateFinanceVariableOutputSchema = z.object({
  transactionId: z.string().uuid(),
  updatedFields: z.array(z.string()),
  snapshot: z.record(z.unknown()), // snake_case (PO-FIX-1)
  warnings: z.array(z.string()).optional(),
});

export type UpdateFinanceVariableOutput = z.infer<
  typeof UpdateFinanceVariableOutputSchema
>;

// ─────────────────────────────────────────────────────────────────────────────
// Helpers internos
// ─────────────────────────────────────────────────────────────────────────────

interface ResolvedTransactionRow {
  readonly id: string;
  readonly amount_cents: number;
  readonly description: string;
  readonly transaction_date: string;
  readonly category_id: string | null;
  readonly payment_method: string;
  readonly match_count: number;
}

async function resolveTransaction(
  input: UpdateFinanceVariableInput,
  ctx: ToolExecutionContext,
): Promise<ResolvedTransactionRow | null> {
  // Guarda de protecção: is_projected = false AND installment_id IS NULL.
  if (input.transactionId !== undefined) {
    const result = (await ctx.db.execute(sql`
      select id, amount_cents, description, transaction_date, category_id,
             payment_method, 1::int as match_count
      from transactions
      where id = ${input.transactionId}
        and is_projected = false
        and installment_id is null
      limit 1
    `)) as ReadonlyArray<ResolvedTransactionRow>;
    return result[0] ?? null;
  }

  const descPattern = `%${input.description ?? ''}%`;
  // Desambiguadores opcionais (DP-2.14.C).
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
      select id, amount_cents, description, transaction_date, category_id,
             payment_method
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

interface UpdateReturn {
  readonly id: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// Tool definition
// ─────────────────────────────────────────────────────────────────────────────

export const updateFinanceVariable: ToolDefinition<
  UpdateFinanceVariableInput,
  UpdateFinanceVariableOutput
> = {
  name: 'update_finance_variable',
  domain: 'finance',
  description:
    'Usa esta tool quando o utilizador quer corrigir ou editar uma transacção financeira manual — mudar o valor, descrição, data, categoria ou método de pagamento. NÃO usar para prestações de compras parceladas nem transacções projectadas. Aceita transactionId ou description (com desambiguadores opcionais transactionDate e amountCents).',
  inputSchema: UpdateFinanceVariableInputSchema,
  outputSchema: UpdateFinanceVariableOutputSchema,
  estimatedTokens: 110,

  preview(input) {
    const alvo = input.description ? `'${input.description}'` : 'a transacção';
    const partes: string[] = [];
    if (input.newAmountCents !== undefined) {
      partes.push(`valor → ${formatEuroCents(input.newAmountCents)}`);
    }
    if (input.newDescription !== undefined) {
      partes.push(`descrição → '${input.newDescription}'`);
    }
    if (input.newTransactionDate !== undefined) {
      partes.push(`data → ${input.newTransactionDate}`);
    }
    if (input.newCategoryId !== undefined) partes.push('categoria');
    if (input.newPaymentMethod !== undefined) {
      partes.push(`método → ${input.newPaymentMethod}`);
    }
    return `Actualizar transacção ${alvo}: ${partes.join(', ')}`;
  },

  async execute(
    input,
    ctx: ToolExecutionContext,
  ): Promise<UpdateFinanceVariableOutput> {
    // 1) Resolver transacção (com guarda is_projected=false AND installment_id IS NULL).
    const resolved = await resolveTransaction(input, ctx);
    if (!resolved) {
      throw new ToolExecutionError(
        'update_finance_variable',
        new Error(
          input.transactionId
            ? 'Transacção não encontrada ou não é uma transacção manual (prestações não podem ser editadas por este comando).'
            : 'Não encontrei nenhuma transacção manual com essa descrição. As transacções de parcelas não podem ser editadas individualmente.',
        ),
      );
    }

    // 2) Capturar snapshot dos campos a alterar (snake_case — PO-FIX-1).
    const snapshot: Record<string, unknown> = {};
    const updatedFields: string[] = [];
    const setClauses: ReturnType<typeof sql>[] = [];

    if (input.newAmountCents !== undefined) {
      snapshot.amount_cents = resolved.amount_cents;
      updatedFields.push('amount_cents');
      setClauses.push(sql`amount_cents = ${input.newAmountCents}`);
    }
    if (input.newDescription !== undefined) {
      snapshot.description = resolved.description;
      updatedFields.push('description');
      setClauses.push(sql`description = ${input.newDescription}`);
    }
    if (input.newTransactionDate !== undefined) {
      snapshot.transaction_date = resolved.transaction_date;
      updatedFields.push('transaction_date');
      setClauses.push(sql`transaction_date = ${input.newTransactionDate}::date`);
    }
    if (input.newCategoryId !== undefined) {
      snapshot.category_id = resolved.category_id;
      updatedFields.push('category_id');
      setClauses.push(sql`category_id = ${input.newCategoryId}::uuid`);
    }
    if (input.newPaymentMethod !== undefined) {
      snapshot.payment_method = resolved.payment_method;
      updatedFields.push('payment_method');
      setClauses.push(
        sql`payment_method = ${input.newPaymentMethod}::payment_method_finance`,
      );
    }

    // 3) UPDATE — RLS via household_id (JWT). updated_at = now() sempre.
    const updateResult = (await ctx.db.execute(sql`
      update transactions
      set ${sql.join(setClauses, sql`, `)},
          updated_at = now()
      where id = ${resolved.id}
      returning id
    `)) as ReadonlyArray<UpdateReturn>;

    const updated = updateResult[0];
    if (!updated) {
      throw new ToolExecutionError(
        'update_finance_variable',
        new Error('UPDATE em transactions não devolveu row (RLS ou race condition)'),
      );
    }

    const warnings: string[] = [];
    if (input.description && resolved.match_count > 1) {
      warnings.push(
        `Encontrei ${String(resolved.match_count)} transacções com essa descrição. Actualizei a mais recente ('${resolved.description}', ${formatEuroCents(resolved.amount_cents)}).`,
      );
    }

    return {
      transactionId: updated.id,
      updatedFields,
      snapshot,
      ...(warnings.length > 0 ? { warnings } : {}),
    };
  },

  async reverse(output): Promise<ReverseOpPayload> {
    return {
      kind: 'restore_row',
      table: 'transactions',
      id: output.transactionId,
      snapshot: output.snapshot,
    };
  },
};
