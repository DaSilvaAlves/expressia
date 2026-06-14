/**
 * Tool `create_installment` — regista uma compra parcelada (1 installment +
 * N transactions projectadas, atómica via `executeAtomic`).
 *
 * Domínio: `finance`. **A mais complexa das 5 tools** — D-4.10.4 composite
 * reverse_op aninhado para respeitar `COMPOSITE_REVERSE_OP_MAX_OPS=10`
 * per-level.
 *
 * Scope (Story 4.10 AC4):
 *   - `description` NOT NULL
 *   - `cardId` NOT NULL (installments.card_id ON DELETE restrict)
 *   - `totalAmountCents` inteiro positivo (CHECK `installments_total_positive`)
 *   - `numInstallments` 1..60 (CHECK `installments_num_positive`)
 *   - `purchasedOn` ISO YYYY-MM-DD (NOT NULL)
 *   - `firstInstallmentOn` ISO YYYY-MM-DD (NOT NULL — PO_FIX_INLINE F4)
 *   - `categoryId` opcional → resolveDefaultCategory({kind:'expense'}) (F6)
 *
 * Cálculo de prestações (R-4.1 / R-4.10.1 / D-4.10.7):
 *   computeInstallmentSplit(totalAmountCents, numInstallments) →
 *     - per × (N-1)  para parcelas 1..N-1
 *     - last         para parcela N (absorve resto)
 *     Invariante: (N-1)*per + last === total.
 *
 * Data da parcela `i` (PO_FIX_INLINE F4):
 *   transaction_date = addMonthsSafe(firstInstallmentOn, i - 1)
 *   - i=1 → firstInstallmentOn (a primeira parcela cai na próxima fatura)
 *   - i=2 → firstInstallmentOn + 1 mês
 *   - ...
 *   - i=N → firstInstallmentOn + (N-1) meses
 *
 * Reverse op composite aninhado (D-4.10.4 — ORDEM CRÍTICA):
 *   Endpoint `/undo` (Story 2.8) aplica ops em FIFO (verificado linearmente em
 *   `apps/web/src/app/api/agent/prompt/[runId]/undo/route.ts:167-175` +
 *   `applyReverseOp` recursivo FIFO :268-273).
 *   Logo ordem do payload:
 *     1. Sub-composites de transactions (cada um até 10 deletes) — PRIMEIRO
 *     2. delete_row installments — POR ÚLTIMO
 *   Razão: CHECK constraint `transactions_installment_index_coherent`
 *   (`finance.ts:424-429`) seria violado se o installment row fosse apagado
 *   antes das transactions (FK `ON DELETE set null` deixaria
 *   `installment_id=NULL` mas `installment_index>=1`, violando o CHECK).
 *
 * Trace: Story 4.10 AC4 + PRD FR16 + R-4.10.1 + R-4.10.3 + R-4.10.4 +
 *        D-4.10.4 + D-4.10.7 + Story 4.4 (R-4.1 fonte da fórmula).
 */
import { sql } from 'drizzle-orm';
import { z } from 'zod';

import {
  COMPOSITE_REVERSE_OP_MAX_OPS,
  type ReverseOpPayload,
  type ToolDefinition,
  type ToolExecutionContext,
} from '../contracts';
import { addMonthsSafe } from './_helpers/add-months-safe';
import {
  assertCardBelongsToHousehold,
  mapFinanceFkGuardError,
} from './_helpers/assert-ref-belongs-to-household';
import { chunkArray } from './_helpers/chunk-array';
import { computeInstallmentSplit } from './_helpers/installment-split';
import { formatEuroCents } from './_helpers/format-euro-cents';
import { resolveDefaultCategory } from './_helpers/resolve-default-category';

const CreateInstallmentInputSchema = z.object({
  description: z.string().min(1).max(200),
  cardId: z.string().uuid(),
  totalAmountCents: z.number().int().positive(),
  numInstallments: z.number().int().min(1).max(60),
  purchasedOn: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, 'purchasedOn deve estar no formato YYYY-MM-DD'),
  firstInstallmentOn: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, 'firstInstallmentOn deve estar no formato YYYY-MM-DD'),
  categoryId: z.string().uuid().optional(),
});

