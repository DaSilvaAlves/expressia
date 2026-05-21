/**
 * Zod schemas — endpoints `/api/financas/transacoes` + `/[id]` (Story 4.3 AC3 + AC6).
 *
 * Convenções (AC8): `.strict()` rejeita campos extra; `household_id`,
 * `created_by_user_id`, `currency`, `recurrence_id`, `installment_id`,
 * `installment_index` e `agent_run_id` NUNCA em payload — `household_id`/
 * `created_by_user_id` vêm do JWT; `currency` é fixo `'EUR'`; os restantes
 * pertencem às transacções geradas (Stories 4.4/4.5) e não às variáveis.
 *
 * Refinamento composto (AC6a): pelo menos um de `account_id`/`card_id` —
 * alinha o CHECK `transactions_account_or_card` (`finance.ts:418-421`).
 *
 * Enums traçáveis a `packages/db/src/schema/finance.ts`: `transactionKindEnum`
 * (52), `paymentMethodFinanceEnum` (58).
 */
import { z } from 'zod';

/** Tipos de transacção — espelha `transactionKindEnum` (`finance.ts:52`). */
export const TRANSACTION_KINDS = ['expense', 'income', 'transfer'] as const;

/** Métodos de pagamento — espelha `paymentMethodFinanceEnum` (`finance.ts:58`). */
export const PAYMENT_METHODS = [
  'cash',
  'card',
  'transfer',
  'direct_debit',
  'multibanco',
  'mb_way',
  'other',
] as const;

/** Filtro `origin` do GET — segmenta por proveniência da transacção. */
export const TRANSACTION_ORIGINS = ['manual', 'recurrence', 'installment', 'all'] as const;

const TransactionKindSchema = z.enum(TRANSACTION_KINDS);
const PaymentMethodSchema = z.enum(PAYMENT_METHODS);
const DescriptionSchema = z
  .string()
  .min(1, 'Descrição obrigatória.')
  .max(500, 'Descrição excede 500 caracteres.');
const NotesSchema = z.string().max(2000, 'Notas excedem 2000 caracteres.');
const AmountCentsSchema = z
  .number()
  .int('Valor deve ser um inteiro (cêntimos de euro).')
  .positive('Valor deve ser positivo — o sinal lógico vem de `kind`.');
/** Data financeira `YYYY-MM-DD` — coluna `transaction_date date` (`finance.ts:377`). */
const TransactionDateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Data inválida — formato esperado YYYY-MM-DD.')
  .refine((v) => !Number.isNaN(Date.parse(v)), 'Data inválida.');

/**
 * POST /api/financas/transacoes body — só transacções variáveis (manuais).
 *
 * Refinamento (AC6a): pelo menos um de `account_id`/`card_id`.
 */
export const TransactionCreateSchema = z
  .object({
    account_id: z.string().uuid('account_id inválido — deve ser um UUID.').optional(),
    card_id: z.string().uuid('card_id inválido — deve ser um UUID.').optional(),
    category_id: z.string().uuid('category_id inválido — deve ser um UUID.').optional(),
    amount_cents: AmountCentsSchema,
    kind: TransactionKindSchema,
    description: DescriptionSchema,
    transaction_date: TransactionDateSchema,
    payment_method: PaymentMethodSchema.default('card'),
    notes: NotesSchema.optional(),
  })
  .strict()
  .refine((data) => data.account_id !== undefined || data.card_id !== undefined, {
    message: 'Transacção requer conta ou cartão.',
    path: ['account_id'],
  });

export type TransactionCreateInput = z.infer<typeof TransactionCreateSchema>;

/**
 * PATCH /api/financas/transacoes/[id] body — todos os campos opcionais.
 *
 * Sem refinamento composto `account_or_card`: o schema de update não conhece o
 * estado existente da transacção. Pôr ambos a `null` viola o CHECK
 * `transactions_account_or_card` no DB — o handler PATCH converte essa violação
 * em 400 VALIDATION_ERROR (pattern D-4.2.C da Story 4.2).
 */
export const TransactionUpdateSchema = z
  .object({
    account_id: z.string().uuid('account_id inválido — deve ser um UUID.').nullable().optional(),
    card_id: z.string().uuid('card_id inválido — deve ser um UUID.').nullable().optional(),
    category_id: z
      .string()
      .uuid('category_id inválido — deve ser um UUID.')
      .nullable()
      .optional(),
    amount_cents: AmountCentsSchema.optional(),
    kind: TransactionKindSchema.optional(),
    description: DescriptionSchema.optional(),
    transaction_date: TransactionDateSchema.optional(),
    payment_method: PaymentMethodSchema.optional(),
    notes: NotesSchema.nullable().optional(),
  })
  .strict();

export type TransactionUpdateInput = z.infer<typeof TransactionUpdateSchema>;

/**
 * Cursor de paginação de transacções (DP-4.3.2 — schema LOCAL).
 *
 * Order `transaction_date desc, id desc`. NÃO reusa o `CursorPayloadSchema` de
 * `pagination.ts` (Tarefas-scoped — `last_due_date`) para evitar scope-creep.
 */
export const TransactionCursorSchema = z.object({
  last_transaction_date: z.string(),
  last_id: z.string().uuid(),
});

export type TransactionCursor = z.infer<typeof TransactionCursorSchema>;

/** Encode cursor para opaque base64url string. */
export function encodeTransactionCursor(cursor: TransactionCursor): string {
  return Buffer.from(JSON.stringify(cursor), 'utf8').toString('base64url');
}

/** Decode opaque base64url cursor. Retorna null se inválido (handler → 400). */
export function decodeTransactionCursor(raw: string): TransactionCursor | null {
  try {
    const parsed: unknown = JSON.parse(Buffer.from(raw, 'base64url').toString('utf8'));
    const result = TransactionCursorSchema.safeParse(parsed);
    return result.success ? result.data : null;
  } catch {
    return null;
  }
}
