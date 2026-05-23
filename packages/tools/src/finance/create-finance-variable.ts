/**
 * Tool `create_finance_variable` — regista uma transacção variável (despesa
 * ou receita pontual não recorrente) no agregado.
 *
 * Domínio: `finance`. Naming EN per Epic §5 literal (D-4.10.1 — ratificada @po).
 *
 * Scope (Story 4.10 AC1):
 *   - `amountCents` inteiro positivo (CHECK `transactions_amount_positive`)
 *   - `kind` = `'expense'` | `'income'` (sem `'transfer'` — DP-4.10.C ratificada)
 *   - `transactionDate` ISO YYYY-MM-DD
 *   - `description` NOT NULL (schema `transactions.description text not null` — PO_FIX_INLINE F1)
 *   - `accountId` XOR `cardId` (CHECK `transactions_account_or_card`)
 *   - `categoryId` opcional → fallback "Outros gastos"/"Outros rendimentos" por kind (D-4.10.8 / F6)
 *   - `paymentMethod` opcional → inferido se omisso (PO_FIX_INLINE F1):
 *       cardId presente → 'card'; accountId presente → 'transfer'
 *
 * Trace: Story 4.10 AC1 + PRD FR13/FR15 + Architecture §3.1 (módulo Finanças) +
 *        Epic 4 §5 (literal naming EN) + Story 4.2/4.3 (API contas/transacções
 *        — fonte do shape).
 *
 * RLS (NFR5 / R-4.7): `ctx.db` é cliente authenticated com JWT. `household_id`
 *   é derivado de `ctx.householdId`, NUNCA do input. Postgres rejeita INSERT
 *   cross-household via policy `WITH CHECK`.
 *
 * PII (NFR12 / D-4.10.6): `amount_cents`/`description`/`account_id`/`card_id` NUNCA
 *   entram em span attributes. Apenas `tool.name`/`tool.domain`/`tool.success`/
 *   `tool.duration_ms`/`household.hash`/`run.id`.
 *
 * Reverse op: `INSERT 1 row` → `{ kind: 'delete_row', table: 'transactions', id }`.
 */
import { sql } from 'drizzle-orm';
import { z } from 'zod';

import type {
  ReverseOpPayload,
  ToolDefinition,
  ToolExecutionContext,
} from '../contracts';
import { formatEuroCents } from './_helpers/format-euro-cents';
import { resolveDefaultCategory } from './_helpers/resolve-default-category';

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

const CreateFinanceVariableInputSchema = z
  .object({
    amountCents: z.number().int().positive(),
    kind: z.enum(['expense', 'income']),
    transactionDate: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/, 'transactionDate deve estar no formato YYYY-MM-DD'),
    description: z.string().min(1).max(500),
    accountId: z.string().uuid().optional(),
    cardId: z.string().uuid().optional(),
    categoryId: z.string().uuid().optional(),
    paymentMethod: z.enum(PAYMENT_METHOD_VALUES).optional(),
  })
  .refine((d) => d.accountId !== undefined || d.cardId !== undefined, {
    message:
      'Fornecer accountId ou cardId (CHECK transactions_account_or_card)',
  });

export type CreateFinanceVariableInput = z.infer<
  typeof CreateFinanceVariableInputSchema
>;

const CreateFinanceVariableOutputSchema = z.object({
  transactionId: z.string().uuid(),
  amountCents: z.number().int(),
  kind: z.enum(['expense', 'income']),
  transactionDate: z.string(),
  accountId: z.string().uuid().nullable(),
  cardId: z.string().uuid().nullable(),
  categoryId: z.string().uuid().nullable(),
});

export type CreateFinanceVariableOutput = z.infer<
  typeof CreateFinanceVariableOutputSchema
>;

interface TransactionsInsertReturn {
  readonly id: string;
  readonly amount_cents: number;
  readonly kind: 'expense' | 'income' | 'transfer';
  readonly transaction_date: string;
  readonly account_id: string | null;
  readonly card_id: string | null;
  readonly category_id: string | null;
}

// ─────────────────────────────────────────────────────────────────────────────
// Tool definition
// ─────────────────────────────────────────────────────────────────────────────

export const createFinanceVariable: ToolDefinition<
  CreateFinanceVariableInput,
  CreateFinanceVariableOutput
> = {
  name: 'create_finance_variable',
  domain: 'finance',
  description:
    'Usa esta tool quando o utilizador quer registar uma transacção variável de finanças — despesa ou receita pontual não recorrente — associada a uma conta ou cartão. Aceita amountCents (cêntimos positivos), kind (expense/income), transactionDate (YYYY-MM-DD), description, accountId OU cardId, categoryId opcional (fallback "Outros gastos"/"Outros rendimentos") e paymentMethod opcional (inferido pelo accountId/cardId se omisso).',
  inputSchema: CreateFinanceVariableInputSchema,
  outputSchema: CreateFinanceVariableOutputSchema,
  estimatedTokens: 80,

  preview(input) {
    const verbo = input.kind === 'expense' ? 'despesa' : 'receita';
    const valor = formatEuroCents(input.amountCents);
    return `Registar ${verbo} de ${valor} em '${input.description}'`;
  },

  async execute(input, ctx: ToolExecutionContext): Promise<CreateFinanceVariableOutput> {
    // 1) Resolver categoryId (DP-4.10.D + PO_FIX_INLINE F6).
    const categoryId =
      input.categoryId ??
      (await resolveDefaultCategory({
        db: ctx.db,
        kind: input.kind,
        toolName: 'create_finance_variable',
      }));

    // 2) Inferir paymentMethod (PO_FIX_INLINE F1):
    //    - input explícito → usar
    //    - cardId presente → 'card'
    //    - accountId presente → 'transfer'
    const paymentMethod =
      input.paymentMethod ??
      (input.cardId !== undefined ? 'card' : 'transfer');

    // 3) INSERT em transactions via ctx.db (RLS authenticated).
    const result = (await ctx.db.execute(sql`
      insert into transactions
        (household_id, created_by_user_id, account_id, card_id, category_id,
         amount_cents, kind, description, transaction_date, payment_method,
         agent_run_id, is_projected)
      values
        (
          ${ctx.householdId},
          ${ctx.userId},
          ${input.accountId ?? null}::uuid,
          ${input.cardId ?? null}::uuid,
          ${categoryId}::uuid,
          ${input.amountCents},
          ${input.kind}::transaction_kind,
          ${input.description},
          ${input.transactionDate}::date,
          ${paymentMethod}::payment_method_finance,
          ${ctx.runId}::uuid,
          false
        )
      returning id, amount_cents, kind, transaction_date, account_id, card_id, category_id
    `)) as ReadonlyArray<TransactionsInsertReturn>;

    const row = result[0];
    if (!row) {
      throw new Error('INSERT em transactions não devolveu row');
    }

    return {
      transactionId: row.id,
      amountCents: row.amount_cents,
      kind: row.kind === 'transfer' ? 'expense' : row.kind, // defensive — RLS schema impede
      transactionDate: row.transaction_date,
      accountId: row.account_id,
      cardId: row.card_id,
      categoryId: row.category_id,
    };
  },

  async reverse(output): Promise<ReverseOpPayload> {
    return {
      kind: 'delete_row',
      table: 'transactions',
      id: output.transactionId,
    };
  },
};