export type CreateInstallmentInput = z.infer<typeof CreateInstallmentInputSchema>;

const CreateInstallmentOutputSchema = z.object({
  installmentId: z.string().uuid(),
  transactionIds: z.array(z.string().uuid()).min(1).max(60),
  perInstallmentCents: z.number().int().positive(),
  lastInstallmentCents: z.number().int().positive(),
  totalAmountCents: z.number().int().positive(),
  numInstallments: z.number().int(),
});

export type CreateInstallmentOutput = z.infer<typeof CreateInstallmentOutputSchema>;

interface InstallmentsInsertReturn {
  readonly id: string;
}

interface TransactionsInsertReturn {
  readonly id: string;
}

export const createInstallment: ToolDefinition<CreateInstallmentInput, CreateInstallmentOutput> = {
  name: 'create_installment',
  domain: 'finance',
  description:
    'Usa esta tool quando o utilizador quer registar uma compra parcelada (paga em N prestações no cartão). Cria 1 row em installments + N rows em transactions (projectadas, is_projected=true) atomicamente numa única transacção. Aceita description, cardId, totalAmountCents, numInstallments (1..60), purchasedOn (data da compra) e firstInstallmentOn (data da primeira parcela, geralmente próxima fatura). categoryId é opcional (fallback "Outros gastos").',
  inputSchema: CreateInstallmentInputSchema,
  outputSchema: CreateInstallmentOutputSchema,
  estimatedTokens: 150,

  preview(input) {
    const total = formatEuroCents(input.totalAmountCents);
    return `Comprar '${input.description}' em ${String(input.numInstallments)}× no cartão (total ${total})`;
  },

  async execute(input, ctx: ToolExecutionContext): Promise<CreateInstallmentOutput> {
    // 1) Resolver categoryId (sempre kind='expense' para installments).
    const categoryId =
      input.categoryId ??
      (await resolveDefaultCategory({
        db: ctx.db,
        kind: 'expense',
        toolName: 'create_installment',
      }));

    // 2) Cálculo determinístico das parcelas (R-4.1 / D-4.10.7).
    const split = computeInstallmentSplit(input.totalAmountCents, input.numInstallments);

    // 2.5) Hardening cross-tenant (1.ª rede app-enforced, SEC-1): cardId é
    //      sempre EXPLÍCITO nesta tool (obrigatório no schema). PRÉ-CHECK
    //      RLS-scoped de pertença ao household ANTES de qualquer INSERT.
    await assertCardBelongsToHousehold({
      db: ctx.db,
      cardId: input.cardId,
      toolName: 'create_installment',
    });

    // 3) INSERT em installments.
    //    REDE FINAL (2.ª rede): mapear o trigger DB (SQLSTATE 23P51, migration
    //    0023) para ToolExecutionError PT-PT em caso de race condition. Envolve
    //    o INSERT installments + os N INSERTs transactions (ambos referenciam
    //    cardId e têm trigger de pertença).
    try {
      return await insertInstallmentAndTransactions(input, ctx, categoryId, split);
    } catch (err) {
      throw mapFinanceFkGuardError('create_installment', err);
    }
  },

  /**
   * Composite reverse_op aninhado (D-4.10.4).
   *
   * Estrutura para N=12 (caso típico):
   *   { kind: 'composite', ops: [
   *     { kind: 'composite', ops: [10 × delete_row transactions] },  // sub 1
   *     { kind: 'composite', ops: [2 × delete_row transactions] },   // sub 2
   *     { kind: 'delete_row', table: 'installments', id: ... },      // LAST
   *   ]}
   *
   * Para N=60:
   *   1 top-level composite com 6 sub-composites (10 tx cada) + 1 installment delete = 7 ops top-level.
   *
   * **Ordem FIFO** verificada em `apps/web/src/app/api/agent/prompt/[runId]/undo/route.ts`:
   * o loop linear `for (const sub of op.ops)` aplica ops na ordem do payload,
   * portanto as transactions são apagadas ANTES do installment row — preservando
   * o CHECK constraint `transactions_installment_index_coherent` durante o undo.
   */
  async reverse(output): Promise<ReverseOpPayload> {
    const txChunks = chunkArray(output.transactionIds, COMPOSITE_REVERSE_OP_MAX_OPS);
    const subComposites: ReverseOpPayload[] = txChunks.map((chunk) => ({
      kind: 'composite' as const,
      ops: chunk.map((txId) => ({
        kind: 'delete_row' as const,
        table: 'transactions',
        id: txId,
      })),
    }));

    return {
      kind: 'composite',
      ops: [
        ...subComposites,
        {
          kind: 'delete_row',
          table: 'installments',
          id: output.installmentId,
        },
      ],
    };
  },
};

/**
 * Escrita atómica da compra parcelada: 1 INSERT em `installments` + N INSERTs
 * em `transactions` projectadas. Extraída para fora de `execute()` para que o
 * try/catch que mapeia o erro do trigger DB (SQLSTATE 23P51) envolva todo o
 * bloco de escrita sem aninhar o cálculo/pré-check.
 */
async function insertInstallmentAndTransactions(
  input: CreateInstallmentInput,
  ctx: ToolExecutionContext,
  categoryId: string,
  split: ReturnType<typeof computeInstallmentSplit>,
): Promise<CreateInstallmentOutput> {
  // 3) INSERT em installments.
  const installmentResult = (await ctx.db.execute(sql`
    insert into installments
      (household_id, created_by_user_id, card_id, description,
       total_amount_cents, num_installments, per_installment_cents,
       category_id, purchased_on, first_installment_on)
    values
      (
        ${ctx.householdId},
        ${ctx.userId},
        ${input.cardId}::uuid,
        ${input.description},
        ${input.totalAmountCents},
        ${input.numInstallments},
        ${split.perInstallmentCents},
        ${categoryId}::uuid,
        ${input.purchasedOn}::date,
        ${input.firstInstallmentOn}::date
      )
    returning id
  `)) as ReadonlyArray<InstallmentsInsertReturn>;

  const installmentRow = installmentResult[0];
  if (!installmentRow) {
    throw new Error('INSERT em installments não devolveu row');
  }
  const installmentId = installmentRow.id;

  // 4) Loop N INSERTs em transactions.
  const transactionIds: string[] = [];
  for (let i = 1; i <= input.numInstallments; i += 1) {
    const transactionDate = addMonthsSafe(input.firstInstallmentOn, i - 1);
    const amountCents = split.transactionAmounts[i - 1] as number;
    const description = `${input.description} (${String(i)}/${String(input.numInstallments)})`;

    const txResult = (await ctx.db.execute(sql`
      insert into transactions
        (household_id, created_by_user_id, account_id, card_id, category_id,
         amount_cents, kind, description, transaction_date, payment_method,
         agent_run_id, is_projected, installment_id, installment_index)
      values
        (
          ${ctx.householdId},
          ${ctx.userId},
          null::uuid,
          ${input.cardId}::uuid,
          ${categoryId}::uuid,
          ${amountCents},
          'expense'::transaction_kind,
          ${description},
          ${transactionDate}::date,
          'card'::payment_method_finance,
          ${ctx.runId}::uuid,
          true,
          ${installmentId}::uuid,
          ${i}
        )
      returning id
    `)) as ReadonlyArray<TransactionsInsertReturn>;

    const txRow = txResult[0];
    if (!txRow) {
      throw new Error(
        `INSERT em transactions (parcela ${String(i)}/${String(input.numInstallments)}) não devolveu row`,
      );
    }
    transactionIds.push(txRow.id);
  }

  return {
    installmentId,
    transactionIds,
    perInstallmentCents: split.perInstallmentCents,
    lastInstallmentCents: split.lastInstallmentCents,
    totalAmountCents: input.totalAmountCents,
    numInstallments: input.numInstallments,
  };
}
